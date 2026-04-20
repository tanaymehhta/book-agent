"""Provider-agnostic email interface. Agent code depends on EmailProvider only."""

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from datetime import datetime


@dataclass(frozen=True)
class Address:
    email: str
    name: str | None = None


@dataclass(frozen=True)
class AttachmentRef:
    provider_attachment_id: str
    filename: str
    content_type: str
    size_bytes: int


@dataclass(frozen=True)
class NormalizedMessage:
    provider_message_id: str
    provider_thread_id: str
    from_address: Address
    to_addresses: list[Address]
    cc_addresses: list[Address]
    subject: str
    body_text: str
    body_html: str | None
    snippet: str
    sent_at: datetime
    in_reply_to: str | None
    internet_message_id: str
    headers: dict[str, str]
    attachments: list[AttachmentRef] = field(default_factory=list)
    # Provider-neutral way to know which box this landed in.
    # "inbound" = received; "outbound" = sent from the monitored mailbox (Sent folder).
    direction: str = "inbound"


@dataclass(frozen=True)
class NormalizedThread:
    provider_thread_id: str
    subject: str
    messages: list[NormalizedMessage]  # oldest -> newest


@dataclass(frozen=True)
class DraftRef:
    provider_draft_id: str
    provider_thread_id: str | None


class EmailProvider(ABC):
    """Abstract email backend. Gmail today; Microsoft Graph tomorrow.

    The agent and the rest of the system must only depend on this interface
    and the dataclasses above. No provider-specific payloads leak through.
    """

    provider_name: str  # concrete classes set this ("gmail", "outlook", ...)

    # ---- Ingestion ---------------------------------------------------------

    @abstractmethod
    def list_new_messages(
        self, cursor: str | None
    ) -> tuple[list[NormalizedMessage], str]:
        """Return (new messages since cursor, next cursor).

        Includes both inbound (received) and outbound (Sent folder) messages,
        so the system can detect manual replies sent from a native client and
        advance Kanban state accordingly.

        `cursor` is opaque: Gmail historyId, Graph deltaLink, etc. Pass the
        returned cursor verbatim on the next call.
        """

    @abstractmethod
    def get_thread(self, provider_thread_id: str) -> NormalizedThread:
        """Fetch the full thread, oldest message first."""

    # ---- Sending -----------------------------------------------------------

    @abstractmethod
    def send_message(
        self,
        to: list[str],
        subject: str,
        body_text: str,
        reply_to_thread_id: str | None = None,
        cc: list[str] | None = None,
    ) -> NormalizedMessage:
        """Send a message. Returns the normalized sent message so the caller
        can persist it.

        If `reply_to_thread_id` is set, the message is threaded as a reply.
        """

    # ---- Drafts (source of truth lives in the provider) -------------------

    @abstractmethod
    def create_draft(
        self,
        body_text: str,
        reply_to_thread_id: str | None = None,
        to: list[str] | None = None,
        subject: str | None = None,
        cc: list[str] | None = None,
    ) -> DraftRef:
        """Create a provider-side draft and return its ref."""

    @abstractmethod
    def update_draft(self, provider_draft_id: str, body_text: str) -> None:
        """Replace the body of an existing draft."""

    @abstractmethod
    def get_draft(self, provider_draft_id: str) -> str:
        """Return the current body text of a draft (source-of-truth read)."""

    @abstractmethod
    def send_draft(self, provider_draft_id: str) -> NormalizedMessage:
        """Send the draft as-is. Returns the resulting sent message."""

    @abstractmethod
    def discard_draft(self, provider_draft_id: str) -> None:
        """Delete a draft without sending."""

    # ---- Attachments -------------------------------------------------------

    @abstractmethod
    def download_attachment(
        self, provider_message_id: str, provider_attachment_id: str
    ) -> bytes:
        """Fetch attachment bytes on demand."""
