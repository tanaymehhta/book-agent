from __future__ import annotations

from datetime import date, datetime
from uuid import UUID

from sqlalchemy import (
    Boolean,
    Date,
    DateTime,
    Enum as SAEnum,
    ForeignKey,
    Integer,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import CITEXT, JSONB, UUID as PGUUID
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship

from .enums import (
    AgentRunTrigger,
    ArchiveReason,
    BandStatus,
    Classification,
    ConversationStage,
    DraftCreatedBy,
    DraftStatus,
    MessageDirection,
    NoteAuthor,
)


def _pg_enum(py_enum, name: str):
    """Use an already-created Postgres enum type (migration owns creation)."""
    return SAEnum(py_enum, name=name, create_type=False, native_enum=True, values_callable=lambda e: [m.value for m in e])


class Base(DeclarativeBase):
    pass


class Band(Base):
    __tablename__ = "bands"

    id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid())
    name: Mapped[str | None] = mapped_column(Text)
    contact_name: Mapped[str | None] = mapped_column(Text)
    primary_email: Mapped[str | None] = mapped_column(CITEXT(), unique=True)
    phone: Mapped[str | None] = mapped_column(Text)
    status: Mapped[BandStatus] = mapped_column(_pg_enum(BandStatus, "band_status"), nullable=False, server_default="incoming")
    archive_reason: Mapped[ArchiveReason | None] = mapped_column(_pg_enum(ArchiveReason, "archive_reason"))
    on_roster: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default="false")
    draft_ready: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default="false")
    needs_review: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default="false")
    conversation_stage: Mapped[ConversationStage | None] = mapped_column(
        _pg_enum(ConversationStage, "conversation_stage"), server_default="new_lead"
    )
    music_links: Mapped[list] = mapped_column(JSONB, nullable=False, server_default="[]")
    w9_name: Mapped[str | None] = mapped_column(Text)
    bio: Mapped[str | None] = mapped_column(Text)
    social_links: Mapped[list] = mapped_column(JSONB, nullable=False, server_default="[]")
    typical_fee_cents: Mapped[int | None] = mapped_column(Integer)
    draw_notes: Mapped[str | None] = mapped_column(Text)
    first_contact_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_activity_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    insights: Mapped[dict | None] = mapped_column(JSONB)
    insights_updated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())

    threads: Mapped[list[EmailThread]] = relationship(back_populates="band", cascade="all, delete-orphan")
    emails: Mapped[list[BandEmail]] = relationship(back_populates="band", cascade="all, delete-orphan")
    drafts: Mapped[list[Draft]] = relationship(back_populates="band", cascade="all, delete-orphan")


class BandEmail(Base):
    __tablename__ = "band_emails"

    id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid())
    band_id: Mapped[UUID] = mapped_column(ForeignKey("bands.id", ondelete="CASCADE"), nullable=False)
    email: Mapped[str] = mapped_column(CITEXT(), nullable=False, unique=True)
    is_primary: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default="false")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())

    band: Mapped[Band] = relationship(back_populates="emails")


class EmailThread(Base):
    __tablename__ = "email_threads"
    __table_args__ = (UniqueConstraint("provider", "provider_thread_id", name="uq_threads_provider_tid"),)

    id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid())
    band_id: Mapped[UUID] = mapped_column(ForeignKey("bands.id", ondelete="CASCADE"), nullable=False)
    provider: Mapped[str] = mapped_column(Text, nullable=False)
    provider_thread_id: Mapped[str] = mapped_column(Text, nullable=False)
    subject: Mapped[str | None] = mapped_column(Text)
    first_message_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_message_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    band: Mapped[Band] = relationship(back_populates="threads")
    messages: Mapped[list[Message]] = relationship(back_populates="thread", cascade="all, delete-orphan")


class Message(Base):
    __tablename__ = "messages"

    id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid())
    thread_id: Mapped[UUID] = mapped_column(ForeignKey("email_threads.id", ondelete="CASCADE"), nullable=False)
    provider_message_id: Mapped[str] = mapped_column(Text, nullable=False, unique=True)
    internet_message_id: Mapped[str | None] = mapped_column(Text)
    in_reply_to: Mapped[str | None] = mapped_column(Text)
    direction: Mapped[MessageDirection] = mapped_column(_pg_enum(MessageDirection, "message_direction"), nullable=False)
    from_address: Mapped[str | None] = mapped_column(CITEXT())
    to_addresses: Mapped[list] = mapped_column(JSONB, nullable=False, server_default="[]")
    cc_addresses: Mapped[list] = mapped_column(JSONB, nullable=False, server_default="[]")
    subject: Mapped[str | None] = mapped_column(Text)
    body_text: Mapped[str | None] = mapped_column(Text)
    body_html: Mapped[str | None] = mapped_column(Text)
    snippet: Mapped[str | None] = mapped_column(Text)
    sent_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    headers: Mapped[dict] = mapped_column(JSONB, nullable=False, server_default="{}")
    classification: Mapped[Classification | None] = mapped_column(_pg_enum(Classification, "classification"))
    auto_sent: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default="false")

    thread: Mapped[EmailThread] = relationship(back_populates="messages")


