"""Append-only activity log for external monitors (Hermes / Telegram).

Design contract:
- `emit_event()` MUST NEVER raise. The email pipeline is the product;
  observability is a nice-to-have. If the events table is missing, the
  DB is unreachable, or the payload is malformed, we swallow the error
  and log a warning. Callers do not need try/except around emit_event.
- Events are append-only. No updates, no deletes from app code.
- Writes happen in a brand-new short-lived session, independent of any
  caller's session_scope, so a rollback in the caller cannot lose events,
  and a failed event write cannot poison the caller's transaction.
"""
from __future__ import annotations

import json
import logging
from typing import Any
from uuid import UUID

from sqlalchemy import text

from .db.session import get_engine

log = logging.getLogger(__name__)


def emit_event(
    event_type: str,
    *,
    band_id: UUID | str | None = None,
    band_name: str | None = None,
    **payload: Any,
) -> None:
    """Record one event. Never raises.

    Args:
        event_type: short identifier like "band_created", "laura_sent".
        band_id: optional band UUID this event is about.
        band_name: optional band display name, denormalized for readability.
        **payload: arbitrary JSON-serializable extras.
    """
    try:
        engine = get_engine()
        with engine.begin() as conn:
            conn.execute(
                text(
                    """
                    INSERT INTO events (type, band_id, band_name, payload)
                    VALUES (:type, :band_id, :band_name, CAST(:payload AS jsonb))
                    """
                ),
                {
                    "type": event_type,
                    "band_id": str(band_id) if band_id is not None else None,
                    "band_name": band_name,
                    "payload": json.dumps(payload or {}, default=str),
                },
            )
    except Exception:  # noqa: BLE001
        # Observability MUST NOT break the product. Log and move on.
        log.warning("emit_event(%s) failed; continuing", event_type, exc_info=True)
