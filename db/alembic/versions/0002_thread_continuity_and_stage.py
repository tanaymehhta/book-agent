"""thread continuity + conversation stage + review flag

Revision ID: 0002
Revises: 0001
Create Date: 2026-04-20

Adds:
- messages.internet_message_id (indexed, for In-Reply-To fallback linking)
- messages.in_reply_to (for thread repair)
- bands.conversation_stage (internal agent decision state)
- bands.needs_review (flag for ambiguous cases)
"""
from alembic import op
import sqlalchemy as sa

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        "CREATE TYPE conversation_stage AS ENUM "
        "('new_lead','collecting_details','negotiating_terms','pending_confirmation','confirmed')"
    )

    op.add_column("messages", sa.Column("internet_message_id", sa.Text))
    op.add_column("messages", sa.Column("in_reply_to", sa.Text))
    op.create_index("ix_messages_internet_msg_id", "messages", ["internet_message_id"])
    op.create_index("ix_messages_in_reply_to", "messages", ["in_reply_to"])

    conv_stage = sa.Enum(name="conversation_stage", create_type=False)
    op.add_column(
        "bands",
        sa.Column("conversation_stage", conv_stage, server_default="new_lead"),
    )
    op.add_column(
        "bands",
        sa.Column("needs_review", sa.Boolean, nullable=False, server_default=sa.false()),
    )


def downgrade() -> None:
    op.drop_column("bands", "needs_review")
    op.drop_column("bands", "conversation_stage")
    op.drop_index("ix_messages_in_reply_to", table_name="messages")
    op.drop_index("ix_messages_internet_msg_id", table_name="messages")
    op.drop_column("messages", "in_reply_to")
    op.drop_column("messages", "internet_message_id")
    op.execute("DROP TYPE IF EXISTS conversation_stage")
