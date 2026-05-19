from __future__ import annotations

from datetime import datetime, timezone
from uuid import UUID

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import desc, select

from .db import session_scope
from .db.enums import BandStatus, DraftCreatedBy, DraftStatus, MessageDirection
from .db.models import Band, Draft, EmailThread, Message
from .email import get_provider
from .events import emit_event
from .insights import get_or_refresh_insights


app = FastAPI(title="Lookout Agent API", version="0.1.0")


class ThreadMessageOut(BaseModel):
    id: str
    direction: str
    from_address: str | None
    to_addresses: list[str]
    subject: str | None
    body_text: str | None
    snippet: str | None
    sent_at: datetime


class ThreadOut(BaseModel):
    thread_id: str
    provider: str
    provider_thread_id: str
    subject: str | None
    messages: list[ThreadMessageOut]


class DraftOut(BaseModel):
    id: str
    provider: str
    provider_draft_id: str
    status: str
    body_text: str
    created_at: datetime
    updated_at: datetime


class MailboxOut(BaseModel):
    email: str
    provider: str


class BandInsightsOut(BaseModel):
    genre: str | None = None
    fee_range: str | None = None
    set_length_preference: str | None = None
    availability_notes: str | None = None
    website: str | None = None
    social_links: list[str] = Field(default_factory=list)
    key_facts: list[str] = Field(default_factory=list)
    updated_at: datetime | None = None


class CreateDraftIn(BaseModel):
    body_text: str = Field(min_length=1)


class SocialLink(BaseModel):
    label: str
    url: str


class BandProfileOut(BaseModel):
    id: str
    name: str | None = None
    contact_name: str | None = None
    primary_email: str | None = None
    w9_name: str | None = None
    bio: str | None = None
    social_links: list[SocialLink] = Field(default_factory=list)
    on_roster: bool = False
    status: str | None = None
    updated_at: datetime | None = None


class UpdateBandProfileIn(BaseModel):
    name: str | None = None
    contact_name: str | None = None
    w9_name: str | None = None
    bio: str | None = None
    social_links: list[SocialLink] | None = None


class UpdateDraftIn(BaseModel):
    body_text: str = Field(min_length=1)


def _latest_thread_for_band(s, band_id: UUID) -> EmailThread | None:
    return (
        s.execute(
            select(EmailThread)
            .where(EmailThread.band_id == band_id)
            .order_by(desc(EmailThread.last_message_at).nullslast(), desc(EmailThread.first_message_at).nullslast())
            .limit(1)
        )
        .scalar_one_or_none()
    )


@app.get("/health")
def health():
    return {"ok": True}


@app.get("/mailbox", response_model=MailboxOut)
def get_mailbox():
    """Email address of the mailbox the OAuth token refers to (matches ingestion)."""
    provider = get_provider()
    try:
        email = provider.mailbox_identity_email()
    except Exception as e:  # noqa: BLE001
        raise HTTPException(
            status_code=503,
            detail=f"Could not resolve mailbox for provider {provider.provider_name}: {e!s}",
        ) from e
    return MailboxOut(email=email, provider=provider.provider_name)


@app.get("/bands/{band_id}/thread", response_model=ThreadOut)
def get_band_thread(band_id: str):
    try:
        band_uuid = UUID(band_id)
    except ValueError as e:  # noqa: BLE001
        raise HTTPException(status_code=400, detail="Invalid band_id") from e

    with session_scope() as s:
        band = s.get(Band, band_uuid)
        if band is None:
            raise HTTPException(status_code=404, detail="Band not found")

        thread = _latest_thread_for_band(s, band_uuid)
        if thread is None:
            raise HTTPException(status_code=404, detail="No thread for band yet")

        msgs = (
            s.execute(
                select(Message)
                .where(Message.thread_id == thread.id)
                .order_by(Message.sent_at.asc())
            )
            .scalars()
            .all()
        )

        return ThreadOut(
            thread_id=str(thread.id),
            provider=thread.provider,
            provider_thread_id=thread.provider_thread_id,
            subject=thread.subject,
            messages=[
                ThreadMessageOut(
                    id=str(m.id),
                    direction=m.direction.value if hasattr(m.direction, "value") else str(m.direction),
                    from_address=m.from_address,
                    to_addresses=list(m.to_addresses or []),
                    subject=m.subject,
                    body_text=m.body_text,
                    snippet=m.snippet,
                    sent_at=m.sent_at,
                )
                for m in msgs
            ],
        )


