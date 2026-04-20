"""Lightweight rule-based classifier for V1.

Day-3 scope: enough signal to decide auto-reply vs. ignore. Will be replaced
or augmented by an LLM classifier once the end-to-end loop is proven.
"""

from __future__ import annotations

from dataclasses import dataclass

from .db.enums import Classification
from .email.provider import NormalizedMessage

BAND_KEYWORDS = (
    "book", "booking", "gig", "play", "playing", "band", "music", "perform",
    "performance", "live", "set", "show", "dates", "availability", "venue",
    "taproom", "acoustic", "solo", "duo", "trio", "dj", "epk", "bandcamp",
    "soundcloud", "spotify", "youtube",
)

LIKELY_NOT_BAND = (
    "unsubscribe", "invoice", "receipt", "shipment", "order #", "tracking number",
    "verify your email", "password reset", "2fa", "otp",
)


@dataclass(frozen=True)
class ClassificationResult:
    classification: Classification
    confidence: float  # 0..1


def classify_inbound(
    msg: NormalizedMessage, known_sender: bool, sender_on_roster: bool = False
) -> ClassificationResult:
    if known_sender:
        return ClassificationResult(
            Classification.roster_followup if sender_on_roster else Classification.pipeline_followup,
            1.0,
        )

    blob = f"{msg.subject}\n{msg.body_text}".lower()

    if any(term in blob for term in LIKELY_NOT_BAND):
        return ClassificationResult(Classification.other, 0.2)

    hits = sum(1 for k in BAND_KEYWORDS if k in blob)

    if hits >= 3:
        return ClassificationResult(Classification.new_inquiry, 0.95)
    if hits == 2:
        return ClassificationResult(Classification.new_inquiry, 0.8)
    if hits == 1:
        return ClassificationResult(Classification.new_inquiry, 0.55)
    return ClassificationResult(Classification.other, 0.25)
