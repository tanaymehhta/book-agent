"""band insights cache

Revision ID: 0003
Revises: 0002
Create Date: 2026-04-20

Adds:
- bands.insights (JSONB) — AI-extracted summary (genre, fee range, key facts, etc.)
- bands.insights_updated_at (timestamptz) — last extraction time, used for cache invalidation
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("bands", sa.Column("insights", postgresql.JSONB, nullable=True))
    op.add_column(
        "bands",
        sa.Column("insights_updated_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("bands", "insights_updated_at")
    op.drop_column("bands", "insights")
