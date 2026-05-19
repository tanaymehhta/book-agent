"""Multi-turn reply engine.

For every inbound message on an active band, decides what to do next:
- Generate a reply draft
- Flag for human review
- Detect approval signal

Uses Anthropic Claude for generation; falls back gracefully if key missing.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from enum import Enum

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .config import get_settings
from .db.enums import ConversationStage, MessageDirection
from .db.models import Band, EmailThread, Message

log = logging.getLogger(__name__)


class NextAction(str, Enum):
    reply_draft = "reply_draft"
    needs_human = "needs_human"
    approval_candidate = "approval_candidate"
    no_action = "no_action"


@dataclass
class ReplyDecision:
    action: NextAction
    draft_text: str | None = None
    confidence: float = 0.0
    reasoning: str = ""
    stage_update: ConversationStage | None = None


FIRST_REPLY_TEMPLATE = """\
Hi {greeting},

Thanks so much for reaching out about playing the Taproom at Lookout Farm! \
To help us see if it's a fit, could you share a few things:

  • Your fee for a 2- or 3-hour set
  • Your genre or musical style
  • A link or two to your music (SoundCloud, Spotify, YouTube, Bandcamp — whatever you've got)
  • The months or dates you're available
  • A sense of your local draw — friends and fans who'd come out

A couple of quick notes on our setup: shows are in the Taproom, sets run \
2 or 3 hours starting around 6pm, and bands bring their own PA, mics, and \
cables. We keep the volume in check (electronic drums preferred).

Looking forward to hearing more!

Laura Neville
Marketing Director
Belkin Family Lookout Farm
"""


def render_first_reply(band: "Band") -> str:
    """Deterministic first-reply text. No LLM call.

    Only variable is the greeting name; everything else is fixed venue copy.
    Prefer contact_name (the person who emailed) over band.name (the act).
    """
    candidate = (band.contact_name or band.name or "").strip()
    first_token = candidate.split()[0] if candidate else ""
    greeting = first_token if first_token and "@" not in first_token else "there"
    return FIRST_REPLY_TEMPLATE.format(greeting=greeting)


SYSTEM_PROMPT = """\
You are a booking assistant for Lookout Farm Brewing & Cider Co., a taproom venue.
Your job is to help book live music acts. You are friendly, professional, and concise.

Key venue details:
- Live music in the Taproom, typically starts at 6pm
- Sets are 2 or 3 hours
- Bands must bring their own PA, mics, cables, equipment
- Bands should help promote to their friends/family/fans
- Volume must be kept in check; electronic drums preferred

Your goals in each reply:
1. Acknowledge what the band said
2. Ask for any missing info you need (availability, set length preference, fee expectations, genre/style)
3. Move the conversation toward confirmation
4. Be warm but efficient — don't over-explain things already discussed

Never invent dates/fees that haven't been discussed. If something is unclear, ask.
If the band seems confirmed and ready, say so clearly.
Do NOT use subject lines or email headers in your reply — just the body text.
Sign off as:
Laura Neville
Marketing Director
Belkin Family Lookout Farm
"""

STAGE_DETECT_PROMPT = """\
Based on this email thread, classify the current conversation stage:
- new_lead: first contact, no details exchanged yet
- collecting_details: actively gathering info (availability, genre, fee, format)
- negotiating_terms: discussing specifics (fee amount, date options, set length)
- pending_confirmation: most terms agreed, but at least one key item still open
  (e.g. band has not yet said yes, fee range not yet accepted)
- confirmed: the band has clearly agreed to the key terms (format, set length,
  fee range, equipment expectations). Specific calendar dates may still be
  getting finalized — that alone does NOT block 'confirmed'. Treat phrases
  like "yes that works", "sounds good, we're in", "let's do it",
  "I'll send dates" (after terms accepted) as confirmation.

Also determine if there's a strong approval/confirmation signal.
An approval signal means the OTHER party (not us) has clearly said
yes/confirmed/let's do it to the overall booking, even if exact dates are
still to be pinned down.

Respond in exactly this format:
STAGE: <stage_name>
APPROVAL_SIGNAL: <yes|no>
APPROVAL_CONFIDENCE: <0.0 to 1.0>
REASONING: <one sentence>
"""


def get_thread_context(s: Session, thread: EmailThread, max_messages: int = 20) -> str:
    """Build a text summary of the thread for the LLM."""
    msgs = (
        s.execute(
            select(Message)
            .where(Message.thread_id == thread.id)
            .order_by(Message.sent_at.asc())
            .limit(max_messages)
        )
        .scalars()
        .all()
    )

    parts: list[str] = []
    for m in msgs:
        direction_label = "THEM" if m.direction == MessageDirection.inbound else "US"
        body = (m.body_text or m.snippet or "").strip()
        # Trim quoted replies (lines starting with >) for cleaner context
        lines = [ln for ln in body.splitlines() if not ln.strip().startswith(">")]
        clean_body = "\n".join(lines).strip()
        parts.append(f"[{direction_label} - {m.sent_at.strftime('%b %d %H:%M')}]\n{clean_body}")

    return "\n\n---\n\n".join(parts)


def decide_next_action(
    s: Session, band: Band, thread: EmailThread
) -> ReplyDecision:
    """Main entry point: given a band + thread, decide what to do next."""
    settings = get_settings()

    if not settings.anthropic_api_key:
        log.warning("No ANTHROPIC_API_KEY set; reply engine disabled")
        return ReplyDecision(
            action=NextAction.needs_human,
            confidence=0.0,
            reasoning="No LLM API key configured",
        )

    thread_context = get_thread_context(s, thread)
    if not thread_context.strip():
        return ReplyDecision(action=NextAction.no_action, reasoning="Empty thread")

    # Guard: approval signals are only meaningful once we've sent something for
    # the band to be approving. On the very first inbound (no prior outbound)
    # we must reply, not jump straight to 'approved'.
    prior_outbound_count = s.execute(
        select(func.count(Message.id)).where(
            Message.thread_id == thread.id,
            Message.direction == MessageDirection.outbound,
        )
    ).scalar_one()
    approval_allowed = prior_outbound_count > 0

    try:
        import anthropic

        client = anthropic.Anthropic(api_key=settings.anthropic_api_key)

        # Step 1: Detect stage and approval signal
        stage_response = client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=200,
            messages=[
                {
                    "role": "user",
                    "content": f"Here is the email thread:\n\n{thread_context}\n\n{STAGE_DETECT_PROMPT}",
                }
            ],
        )
        stage_text = stage_response.content[0].text
        stage_update, is_approval, approval_confidence = _parse_stage_response(stage_text)

        # If strong approval signal detected, or the LLM already classified
        # the stage as 'confirmed' (in which case we trust that directly).
        # Only valid once we've actually sent the band something to approve of.
        stage_is_confirmed = stage_update == ConversationStage.confirmed
        if approval_allowed and (
            (is_approval and approval_confidence >= 0.75) or stage_is_confirmed
        ):
            return ReplyDecision(
                action=NextAction.approval_candidate,
                confidence=max(approval_confidence, 0.85 if stage_is_confirmed else 0.0),
                reasoning=f"Approval signal detected: {stage_text.strip()}",
                stage_update=ConversationStage.confirmed,
            )

        # Step 2: Generate reply draft
        reply_response = client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=500,
            system=SYSTEM_PROMPT,
            messages=[
                {
                    "role": "user",
                    "content": (
                        f"Here is the full email thread so far:\n\n{thread_context}\n\n"
                        "Write the next reply from us (Lookout Farm). "
                        "Keep it concise and move the conversation forward."
                    ),
                }
            ],
        )
        draft_text = reply_response.content[0].text.strip()

        return ReplyDecision(
            action=NextAction.reply_draft,
            draft_text=draft_text,
            confidence=0.8,
            reasoning="Generated reply draft",
            stage_update=stage_update,
        )

    except Exception as e:  # noqa: BLE001
        log.exception("Reply engine failed: %s", e)
        return ReplyDecision(
            action=NextAction.needs_human,
            confidence=0.0,
            reasoning=f"LLM error: {e}",
        )


def _parse_stage_response(text: str) -> tuple[ConversationStage | None, bool, float]:
    """Parse the structured stage detection response."""
    stage: ConversationStage | None = None
    is_approval = False
    confidence = 0.0

    for line in text.strip().splitlines():
        line = line.strip()
        if line.startswith("STAGE:"):
            raw = line.split(":", 1)[1].strip().lower()
            try:
                stage = ConversationStage(raw)
            except ValueError:
                pass
        elif line.startswith("APPROVAL_SIGNAL:"):
            raw = line.split(":", 1)[1].strip().lower()
            is_approval = raw in ("yes", "true", "1")
        elif line.startswith("APPROVAL_CONFIDENCE:"):
            try:
                confidence = float(line.split(":", 1)[1].strip())
            except ValueError:
                pass

    return stage, is_approval, confidence
