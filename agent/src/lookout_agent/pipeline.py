"""Ingestion pipeline: NormalizedMessage -> DB + (maybe) auto-reply.

Idempotent: processing the same provider_message_id twice is a no-op.
"""

from __future__ import annotations

import logging
import os
from datetime import datetime, timedelta, timezone

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .classifier import classify_inbound
from .config import get_settings
from .db import session_scope
from .db.enums import BandStatus, Classification, ConversationStage, MessageDirection
from .db.models import (
    Band,
    BandEmail,
    EmailThread,
    IgnoredMessage,
    Message,
)
from .email.provider import EmailProvider, NormalizedMessage

log = logging.getLogger(__name__)
transition_log = logging.getLogger("lookout.transitions")

AUTO_REPLY_CONFIDENCE = 0.8


def _auto_reply_enabled() -> bool:
    return os.environ.get("AUTO_REPLY_ENABLED", "true").lower() in ("1", "true", "yes")


def ingest_message(msg: NormalizedMessage, provider: EmailProvider) -> None:
    """Persist a single normalized message and trigger first-reply if warranted."""
    settings = get_settings()

    with session_scope() as s:
        if _already_persisted(s, msg):
            log.debug("Skipping already-persisted msg=%s", msg.provider_message_id)
            return

        if msg.direction == "outbound":
            _handle_outbound(s, msg, provider.provider_name)
            return

        # Ignore messages from our own mailbox reaching us somehow
        if msg.from_address.email.lower() == settings.gmail_user_email.lower():
            return

        sender = msg.from_address.email.lower()
        band, band_email_row = _find_band(s, sender)

        if band is None:
            result = classify_inbound(msg, known_sender=False)
            if result.classification == Classification.other:
                _log_ignored(s, msg, result.classification, provider.provider_name)
                log.info("Ignoring non-band inbound from %s (subj=%r)", sender, msg.subject)
                return

            band = _create_band_from_message(s, msg)
            s.flush()  # assign id
            s.add(BandEmail(band_id=band.id, email=sender, is_primary=True))
            s.flush()
            classification = result.classification
            confidence = result.confidence
            log.info("New band created: %s <%s> (conf=%.2f)", band.name, sender, confidence)
        else:
            on_roster = bool(band.on_roster)
            result = classify_inbound(msg, known_sender=True, sender_on_roster=on_roster)
            classification = result.classification
            confidence = result.confidence

        thread = _upsert_thread(s, band, msg, provider.provider_name)
        s.flush()

        # Has anyone on this thread already sent something outbound from us?
        prior_outbound_count = s.execute(
            select(func.count(Message.id)).where(
                Message.thread_id == thread.id,
                Message.direction == MessageDirection.outbound,
            )
        ).scalar_one()

        _insert_message(s, thread, msg, classification, auto_sent=False)
        band.last_activity_at = msg.sent_at
        thread.last_message_at = msg.sent_at
        if thread.first_message_at is None:
            thread.first_message_at = msg.sent_at

        # --- Status transition: incoming -> in_conversation ---
        # Trigger: inbound message arrives on a thread that already has outbound.
        old_status = band.status
        if band.status == BandStatus.incoming and prior_outbound_count > 0:
            band.status = BandStatus.in_conversation
            transition_log.info(
                "STATUS %s -> %s | band=%s sender=%s reason=inbound_after_outbound "
                "prior_outbound=%d msg=%s thread=%s",
                old_status.value,
                band.status.value,
                band.id,
                sender,
                prior_outbound_count,
                msg.provider_message_id,
                msg.provider_thread_id,
            )

        # Auto-reply conditions (unified):
        #   - first contact on a new inquiry (no prior outbound, confidence gate), OR
        #   - any inbound that bumped the band into active conversation
        is_first_contact = (
            classification == Classification.new_inquiry
            and confidence >= AUTO_REPLY_CONFIDENCE
            and prior_outbound_count == 0
        )
        should_run_engine = (
            is_first_contact or band.status == BandStatus.in_conversation
        ) and _auto_reply_enabled()

        # Capture values needed post-commit
        band_id = band.id
        thread_id = thread.id

    # Commit happens; now do side-effects outside the transaction
    if should_run_engine:
        _run_reply_engine(band_id=band_id, thread_id=thread_id, provider=provider)


# ---- Helpers --------------------------------------------------------------


