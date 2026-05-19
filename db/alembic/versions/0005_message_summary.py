"""message summary

Revision ID: 0005
Revises: 0004
Create Date: 2026-05-12

Adds:
- messages.summary (text) — one-line LLM-generated summary used for the
  band card preview. Falls back to messages.snippet when null.
"""
from alembic import op
import sqlalchemy as sa

revision = "0005"
down_revision = "0004"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("messages", sa.Column("summary", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("messages", "summary")