@app.get("/bands/{band_id}/insights", response_model=BandInsightsOut)
def get_band_insights(band_id: str):
    try:
        band_uuid = UUID(band_id)
    except ValueError as e:  # noqa: BLE001
        raise HTTPException(status_code=400, detail="Invalid band_id") from e

    with session_scope() as s:
        band = s.get(Band, band_uuid)
        if band is None:
            raise HTTPException(status_code=404, detail="Band not found")

        thread = _latest_thread_for_band(s, band_uuid)
        insights = get_or_refresh_insights(s, band, thread)
        updated_at = band.insights_updated_at

        return BandInsightsOut(
            genre=insights.genre,
            fee_range=insights.fee_range,
            set_length_preference=insights.set_length_preference,
            availability_notes=insights.availability_notes,
            website=insights.website,
            social_links=insights.social_links,
            key_facts=insights.key_facts,
            updated_at=updated_at,
        )


@app.post("/bands/{band_id}/drafts", response_model=DraftOut)
def create_reply_draft(band_id: str, payload: CreateDraftIn):
    """Save a dashboard-only draft. Never touches Gmail's Drafts folder."""
    from uuid import uuid4

    try:
        band_uuid = UUID(band_id)
    except ValueError as e:  # noqa: BLE001
        raise HTTPException(status_code=400, detail="Invalid band_id") from e

    provider = get_provider()

    with session_scope() as s:
        band = s.get(Band, band_uuid)
        if band is None:
            raise HTTPException(status_code=404, detail="Band not found")

        thread = _latest_thread_for_band(s, band_uuid)
        if thread is None:
            raise HTTPException(status_code=400, detail="Cannot draft reply: no thread yet")

        to_email = (band.primary_email or "").strip()
        if not to_email:
            raise HTTPException(status_code=400, detail="Band has no primary_email")

        draft = Draft(
            band_id=band.id,
            thread_id=thread.id,
            provider=provider.provider_name,
            provider_draft_id=f"local:{uuid4()}",
            body_text=payload.body_text,
            status=DraftStatus.pending,
            created_by=DraftCreatedBy.human,
        )
        s.add(draft)

        band.draft_ready = True
        band.updated_at = datetime.now(timezone.utc)

        s.flush()
        return DraftOut(
            id=str(draft.id),
            provider=draft.provider,
            provider_draft_id=draft.provider_draft_id,
            status=draft.status.value,
            body_text=draft.body_text,
            created_at=draft.created_at,
            updated_at=draft.updated_at,
        )


@app.patch("/drafts/{draft_id}", response_model=DraftOut)
def update_draft(draft_id: str, payload: UpdateDraftIn):
    """Update draft body text in our DB. No Gmail interaction."""
    try:
        draft_uuid = UUID(draft_id)
    except ValueError as e:  # noqa: BLE001
        raise HTTPException(status_code=400, detail="Invalid draft_id") from e

    with session_scope() as s:
        draft = s.get(Draft, draft_uuid)
        if draft is None:
            raise HTTPException(status_code=404, detail="Draft not found")
        if draft.status != DraftStatus.pending:
            raise HTTPException(status_code=400, detail=f"Draft not editable (status={draft.status.value})")

        draft.body_text = payload.body_text
        draft.updated_at = datetime.now(timezone.utc)

        return DraftOut(
            id=str(draft.id),
            provider=draft.provider,
            provider_draft_id=draft.provider_draft_id,
            status=draft.status.value,
            body_text=draft.body_text,
            created_at=draft.created_at,
            updated_at=draft.updated_at,
        )


