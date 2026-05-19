"""One-line message summaries shown on band cards.

The raw Gmail snippet often contains HTML entities (`&#39;`, `&amp;`) and
cuts off mid-sentence, which looks ugly in the dashboard. This module
generates a clean one-line summary using Haiku.
"""
from __future__ import annotations

import logging

from .config import get_settings

log = logging.getLogger(__name__)

PROMPT = """Summarize the email below in one short sentence (max 90 characters).
Write from the sender's perspective. No quotes, no preamble, no trailing period.

Subject: {subject}
From: {sender}
Direction: {direction}

Body:
{body}
"""


def summarize_message(
    *,
    subject: str | None,
    sender: str | None,
    direction: str,
    body_text: str | None,
    fallback: str | None = None,
) -> str | None:
    """Return a one-line summary, or `fallback` if the LLM is unavailable."""
    settings = get_settings()
    if not settings.anthropic_api_key:
        return fallback

    body = (body_text or "").strip()
    if not body:
        return fallback
    if len(body) > 4000:
        body = body[:4000]

    try:
        import anthropic

        client = anthropic.Anthropic(api_key=settings.anthropic_api_key)
        resp = client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=80,
            messages=[
                {
                    "role": "user",
                    "content": PROMPT.format(
                        subject=subject or "(no subject)",
                        sender=sender or "(unknown)",
                        direction=direction,
                        body=body,
                    ),
                }
            ],
        )
        text = resp.content[0].text.strip()
        text = text.splitlines()[0].strip().strip('"').strip("'").rstrip(".")
        return text or fallback
    except Exception:  # noqa: BLE001
        log.exception("Summary generation failed")
        return fallback
