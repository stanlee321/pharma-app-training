"""baseline: cases table

Revision ID: 0001
Revises:
Create Date: 2026-07-10

Mirrors app.infrastructure.models.CaseModel (table "cases").
"""

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = "0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "cases",
        sa.Column("id", sa.String(length=36), primary_key=True, nullable=False),
        sa.Column("owner", sa.String(length=255), nullable=False, server_default=""),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("data", sa.JSON(), nullable=False),
    )
    op.create_index("ix_cases_owner", "cases", ["owner"])


def downgrade() -> None:
    op.drop_index("ix_cases_owner", table_name="cases")
    op.drop_table("cases")