def _already_persisted(s: Session, msg: NormalizedMessage) -> bool:
    existing = s.execute(
        select(Message.id).where(Message.provider_message_id == msg.provider_message_id)
    ).first()
    if existing:
        return True
    ignored = s.execute(
        select(IgnoredMessage.id).where(IgnoredMessage.provider_message_id == msg.provider_message_id)
    ).first()
    return ignored is not None


def _find_band(s: Session, email_addr: str) -> tuple[Band | None, BandEmail | None]:
    row = s.execute(
        select(BandEmail).where(BandEmail.email == email_addr)
    ).scalar_one_or_none()
    if row is None:
        return None, None
    band = s.get(Band, row.band_id)
    return band, row


def _create_band_from_message(s: Session, msg: NormalizedMessage) -> Band:
    name = msg.from_address.name or msg.from_address.email.split("@", 1)[0]
    band = Band(
        name=name,
        contact_name=msg.from_address.name,
        primary_email=msg.from_address.email.lower(),
        status=BandStatus.incoming,
        first_contact_at=msg.sent_at,
        last_activity_at=msg.sent_at,
    )
    s.add(band)
    return band


def _upsert_thread(
    s: Session, band: Band, msg: NormalizedMessage, provider_name: str
) -> EmailThread:
    # Primary lookup: provider_thread_id (most reliable for Gmail)
    thread = s.execute(
        select(EmailThread).where(
            EmailThread.provider == provider_name,
            EmailThread.provider_thread_id == msg.provider_thread_id,
        )
    ).scalar_one_or_none()

    # Fallback 1: In-Reply-To -> known message's internet_message_id
    if thread is None and msg.in_reply_to:
        parent_msg = s.execute(
            select(Message).where(Message.internet_message_id == msg.in_reply_to)
        ).scalar_one_or_none()
        if parent_msg is not None:
            thread = s.get(EmailThread, parent_msg.thread_id)
            log.info(
                "FALLBACK_LINK: In-Reply-To matched msg=%s -> thread=%s",
                msg.provider_message_id,
                thread.id if thread else None,
            )

    # Fallback 2: same sender + same band + recent window (last 14 days)
    if thread is None:
        cutoff = msg.sent_at - timedelta(days=14)
        recent_thread = s.execute(
            select(EmailThread).where(
                EmailThread.band_id == band.id,
                EmailThread.last_message_at >= cutoff,
            ).order_by(EmailThread.last_message_at.desc()).limit(1)
        ).scalar_one_or_none()
        if recent_thread is not None:
            thread = recent_thread
            log.info(
                "FALLBACK_LINK: same-band recent thread match msg=%s -> thread=%s",
                msg.provider_message_id,
                thread.id,
            )

    if thread is None:
        thread = EmailThread(
            band_id=band.id,
            provider=provider_name,
            provider_thread_id=msg.provider_thread_id,
            subject=msg.subject,
            first_message_at=msg.sent_at,
            last_message_at=msg.sent_at,
        )
        s.add(thread)
    return thread


def _insert_message(
    s: Session,
    thread: EmailThread,
    msg: NormalizedMessage,
    classification: Classification | None,
    auto_sent: bool,
) -> Message:
    m = Message(
        thread_id=thread.id,
        provider_message_id=msg.provider_message_id,
        internet_message_id=msg.internet_message_id or None,
        in_reply_to=msg.in_reply_to,
        direction=MessageDirection(msg.direction),
        from_address=msg.from_address.email.lower(),
        to_addresses=[a.email for a in msg.to_addresses],
        cc_addresses=[a.email for a in msg.cc_addresses],
        subject=msg.subject,
        body_text=msg.body_text,
        body_html=msg.body_html,
        snippet=msg.snippet,
        sent_at=msg.sent_at,
        headers=msg.headers,
        classification=classification,
        auto_sent=auto_sent,
    )
    s.add(m)
    return m


def _log_ignored(
    s: Session, msg: NormalizedMessage, classification: Classification, provider_name: str
) -> None:
    s.add(
        IgnoredMessage(
            provider=provider_name,
            provider_message_id=msg.provider_message_id,
            from_address=msg.from_address.email.lower(),
            subject=msg.subject,
            classification=classification,
            sent_at=msg.sent_at,
        )
    )


