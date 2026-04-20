"""Agent poll loop.

Each iteration:
  1) fetch new messages via the EmailProvider (since last cursor)
  2) ingest each through the pipeline (DB writes + optional auto-reply)
  3) persist the new cursor
"""

from __future__ import annotations

import logging
import signal
import sys
import time

from sqlalchemy import select

from .config import get_settings
from .db import session_scope
from .db.models import ProviderCursor
from .email import get_provider
from .pipeline import ingest_message

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)-5s %(name)s: %(message)s",
)
log = logging.getLogger("lookout")

_shutdown = False


def _handle_signal(signum, frame):  # noqa: ARG001
    global _shutdown
    log.info("Shutdown requested (signal %s)", signum)
    _shutdown = True


def _load_cursor(provider_name: str) -> str | None:
    with session_scope() as s:
        row = s.execute(
            select(ProviderCursor).where(ProviderCursor.provider == provider_name)
        ).scalar_one_or_none()
        return row.cursor if row else None


def _save_cursor(provider_name: str, cursor: str) -> None:
    with session_scope() as s:
        row = s.execute(
            select(ProviderCursor).where(ProviderCursor.provider == provider_name)
        ).scalar_one_or_none()
        if row is None:
            s.add(ProviderCursor(provider=provider_name, cursor=cursor))
        else:
            row.cursor = cursor


def poll_once() -> int:
    provider = get_provider()
    cursor = _load_cursor(provider.provider_name)
    log.info("Polling %s (cursor=%s)", provider.provider_name, cursor)
    messages, next_cursor = provider.list_new_messages(cursor)

    for m in messages:
        log.info(
            "[%s] %s | %s | %s",
            m.direction,
            m.from_address.email,
            m.subject,
            (m.snippet or "")[:80],
        )
        try:
            ingest_message(m, provider)
        except Exception:  # noqa: BLE001
            log.exception("Ingestion failed for message %s", m.provider_message_id)

    _save_cursor(provider.provider_name, next_cursor)
    log.info("Done: %d messages. cursor=%s", len(messages), next_cursor)
    return len(messages)


def main() -> None:
    signal.signal(signal.SIGINT, _handle_signal)
    signal.signal(signal.SIGTERM, _handle_signal)

    settings = get_settings()
    interval = settings.poll_interval_seconds
    log.info("Starting poll loop. Interval=%ss.", interval)

    while not _shutdown:
        try:
            poll_once()
        except Exception:  # noqa: BLE001
            log.exception("Poll iteration failed")
        for _ in range(interval):
            if _shutdown:
                break
            time.sleep(1)

    log.info("Exited cleanly.")


if __name__ == "__main__":
    sys.exit(main())
