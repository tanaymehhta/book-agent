"""events table

Revision ID: 0006
Revises: 0005
Create Date: 2026-05-19

Adds:
- events table — append-only activity log for external monitors (Hermes).
  Purely additive. No existing table or column is touched.
  Emit failures in application code are swallowed (see events.py), so a
  missing or broken events table can never break the email pipeline.
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0006"
down_revision = "0005"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "events",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column(
            "occurred_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column("type", sa.Text(), nullable=False),
        sa.Column("band_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("band_name", sa.Text(), nullable=True),
        sa.Column(
            "payload",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),
    )
    op.create_index("ix_events_occurred_at", "events", ["occurred_at"])
    op.create_index("ix_events_type", "events", ["type"])


def downgrade() -> None:
    op.drop_index("ix_events_type", table_name="events")
    op.drop_index("ix_events_occurred_at", table_name="events")
    op.drop_table("events")
