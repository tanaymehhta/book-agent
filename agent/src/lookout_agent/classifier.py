"""Inbound email classifier.

Two-tier strategy:

1. **Rule-based fast path.** Reject obvious bulk / transactional / marketing
   mail without an LLM round-trip. Catches `noreply@`, common spam keywords,
   senders that look like mailing lists. Zero cost.

2. **LLM classifier (Claude Sonnet 4).** Everything that isn't obvious bulk
   gets a structured judgement from the LLM, primed with few-shot examples
   of real band inquiries vs. service pitches, marketing, etc.

Output is a `ClassificationResult` whose `confidence` aligns with the
pipeline's existing thresholds:
  * >= 0.85  → "definitely a band" → card + auto-reply
  * 0.55-0.80 → "maybe a band" → card created, no auto-reply
  * Classification.other → ignored entirely (never appears on the kanban)

Known senders (already in the bands table) skip classification entirely and
go straight to follow-up handling — same behavior as before.
"""

from __future__ import annotations

import json
import logging
import re
from dataclasses import dataclass

from .config import get_settings
from .db.enums import Classification
from .email.provider import NormalizedMessage

log = logging.getLogger(__name__)


# Obvious bulk / non-band signals. Hitting one of these short-circuits to
# Classification.other without an LLM call.
LIKELY_NOT_BAND_PHRASES = (
    # transactional
    "unsubscribe", "invoice", "receipt", "shipment", "order #",
    "tracking number", "verify your email", "password reset", "2fa", "otp",
    "confirm your email", "your account", "billing statement",
    # marketing / promotional
    "limited time offer", "flash sale", "% off", "free trial", "act now",
    "save up to", "exclusive deal", "promo code", "discount code",
    "newsletter", "weekly digest", "monthly digest", "subscribe to",
    # B2B service pitches
    "laundry service", "cleaning service", "pest control",
    "linen service", "uniform service", "waste management",
    "merchant services", "credit card processing", "pos system",
    "seo services", "search engine optimization",
    "lead generation", "we can help you grow",
    "wholesale supplier", "bulk pricing", "case study",
    # recruiting / sales
    "i came across your", "quick question for you",
    "5 minutes of your time", "schedule a demo", "book a demo",
    "calendly", "would love to chat about",
)

# Sender mailboxes that are basically never a band.
NON_PERSON_LOCAL_PARTS = (
    "noreply", "no-reply", "donotreply", "do-not-reply",
    "newsletter", "marketing", "mailer", "notifications", "notify",
    "support", "billing", "accounts", "invoice", "receipts",
    "info", "contact", "hello", "team", "office", "admin",
    "sales", "leads", "outreach",
)


# Strong positive signal — if 3+ of these appear we're very likely a real
# band inquiry and can skip the LLM. Costs nothing.
STRONG_BAND_KEYWORDS = (
    "band", "gig", "epk", "bandcamp", "soundcloud", "spotify",
    "set list", "setlist", "acoustic", "live music", "live performance",
    "booking inquiry", "play your venue", "play the taproom",
)


@dataclass(frozen=True)
class ClassificationResult:
    classification: Classification
    confidence: float  # 0..1
    reason: str = ""


def classify_inbound(
    msg: NormalizedMessage, known_sender: bool, sender_on_roster: bool = False
) -> ClassificationResult:
    """Decide whether an inbound is a band inquiry, ambiguous, or not a band."""
    if known_sender:
        return ClassificationResult(
            Classification.roster_followup if sender_on_roster else Classification.pipeline_followup,
            1.0,
            "Known sender",
        )

    body = (msg.body_text or "").strip()
    subject = (msg.subject or "").strip()
    blob = f"{subject}\n{body}".lower()
    local_part = msg.from_address.email.split("@", 1)[0].lower()

    # ── Tier 1: obvious bulk / non-person senders ──
    if any(local_part == np or local_part.startswith(f"{np}+") or local_part.startswith(f"{np}-")
           for np in NON_PERSON_LOCAL_PARTS):
        return ClassificationResult(
            Classification.other, 0.05,
            f"Sender local-part {local_part!r} is a non-person mailbox",
        )

    if any(phrase in blob for phrase in LIKELY_NOT_BAND_PHRASES):
        matched = next(p for p in LIKELY_NOT_BAND_PHRASES if p in blob)
        return ClassificationResult(
            Classification.other, 0.10,
            f"Matched non-band phrase {matched!r}",
        )

    # ── Tier 2: obvious band inquiry — skip LLM, save a call ──
    strong_hits = sum(1 for k in STRONG_BAND_KEYWORDS if k in blob)
    if strong_hits >= 3:
        return ClassificationResult(
            Classification.new_inquiry, 0.95,
            f"Matched {strong_hits} strong band keywords",
        )

    # ── Tier 3: LLM classifier for the ambiguous middle ──
    settings = get_settings()
    if not settings.anthropic_api_key:
        log.warning("No ANTHROPIC_API_KEY; falling back to keyword heuristic")
        return _keyword_fallback(blob)

    try:
        return _llm_classify(subject, body, msg.from_address.email)
    except Exception:  # noqa: BLE001
        log.exception("LLM classifier failed; falling back to keyword heuristic")
        return _keyword_fallback(blob)


