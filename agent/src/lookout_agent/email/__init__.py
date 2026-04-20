from .provider import (
    Address,
    AttachmentRef,
    DraftRef,
    EmailProvider,
    NormalizedMessage,
    NormalizedThread,
)

__all__ = [
    "Address",
    "AttachmentRef",
    "DraftRef",
    "EmailProvider",
    "NormalizedMessage",
    "NormalizedThread",
]


def get_provider() -> EmailProvider:
    """Factory: select concrete EmailProvider based on settings."""
    from ..config import get_settings

    settings = get_settings()
    if settings.email_provider == "gmail":
        from .gmail import GmailProvider

        return GmailProvider()
    if settings.email_provider == "outlook":
        raise NotImplementedError("OutlookProvider not yet implemented")
    raise ValueError(f"Unknown email provider: {settings.email_provider}")