@app.post("/drafts/{draft_id}/send")
def send_draft(draft_id: str):
    """Send a draft as a fresh outbound message; no Gmail draft involved."""
    try:
        draft_uuid = UUID(draft_id)
    except ValueError as e:  # noqa: BLE001
        raise HTTPException(status_code=400, detail="Invalid draft_id") from e

    provider = get_provider()

    with session_scope() as s:
        draft = s.get(Draft, draft_uuid)
        if draft is None:
            raise HTTPException(status_code=404, detail="Draft not found")
        if draft.status != DraftStatus.pending:
            raise HTTPException(status_code=400, detail=f"Draft not sendable (status={draft.status.value})")
        if draft.provider != provider.provider_name:
            raise HTTPException(status_code=400, detail="Provider mismatch for this agent instance")

        band = s.get(Band, draft.band_id)
        thread = s.get(EmailThread, draft.thread_id) if draft.thread_id else None
        if band is None or thread is None:
            raise HTTPException(status_code=400, detail="Draft missing band or thread")

        to_email = (band.primary_email or "").strip()
        if not to_email:
            raise HTTPException(status_code=400, detail="Band has no primary_email")

        last_inbound_msg_id = (
            s.execute(
                select(Message.internet_message_id)
                .where(
                    Message.thread_id == thread.id,
                    Message.direction == MessageDirection.inbound,
                    Message.internet_message_id.is_not(None),
                )
                .order_by(desc(Message.sent_at))
                .limit(1)
            )
            .scalar_one_or_none()
        )

        sent = provider.send_message(
            to=[to_email],
            subject=thread.subject or "",
            body_text=draft.body_text,
            reply_to_thread_id=thread.provider_thread_id,
            in_reply_to_message_id=last_inbound_msg_id,
        )

        msg = Message(
            thread_id=thread.id,
            provider_message_id=sent.provider_message_id,
            direction=MessageDirection.outbound,
            from_address=sent.from_address.email.lower(),
            to_addresses=[a.email for a in sent.to_addresses],
            cc_addresses=[a.email for a in sent.cc_addresses],
            subject=sent.subject,
            body_text=sent.body_text,
            body_html=sent.body_html,
            snippet=sent.snippet,
            sent_at=sent.sent_at,
            headers=sent.headers,
            classification=None,
            auto_sent=False,
        )
        s.add(msg)
        thread.last_message_at = sent.sent_at

        draft.status = DraftStatus.sent
        draft.sent_at = datetime.now(timezone.utc)
        draft.updated_at = datetime.now(timezone.utc)

        band.last_activity_at = sent.sent_at
        band.draft_ready = False

        emit_event(
            "laura_sent",
            band_id=band.id,
            band_name=band.name,
            to=to_email,
            from_ai_draft=(draft.created_by == DraftCreatedBy.agent),
        )

        return {"ok": True}



def _serialize_band_profile(band: Band) -> BandProfileOut:
    raw_links = band.social_links or []
    parsed: list[SocialLink] = []
    for item in raw_links:
        if isinstance(item, dict) and item.get("url"):
            parsed.append(SocialLink(label=str(item.get("label") or item["url"]), url=str(item["url"])))
    return BandProfileOut(
        id=str(band.id),
        name=band.name,
        contact_name=band.contact_name,
        primary_email=band.primary_email,
        w9_name=band.w9_name,
        bio=band.bio,
        social_links=parsed,
        on_roster=band.on_roster,
        status=band.status.value if band.status else None,
        updated_at=band.updated_at,
    )


@app.get("/bands/{band_id}/profile", response_model=BandProfileOut)
def get_band_profile(band_id: str):
    try:
        band_uuid = UUID(band_id)
    except ValueError as e:  # noqa: BLE001
        raise HTTPException(status_code=400, detail="Invalid band_id") from e

    with session_scope() as s:
        band = s.get(Band, band_uuid)
        if band is None:
            raise HTTPException(status_code=404, detail="Band not found")
        return _serialize_band_profile(band)


