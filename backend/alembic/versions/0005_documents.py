"""documents table (stored generated PDFs)

Revision ID: 0005
Revises: 0004
Create Date: 2026-09-25

One row per generated PDF (``POST /cases/{id}/documents`` and ``POST /cases/{id}/finalize``).
``storage_path`` is the absolute path under ``TIVA_DOCUMENTS_DIR``. ``case_id`` cascades with the
case; ``generated_by`` is set NULL if the user row is deleted.

Downgrade drops the table only: the PDF files already written under ``TIVA_DOCUMENTS_DIR`` are
left on disk (delete that directory by hand if wanted).
"""

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = "0005"
down_revision = "0004"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "documents",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("case_id", sa.String(length=36), nullable=False),
        sa.Column("form_id", sa.String(length=64), nullable=False),
        sa.Column("storage_path", sa.String(length=1024), nullable=False),
        sa.Column("size_bytes", sa.Integer(), nullable=False),
        sa.Column("sha256", sa.String(length=64), nullable=False),
        sa.Column("is_fallback", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("generated_by", sa.String(length=36), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["case_id"], ["cases.id"], name="fk_documents_case_id_cases", ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(
            ["generated_by"], ["users.id"], name="fk_documents_generated_by_users",
            ondelete="SET NULL",
        ),
    )
    op.create_index(
        "ix_documents_case_id_created_at", "documents", ["case_id", "created_at"]
    )
    op.create_index("ix_documents_form_id", "documents", ["form_id"])
    op.create_index("ix_documents_generated_by", "documents", ["generated_by"])


def downgrade() -> None:
    op.drop_index("ix_documents_generated_by", table_name="documents")
    op.drop_index("ix_documents_form_id", table_name="documents")
    op.drop_index("ix_documents_case_id_created_at", table_name="documents")
    op.drop_table("documents")
