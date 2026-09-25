"""cases.version (optimistic-concurrency counter)

Revision ID: 0006
Revises: 0005
Create Date: 2026-09-25

Every write to a case bumps ``version`` (data saves, finalize, reopen). Data saves are
conditional on ``status='draft'`` and finalize compare-and-sets on the version it rendered, so
neither a draft write can land on a finalized case nor can a case be locked with data its
finalized PDFs do not show. Existing rows start at 1.
"""

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = "0006"
down_revision = "0005"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("cases") as batch:
        batch.add_column(
            sa.Column("version", sa.Integer(), nullable=False, server_default="1")
        )


def downgrade() -> None:
    with op.batch_alter_table("cases") as batch:
        batch.drop_column("version")
