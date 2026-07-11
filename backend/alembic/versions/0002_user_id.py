"""user_id: per-tenant column on cases

Revision ID: 0002
Revises: 0001
Create Date: 2026-07-10

Adds the per-tenant `user_id` column (the X-User-Id header value). Existing rows are
backfilled to the mock-default tenant so they stay visible after the migration.
"""

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("cases", sa.Column("user_id", sa.String(36), nullable=False, server_default=""))
    op.create_index("ix_cases_user_id", "cases", ["user_id"])
    # Backfill existing rows so they remain visible under the mock-default tenant.
    op.execute(
        "UPDATE cases SET user_id = '00000000-0000-0000-0000-000000000001' "
        "WHERE user_id IS NULL OR user_id = ''"
    )


def downgrade() -> None:
    op.drop_index("ix_cases_user_id", table_name="cases")
    op.drop_column("cases", "user_id")
