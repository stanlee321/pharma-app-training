"""case lifecycle: JSONB data, status, updated_at, finalized_at

Revision ID: 0003
Revises: 0002
Create Date: 2026-09-25

- ``cases.data``: JSON -> **JSONB** on Postgres (``USING data::jsonb``). Other dialects keep
  JSON (SQLite has no JSONB; the model uses ``JSON().with_variant(JSONB(), "postgresql")``).
- ``cases.status``: ``draft|finalized``, NOT NULL, server default ``'draft'``, indexed,
  CHECK constraint ``ck_cases_status``.
- ``cases.updated_at``: NOT NULL; existing rows are backfilled from ``created_at``.
- ``cases.finalized_at``: nullable.

SQLite cannot ALTER constraints/nullability in place, so those steps run through
``batch_alter_table`` (table copy on SQLite, plain ALTERs on Postgres).
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None


def _is_pg() -> bool:
    return op.get_bind().dialect.name == "postgresql"


def upgrade() -> None:
    if _is_pg():
        op.alter_column(
            "cases",
            "data",
            type_=postgresql.JSONB(),
            existing_type=sa.JSON(),
            existing_nullable=False,
            postgresql_using="data::jsonb",
        )

    op.add_column(
        "cases",
        sa.Column("status", sa.String(length=16), nullable=False, server_default="draft"),
    )
    op.add_column("cases", sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("cases", sa.Column("finalized_at", sa.DateTime(timezone=True), nullable=True))
    op.execute("UPDATE cases SET updated_at = created_at WHERE updated_at IS NULL")

    with op.batch_alter_table("cases") as batch:
        batch.alter_column(
            "updated_at", existing_type=sa.DateTime(timezone=True), nullable=False
        )
        batch.create_check_constraint("ck_cases_status", "status IN ('draft', 'finalized')")
    op.create_index("ix_cases_status", "cases", ["status"])


def downgrade() -> None:
    op.drop_index("ix_cases_status", table_name="cases")
    with op.batch_alter_table("cases") as batch:
        batch.drop_constraint("ck_cases_status", type_="check")
        batch.drop_column("finalized_at")
        batch.drop_column("updated_at")
        batch.drop_column("status")

    if _is_pg():
        op.alter_column(
            "cases",
            "data",
            type_=sa.JSON(),
            existing_type=postgresql.JSONB(),
            existing_nullable=False,
            postgresql_using="data::json",
        )
