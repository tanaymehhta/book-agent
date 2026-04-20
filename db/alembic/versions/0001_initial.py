"""initial schema

Revision ID: 0001
Revises:
Create Date: 2026-04-17

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS citext")
    op.execute("CREATE EXTENSION IF NOT EXISTS pgcrypto")

    op.execute(
        "CREATE TYPE band_status AS ENUM ('incoming','in_conversation','approved','archived')"
    )
    op.execute("CREATE TYPE archive_reason AS ENUM ('declined','ghosted','bad_fit','other')")
    op.execute("CREATE TYPE message_direction AS ENUM ('inbound','outbound')")
    op.execute(
        "CREATE TYPE classification AS ENUM ('new_inquiry','pipeline_followup','roster_followup','other')"
    )
    op.execute("CREATE TYPE draft_status AS ENUM ('pending','approved','sent','discarded')")
    op.execute("CREATE TYPE draft_created_by AS ENUM ('agent','human')")
    op.execute("CREATE TYPE note_author AS ENUM ('agent','laura')")
    op.execute("CREATE TYPE agent_run_trigger AS ENUM ('poll','daily','manual')")

    band_status = postgresql.ENUM(name="band_status", create_type=False)
    archive_reason = postgresql.ENUM(name="archive_reason", create_type=False)
    message_direction = postgresql.ENUM(name="message_direction", create_type=False)
    classification = postgresql.ENUM(name="classification", create_type=False)
    draft_status = postgresql.ENUM(name="draft_status", create_type=False)
    draft_created_by = postgresql.ENUM(name="draft_created_by", create_type=False)
    note_author = postgresql.ENUM(name="note_author", create_type=False)
    agent_run_trigger = postgresql.ENUM(name="agent_run_trigger", create_type=False)

    op.create_table(
        "bands",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("name", sa.Text),
        sa.Column("contact_name", sa.Text),
        sa.Column("primary_email", postgresql.CITEXT(), unique=True),
        sa.Column("phone", sa.Text),
        sa.Column("status", band_status, nullable=False, server_default="incoming"),
        sa.Column("archive_reason", archive_reason),
        sa.Column("on_roster", sa.Boolean, nullable=False, server_default=sa.false()),
        sa.Column("draft_ready", sa.Boolean, nullable=False, server_default=sa.false()),
        sa.Column("music_links", postgresql.JSONB, nullable=False, server_default=sa.text("'[]'::jsonb")),
        sa.Column("typical_fee_cents", sa.Integer),
        sa.Column("draw_notes", sa.Text),
        sa.Column("first_contact_at", sa.DateTime(timezone=True)),
        sa.Column("last_activity_at", sa.DateTime(timezone=True)),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("NOW()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("NOW()")),
    )
    op.create_index("ix_bands_status_activity", "bands", ["status", sa.text("last_activity_at DESC")])
    op.create_index(
        "ix_bands_on_roster",
        "bands",
        ["on_roster"],
        postgresql_where=sa.text("on_roster = true"),
    )

    op.create_table(
        "band_emails",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("band_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("bands.id", ondelete="CASCADE"), nullable=False),
        sa.Column("email", postgresql.CITEXT(), nullable=False, unique=True),
        sa.Column("is_primary", sa.Boolean, nullable=False, server_default=sa.false()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("NOW()")),
    )

    op.create_table(
        "email_threads",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("band_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("bands.id", ondelete="CASCADE"), nullable=False),
        sa.Column("provider", sa.Text, nullable=False),
        sa.Column("provider_thread_id", sa.Text, nullable=False),
        sa.Column("subject", sa.Text),
        sa.Column("first_message_at", sa.DateTime(timezone=True)),
        sa.Column("last_message_at", sa.DateTime(timezone=True)),
        sa.UniqueConstraint("provider", "provider_thread_id", name="uq_threads_provider_tid"),
    )
    op.create_index("ix_threads_band", "email_threads", ["band_id"])

    op.create_table(
        "messages",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("thread_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("email_threads.id", ondelete="CASCADE"), nullable=False),
        sa.Column("provider_message_id", sa.Text, nullable=False, unique=True),
        sa.Column("direction", message_direction, nullable=False),
        sa.Column("from_address", postgresql.CITEXT()),
        sa.Column("to_addresses", postgresql.JSONB, nullable=False, server_default=sa.text("'[]'::jsonb")),
        sa.Column("cc_addresses", postgresql.JSONB, nullable=False, server_default=sa.text("'[]'::jsonb")),
        sa.Column("subject", sa.Text),
        sa.Column("body_text", sa.Text),
        sa.Column("body_html", sa.Text),
        sa.Column("snippet", sa.Text),
        sa.Column("sent_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("headers", postgresql.JSONB, nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("classification", classification),
        sa.Column("auto_sent", sa.Boolean, nullable=False, server_default=sa.false()),
    )
    op.create_index("ix_messages_thread_sent", "messages", ["thread_id", "sent_at"])

    op.create_table(
        "drafts",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("band_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("bands.id", ondelete="CASCADE"), nullable=False),
        sa.Column("thread_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("email_threads.id", ondelete="CASCADE")),
        sa.Column("provider", sa.Text, nullable=False),
        sa.Column("provider_draft_id", sa.Text, nullable=False, unique=True),
        sa.Column("body_text", sa.Text, nullable=False),
        sa.Column("status", draft_status, nullable=False, server_default="pending"),
        sa.Column("created_by", draft_created_by, nullable=False, server_default="agent"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("NOW()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("NOW()")),
        sa.Column("approved_at", sa.DateTime(timezone=True)),
        sa.Column("sent_at", sa.DateTime(timezone=True)),
        sa.Column("sent_message_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("messages.id", ondelete="SET NULL")),
    )
    op.create_index(
        "ix_drafts_band_pending",
        "drafts",
        ["band_id"],
        postgresql_where=sa.text("status = 'pending'"),
    )

    op.create_table(
        "notes",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("band_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("bands.id", ondelete="CASCADE"), nullable=False),
        sa.Column("body", sa.Text, nullable=False),
        sa.Column("author", note_author, nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("NOW()")),
    )

    op.create_table(
        "roster_entries",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("band_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("bands.id", ondelete="CASCADE"), nullable=False, unique=True),
        sa.Column("added_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("NOW()")),
        sa.Column("last_gig_date", sa.Date),
        sa.Column("gigs_count", sa.Integer, nullable=False, server_default="0"),
        sa.Column("typical_fee_cents", sa.Integer),
        sa.Column("notes", sa.Text),
    )

    op.create_table(
        "gigs",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("band_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("bands.id", ondelete="CASCADE"), nullable=False),
        sa.Column("gig_date", sa.Date, nullable=False),
        sa.Column("fee_cents", sa.Integer),
        sa.Column("set_length_minutes", sa.Integer),
        sa.Column("notes", sa.Text),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("NOW()")),
    )

    op.create_table(
        "provider_cursors",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("provider", sa.Text, nullable=False, unique=True),
        sa.Column("cursor", sa.Text),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("NOW()")),
    )

    op.create_table(
        "attachments",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("message_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("messages.id", ondelete="CASCADE"), nullable=False),
        sa.Column("filename", sa.Text, nullable=False),
        sa.Column("content_type", sa.Text),
        sa.Column("size_bytes", sa.Integer),
        sa.Column("provider_attachment_id", sa.Text),
        sa.Column("storage_path", sa.Text),
    )

    op.create_table(
        "ignored_messages",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("provider", sa.Text, nullable=False),
        sa.Column("provider_message_id", sa.Text, nullable=False, unique=True),
        sa.Column("from_address", postgresql.CITEXT()),
        sa.Column("subject", sa.Text),
        sa.Column("classification", classification),
        sa.Column("sent_at", sa.DateTime(timezone=True)),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("NOW()")),
    )

    op.create_table(
        "agent_runs",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("NOW()")),
        sa.Column("ended_at", sa.DateTime(timezone=True)),
        sa.Column("trigger", agent_run_trigger, nullable=False),
        sa.Column("messages_processed", sa.Integer, nullable=False, server_default="0"),
        sa.Column("errors", postgresql.JSONB, nullable=False, server_default=sa.text("'[]'::jsonb")),
    )

    op.create_table(
        "templates",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("key", sa.Text, nullable=False, unique=True),
        sa.Column("body", sa.Text, nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("NOW()")),
    )

    op.execute(
        """
        INSERT INTO templates (key, body) VALUES
        ('signature',
         E'Laura Neville\nMarketing Director\nBelkin Family Lookout Farm\nLookout Farm Brewing & Cider Co.'),
        ('scoop',
         'Live Music in the Taproom typically starts at 6pm and is either a 2 or 3 hour set. Bands are required to bring their own PA, mics, cables, equipment, etc. and we ask that they help promote to their friends, family, and fans. We also ask that volume is kept in check and love it when bands have electronic drums or the ability to keep the total volume under control.')
        """
    )


def downgrade() -> None:
    for t in (
        "templates",
        "agent_runs",
        "ignored_messages",
        "attachments",
        "provider_cursors",
        "gigs",
        "roster_entries",
        "notes",
        "drafts",
        "messages",
        "email_threads",
        "band_emails",
        "bands",
    ):
        op.drop_table(t)
    for n in (
        "agent_run_trigger",
        "note_author",
        "draft_created_by",
        "draft_status",
        "classification",
        "message_direction",
        "archive_reason",
        "band_status",
    ):
        op.execute(f"DROP TYPE IF EXISTS {n}")