@app.patch("/bands/{band_id}/profile", response_model=BandProfileOut)
def update_band_profile(band_id: str, payload: UpdateBandProfileIn):
    try:
        band_uuid = UUID(band_id)
    except ValueError as e:  # noqa: BLE001
        raise HTTPException(status_code=400, detail="Invalid band_id") from e

    with session_scope() as s:
        band = s.get(Band, band_uuid)
        if band is None:
            raise HTTPException(status_code=404, detail="Band not found")

        data = payload.model_dump(exclude_unset=True)
        if "name" in data:
            band.name = data["name"]
        if "contact_name" in data:
            band.contact_name = data["contact_name"]
        if "w9_name" in data:
            band.w9_name = data["w9_name"]
        if "bio" in data:
            band.bio = data["bio"]
        if "social_links" in data and data["social_links"] is not None:
            band.social_links = [
                {"label": link.label, "url": link.url} for link in payload.social_links or []
            ]
        band.updated_at = datetime.now(timezone.utc)
        s.flush()
        return _serialize_band_profile(band)


# ---------------------------------------------------------------------------
# Events feed — read-only activity log for external monitors (e.g. Hermes).
# Read-only. No effect on the email pipeline.
# ---------------------------------------------------------------------------


@app.get("/events/health")
def events_health():
    """Self-check for the events feed. Hermes can hit this on startup to
    confirm both endpoint and table are wired correctly.

    Returns one of:
      ok   — table exists, query worked
      degraded — table missing or unreadable (feed will return empty)
    """
    from sqlalchemy import text

    try:
        with session_scope() as s:
            row = s.execute(
                text(
                    """
                    SELECT
                      COUNT(*)                     AS total,
                      MAX(occurred_at)             AS latest_at,
                      COUNT(*) FILTER (
                        WHERE occurred_at > now() - interval '24 hours'
                      )                            AS last_24h
                    FROM events
                    """
                )
            ).mappings().one()
            return {
                "status": "ok",
                "environment_hint": _environment_hint(),
                "total_events": int(row["total"] or 0),
                "events_last_24h": int(row["last_24h"] or 0),
                "latest_event_at": row["latest_at"].isoformat() if row["latest_at"] else None,
                "message": "Events feed is live and the table is reachable.",
            }
    except Exception as exc:  # noqa: BLE001
        return {
            "status": "degraded",
            "environment_hint": _environment_hint(),
            "total_events": 0,
            "events_last_24h": 0,
            "latest_event_at": None,
            "message": f"Events table not yet available: {type(exc).__name__}",
        }


def _environment_hint() -> str:
    """Best-effort label so Hermes can tell which env it just queried.
    Uses GMAIL_USER_EMAIL since that's the most reliable distinguisher
    between staging (tanaymehta1705@) and production (lookoutfarm.bookings@)."""
    import os

    mailbox = (os.environ.get("GMAIL_USER_EMAIL") or "").lower()
    if "lookoutfarm" in mailbox:
        return "production"
    if "tanaymehta" in mailbox:
        return "staging"
    return mailbox or "unknown"


@app.get("/events")
def get_events(since: str | None = None, limit: int = 200):
    """Return recent events, newest first.

    Query params:
      since: ISO-8601 timestamp. Only events with occurred_at > since are returned.
      limit: max rows (default 200, max 1000).
    """
    from sqlalchemy import text

    capped = max(1, min(int(limit or 200), 1000))

    try:
        with session_scope() as s:
            if since:
                rows = s.execute(
                    text(
                        """
                        SELECT id, occurred_at, type, band_id, band_name, payload
                        FROM events
                        WHERE occurred_at > CAST(:since AS timestamptz)
                        ORDER BY occurred_at DESC, id DESC
                        LIMIT :lim
                        """
                    ),
                    {"since": since, "lim": capped},
                ).mappings().all()
            else:
                rows = s.execute(
                    text(
                        """
                        SELECT id, occurred_at, type, band_id, band_name, payload
                        FROM events
                        ORDER BY occurred_at DESC, id DESC
                        LIMIT :lim
                        """
                    ),
                    {"lim": capped},
                ).mappings().all()

            return {
                "events": [
                    {
                        "id": r["id"],
                        "occurred_at": r["occurred_at"].isoformat() if r["occurred_at"] else None,
                        "type": r["type"],
                        "band_id": str(r["band_id"]) if r["band_id"] else None,
                        "band_name": r["band_name"],
                        "payload": r["payload"] or {},
                    }
                    for r in rows
                ]
            }
    except Exception:  # noqa: BLE001
        # Feed is best-effort. Never 500 the route just because the table is missing.
        return {"events": [], "error": "events feed unavailable"}
