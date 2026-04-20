"""Band insights extractor.

Runs a single LLM call over a thread to pull out structured fields the
dashboard can render on a band card (genre, fee range, availability, etc.).
Cached on ``bands.insights`` and invalidated on ``last_activity_at`` changes.
"""

from __future__ import annotations

import json
import logging
import re
from dataclasses import asdict, dataclass, field

from sqlalchemy.orm import Session

from .config import get_settings
from .db.models import Band, EmailThread
from .reply_engine import get_thread_context

log = logging.getLogger(__name__)


@dataclass
class BandInsights:
    genre: str | None = None
    fee_range: str | None = None
    set_length_preference: str | None = None
    availability_notes: str | None = None
    website: str | None = None
    social_links: list[str] = field(default_factory=list)
    key_facts: list[str] = field(default_factory=list)

    def to_dict(self) -> dict:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: dict | None) -> "BandInsights":
        if not data:
            return cls()
        return cls(
            genre=data.get("genre"),
            fee_range=data.get("fee_range"),
            set_length_preference=data.get("set_length_preference"),
            availability_notes=data.get("availability_notes"),
            website=data.get("website"),
            social_links=list(data.get("social_links") or []),
            key_facts=list(data.get("key_facts") or []),
        )


EXTRACTION_PROMPT = """\
From this email thread, extract the following. If a field is not mentioned,
return null (or empty list for list fields). Do not guess.

Respond as a single JSON object with exactly these keys:
{
  "genre": "<music genre or style, or null>",
  "fee_range": "<fee discussed, e.g. '200-300' or '$400', or null>",
  "set_length_preference": "<'2hr' | '3hr' | 'flexible' | null>",
  "availability_notes": "<dates or months mentioned as available, or null>",
  "website": "<band website URL, or null>",
  "social_links": ["<social URLs: instagram/spotify/bandcamp/facebook>"],
  "key_facts": ["<2-3 short bullet points of anything else notable>"]
}

Return only the JSON object — no preamble, no markdown fencing.
"""


def extract_insights(s: Session, thread: EmailThread) -> BandInsights:
    """Run one LLM call over the thread, return structured insights."""
    settings = get_settings()

    if not settings.anthropic_api_key:
        log.warning("No ANTHROPIC_API_KEY set; skipping insights extraction")
        return BandInsights()

    thread_context = get_thread_context(s, thread)
    if not thread_context.strip():
        return BandInsights()

    try:
        import anthropic

        client = anthropic.Anthropic(api_key=settings.anthropic_api_key)
        resp = client.messages.create(
            model="claude-sonnet-4-20250514",
            max_tokens=600,
            messages=[
                {
                    "role": "user",
                    "content": f"Email thread:\n\n{thread_context}\n\n{EXTRACTION_PROMPT}",
                }
            ],
        )
        raw = resp.content[0].text.strip()
        payload = _parse_json_block(raw)
        return BandInsights.from_dict(payload)
    except Exception:  # noqa: BLE001
        log.exception("Insights extraction failed")
        return BandInsights()


def _parse_json_block(text: str) -> dict:
    """Tolerate models that wrap JSON in ```json fences or add a preamble."""
    fence = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", text, re.DOTALL)
    if fence:
        candidate = fence.group(1)
    else:
        start = text.find("{")
        end = text.rfind("}")
        candidate = text[start : end + 1] if start != -1 and end > start else text
    try:
        return json.loads(candidate)
    except json.JSONDecodeError:
        log.warning("Could not parse insights JSON: %r", text[:200])
        return {}


def get_or_refresh_insights(s: Session, band: Band, thread: EmailThread | None) -> BandInsights:
    """Return cached insights if fresh, otherwise re-extract and persist."""
    last_activity = band.last_activity_at
    last_extracted = band.insights_updated_at

    cache_fresh = (
        band.insights is not None
        and last_extracted is not None
        and (last_activity is None or last_extracted >= last_activity)
    )
    if cache_fresh:
        return BandInsights.from_dict(band.insights)

    if thread is None:
        return BandInsights.from_dict(band.insights)

    insights = extract_insights(s, thread)
    band.insights = insights.to_dict()
    band.insights_updated_at = last_activity  # tie cache validity to latest message time
    return insights