# ---------------------------------------------------------------------------


LLM_CLASSIFIER_PROMPT = """\
You are screening inbound emails for the booking inbox of Lookout Farm
Brewing & Cider Co. — a taproom that books live music acts.

Decide whether an email is:
  • "band"  — a real musician/band/duo/solo artist/DJ inquiring about
              playing a gig at the taproom. Often mentions: dates,
              availability, set length, fee, genre, a band name,
              EPK / streaming links, "your venue", "your taproom".
  • "maybe" — could be a band inquiry but unclear (very short message,
              missing band-specific details). When in doubt between
              "band" and "maybe", pick "maybe".
  • "other" — anything else: vendor/service pitches (laundry, cleaning,
              POS, SEO, lead-gen), marketing, newsletters, recruiters,
              press releases, personal/customer messages to the taproom
              (asking about hours, food, reservations), spam.

Output exactly one JSON object, no markdown fencing, no preamble:
{
  "classification": "band" | "maybe" | "other",
  "confidence": <float 0.0-1.0>,
  "reason": "<one short sentence>"
}

Examples:

FROM: jamie@thecoolband.com
SUBJECT: Booking inquiry - The Cool Band
BODY: Hi! We're a 4-piece indie rock band from Boston, would love to
play your taproom. We're available most Saturdays in May/June, our
fee is $400 for a 3-hour set. Here's our EPK: thecoolband.com/epk
---
{"classification":"band","confidence":0.97,"reason":"Explicit booking inquiry with band name, dates, fee, and EPK"}

FROM: contact@cleanlaundryco.com
SUBJECT: Save 20% on your linen service
BODY: Hi there, we noticed your taproom and wanted to offer our
premium linen and laundry services...
---
{"classification":"other","confidence":0.98,"reason":"B2B service pitch (linen/laundry)"}

FROM: sam@example.com
SUBJECT: hey
BODY: hi, are you booking shows? I sing and play guitar.
---
{"classification":"band","confidence":0.82,"reason":"Short but explicit musician asking about booking"}

FROM: ops@somerestaurant.com
SUBJECT: Quick question
BODY: Hey, do you guys do private events on weekday afternoons?
---
{"classification":"other","confidence":0.9,"reason":"Customer asking about private events, not a band"}

FROM: alex@gmail.com
SUBJECT: Hi
BODY: Saw you have live music. I'm a musician.
---
{"classification":"maybe","confidence":0.65,"reason":"Says they're a musician but no booking ask, no band name, no details"}

Now classify this email:
"""


def _llm_classify(subject: str, body: str, sender_email: str) -> ClassificationResult:
    import anthropic

    settings = get_settings()
    client = anthropic.Anthropic(api_key=settings.anthropic_api_key)

    # Trim body to keep token cost predictable
    snippet = body[:2000]
    user_content = (
        f"{LLM_CLASSIFIER_PROMPT}\n\n"
        f"FROM: {sender_email}\n"
        f"SUBJECT: {subject}\n"
        f"BODY: {snippet}\n---"
    )

    resp = client.messages.create(
        model="claude-sonnet-4-20250514",
        max_tokens=200,
        messages=[{"role": "user", "content": user_content}],
    )
    raw = resp.content[0].text.strip()
    payload = _extract_json(raw)

    label = str(payload.get("classification", "")).lower()
    confidence = float(payload.get("confidence", 0.0))
    reason = str(payload.get("reason", ""))[:200]

    if label == "band":
        # Floor + ceiling so we land in the auto-reply bucket on real bands.
        return ClassificationResult(
            Classification.new_inquiry,
            max(0.85, min(confidence, 0.99)),
            reason,
        )
    if label == "maybe":
        # Land in the "create card, no auto-reply" bucket.
        return ClassificationResult(
            Classification.new_inquiry,
            min(max(confidence, 0.55), 0.75),
            reason,
        )
    return ClassificationResult(
        Classification.other,
        max(0.05, min(confidence, 0.3)),
        reason or "LLM judged not a band inquiry",
    )


def _extract_json(text: str) -> dict:
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
        log.warning("Could not parse classifier JSON: %r", text[:200])
        return {}


def _keyword_fallback(blob: str) -> ClassificationResult:
    """Last-resort heuristic if the LLM is unreachable."""
    hits = sum(1 for k in STRONG_BAND_KEYWORDS if k in blob)
    if hits >= 2:
        return ClassificationResult(Classification.new_inquiry, 0.7, "Keyword fallback (≥2 strong hits)")
    if hits == 1:
        return ClassificationResult(Classification.new_inquiry, 0.55, "Keyword fallback (1 strong hit)")
    return ClassificationResult(Classification.other, 0.2, "Keyword fallback (no strong hits)")