def _handle_outbound(s: Session, msg: NormalizedMessage, provider_name: str) -> None:
    """A message we (the mailbox) sent. Could be the agent's auto-reply OR Laura
    replying manually from Gmail. Attach to the right thread but do NOT change
    band status (status changes only on inbound-after-outbound per policy)."""
    thread = s.execute(
        select(EmailThread).where(
            EmailThread.provider == provider_name,
            EmailThread.provider_thread_id == msg.provider_thread_id,
        )
    ).scalar_one_or_none()
    if thread is None:
        # We don't know this thread yet (e.g. Laura started a cold outreach
        # manually before we saw any inbound). Skip for V1; can be handled later.
        log.debug("Outbound on unknown thread %s — skipping", msg.provider_thread_id)
        return

    band = s.get(Band, thread.band_id)
    if band is None:
        return

    # Idempotency: the reply engine persists its own outbound immediately after
    # sending, so the Gmail polling loop will also see this message. Skip if
    # we've already recorded it under the same provider_message_id.
    dup = s.execute(
        select(Message.id).where(Message.provider_message_id == msg.provider_message_id)
    ).first()
    if dup:
        return

    _insert_message(s, thread, msg, classification=None, auto_sent=False)
    thread.last_message_at = msg.sent_at
    band.last_activity_at = msg.sent_at

    transition_log.info(
        "OUTBOUND_INGESTED | band=%s status=%s msg=%s thread=%s "
        "(no status change on outbound per policy)",
        band.id,
        band.status.value,
        msg.provider_message_id,
        msg.provider_thread_id,
    )


def _run_reply_engine(band_id, thread_id, provider: EmailProvider) -> None:
    """Run the multi-turn reply engine for an active conversation."""
    from .reply_engine import NextAction, decide_next_action

    with session_scope() as s:
        band = s.get(Band, band_id)
        thread = s.get(EmailThread, thread_id)
        if band is None or thread is None:
            return

        decision = decide_next_action(s, band, thread)

        transition_log.info(
            "REPLY_ENGINE | band=%s action=%s confidence=%.2f stage=%s reason=%s",
            band_id,
            decision.action.value,
            decision.confidence,
            decision.stage_update.value if decision.stage_update else "unchanged",
            decision.reasoning,
        )

        # Update conversation stage if the engine determined one
        if decision.stage_update is not None:
            band.conversation_stage = decision.stage_update

        # Safety net: if the stage reaches 'confirmed' via any path (reply_draft
        # or approval_candidate), promote the band to 'approved'. The dedicated
        # approval_candidate branch below still handles the high-confidence case,
        # but this guarantees the kanban column transitions whenever the LLM
        # classifies the conversation as confirmed.
        if (
            decision.stage_update == ConversationStage.confirmed
            and band.status != BandStatus.approved
        ):
            old_status = band.status
            band.status = BandStatus.approved
            transition_log.info(
                "STATUS %s -> approved | band=%s reason=stage_confirmed confidence=%.2f",
                old_status.value,
                band_id,
                decision.confidence,
            )

        if decision.action == NextAction.approval_candidate:
            if decision.confidence >= 0.85:
                band.status = BandStatus.approved
                transition_log.info(
                    "STATUS in_conversation -> approved | band=%s confidence=%.2f",
                    band_id,
                    decision.confidence,
                )
            else:
                band.needs_review = True
                transition_log.info(
                    "NEEDS_REVIEW | band=%s confidence=%.2f (below auto-approve threshold)",
                    band_id,
                    decision.confidence,
                )

        elif decision.action == NextAction.reply_draft and decision.draft_text:
            # Auto-send reply (no human-in-the-loop).
            try:
                to_email = (band.primary_email or "").strip()
                if not to_email:
                    log.warning("Cannot send reply: band %s has no primary_email", band_id)
                    return

                sent = provider.send_message(
                    to=[to_email],
                    subject=thread.subject or "",
                    body_text=decision.draft_text,
                    reply_to_thread_id=thread.provider_thread_id,
                )

                _insert_message(s, thread, sent, classification=None, auto_sent=False)
                thread.last_message_at = sent.sent_at
                band.last_activity_at = sent.sent_at
                band.draft_ready = False

                transition_log.info(
                    "AUTO_SENT_REPLY | band=%s msg=%s thread=%s",
                    band_id,
                    sent.provider_message_id,
                    sent.provider_thread_id,
                )
            except Exception:  # noqa: BLE001
                log.exception("Failed to auto-send agent reply for band=%s", band_id)

        elif decision.action == NextAction.needs_human:
            band.needs_review = True
