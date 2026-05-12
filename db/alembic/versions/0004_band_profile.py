"""band profile fields

Revision ID: 0004
Revises: 0003
Create Date: 2026-05-12

Adds:
- bands.w9_name        (text)   — legal/payee name on the W-9; often differs from stage/band name
- bands.bio            (text)   — short prose description shown on the band profile
- bands.social_links   (jsonb)  — array of {label, url} entries (Instagram, Spotify, Bandcamp, etc.)
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0004"
down_revision = "0003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("bands", sa.Column("w9_name", sa.Text(), nullable=True))
    op.add_column("bands", sa.Column("bio", sa.Text(), nullable=True))
    op.add_column(
        "bands",
        sa.Column(
            "social_links",
            postgresql.JSONB,
            nullable=False,
            server_default=sa.text("'[]'::jsonb"),
        ),
    )


def downgrade() -> None:
    op.drop_column("bands", "social_links")
    op.drop_column("bands", "bio")
    op.drop_column("bands", "w9_name")
