"""Add slug column to initiatives for human-readable URLs

Revision ID: 036
Revises: 035
Create Date: 2026-03-31

"""
from alembic import op
import sqlalchemy as sa
import re

revision = '036'
down_revision = '035'
branch_labels = None
depends_on = None


def _slugify(text: str) -> str:
    text = text.lower().strip()
    text = re.sub(r'[^\w\s-]', '', text)
    text = re.sub(r'[-\s]+', '-', text)
    return text[:80].strip('-') or 'project'


def upgrade():
    # Add nullable slug column first
    op.add_column(
        'initiatives',
        sa.Column('slug', sa.String(120), nullable=True),
    )

    # Backfill slugs from existing titles, unique per user
    conn = op.get_bind()
    rows = conn.execute(
        sa.text("SELECT id, title, user_id FROM initiatives ORDER BY created_at ASC")
    ).fetchall()

    used_slugs: set[tuple] = set()  # (user_id, slug)

    for row in rows:
        base = _slugify(row.title or 'project')
        slug = base
        counter = 2
        while (row.user_id, slug) in used_slugs:
            slug = f"{base}-{counter}"
            counter += 1
        used_slugs.add((row.user_id, slug))
        conn.execute(
            sa.text("UPDATE initiatives SET slug = :slug WHERE id = :id"),
            {"slug": slug, "id": str(row.id)},
        )

    # Make non-nullable now that every row has a value
    op.alter_column('initiatives', 'slug', nullable=False)

    # Unique constraint: one slug per user
    op.create_index(
        'ix_initiatives_user_id_slug',
        'initiatives',
        ['user_id', 'slug'],
        unique=True,
    )


def downgrade():
    op.drop_index('ix_initiatives_user_id_slug', table_name='initiatives')
    op.drop_column('initiatives', 'slug')