class Draft(Base):
    __tablename__ = "drafts"

    id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid())
    band_id: Mapped[UUID] = mapped_column(ForeignKey("bands.id", ondelete="CASCADE"), nullable=False)
    thread_id: Mapped[UUID | None] = mapped_column(ForeignKey("email_threads.id", ondelete="CASCADE"))
    provider: Mapped[str] = mapped_column(Text, nullable=False)
    provider_draft_id: Mapped[str] = mapped_column(Text, nullable=False, unique=True)
    body_text: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[DraftStatus] = mapped_column(_pg_enum(DraftStatus, "draft_status"), nullable=False, server_default="pending")
    created_by: Mapped[DraftCreatedBy] = mapped_column(_pg_enum(DraftCreatedBy, "draft_created_by"), nullable=False, server_default="agent")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    approved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    sent_message_id: Mapped[UUID | None] = mapped_column(ForeignKey("messages.id", ondelete="SET NULL"))

    band: Mapped[Band] = relationship(back_populates="drafts")


class Note(Base):
    __tablename__ = "notes"

    id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid())
    band_id: Mapped[UUID] = mapped_column(ForeignKey("bands.id", ondelete="CASCADE"), nullable=False)
    body: Mapped[str] = mapped_column(Text, nullable=False)
    author: Mapped[NoteAuthor] = mapped_column(_pg_enum(NoteAuthor, "note_author"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())


class RosterEntry(Base):
    __tablename__ = "roster_entries"

    id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid())
    band_id: Mapped[UUID] = mapped_column(ForeignKey("bands.id", ondelete="CASCADE"), nullable=False, unique=True)
    added_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    last_gig_date: Mapped[date | None] = mapped_column(Date)
    gigs_count: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0")
    typical_fee_cents: Mapped[int | None] = mapped_column(Integer)
    notes: Mapped[str | None] = mapped_column(Text)


class Gig(Base):
    __tablename__ = "gigs"

    id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid())
    band_id: Mapped[UUID] = mapped_column(ForeignKey("bands.id", ondelete="CASCADE"), nullable=False)
    gig_date: Mapped[date] = mapped_column(Date, nullable=False)
    fee_cents: Mapped[int | None] = mapped_column(Integer)
    set_length_minutes: Mapped[int | None] = mapped_column(Integer)
    notes: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())


class ProviderCursor(Base):
    __tablename__ = "provider_cursors"

    id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid())
    provider: Mapped[str] = mapped_column(Text, nullable=False, unique=True)
    cursor: Mapped[str | None] = mapped_column(Text)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())


class Attachment(Base):
    __tablename__ = "attachments"

    id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid())
    message_id: Mapped[UUID] = mapped_column(ForeignKey("messages.id", ondelete="CASCADE"), nullable=False)
    filename: Mapped[str] = mapped_column(Text, nullable=False)
    content_type: Mapped[str | None] = mapped_column(Text)
    size_bytes: Mapped[int | None] = mapped_column(Integer)
    provider_attachment_id: Mapped[str | None] = mapped_column(Text)
    storage_path: Mapped[str | None] = mapped_column(Text)


class IgnoredMessage(Base):
    __tablename__ = "ignored_messages"

    id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid())
    provider: Mapped[str] = mapped_column(Text, nullable=False)
    provider_message_id: Mapped[str] = mapped_column(Text, nullable=False, unique=True)
    from_address: Mapped[str | None] = mapped_column(CITEXT())
    subject: Mapped[str | None] = mapped_column(Text)
    classification: Mapped[Classification | None] = mapped_column(_pg_enum(Classification, "classification"))
    sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())


class AgentRun(Base):
    __tablename__ = "agent_runs"

    id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid())
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
    ended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    trigger: Mapped[AgentRunTrigger] = mapped_column(_pg_enum(AgentRunTrigger, "agent_run_trigger"), nullable=False)
    messages_processed: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0")
    errors: Mapped[list] = mapped_column(JSONB, nullable=False, server_default="[]")


class Template(Base):
    __tablename__ = "templates"

    id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid())
    key: Mapped[str] = mapped_column(Text, nullable=False, unique=True)
    body: Mapped[str] = mapped_column(Text, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
