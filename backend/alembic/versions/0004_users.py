"""users table + cases.user_id FK

Revision ID: 0004
Revises: 0003
Create Date: 2026-09-25

- New ``users`` table (local accounts; gateway identities are provisioned just-in-time).
  ``username`` is stored lower-cased and UNIQUE (case-insensitive login on every dialect);
  ``role`` has CHECK ``ck_users_role`` (``anesthesiologist|admin``).
- ``cases.user_id`` becomes a FOREIGN KEY to ``users.id`` (``ON DELETE RESTRICT``) and loses its
  ``''`` server default.

**Existing case rows are DELETED** (documented choice): before 0004, ``cases.user_id`` held
free-form gateway / mock tenant ids that match no user, and all dev data up to now is mock.
The downgrade drops ``users`` and restores the old column shape; it cannot restore those rows.

SQLite cannot add a FK in place, so the ``cases`` change runs through ``batch_alter_table``.
"""

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = "0004"
down_revision = "0003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "users",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("username", sa.String(length=64), nullable=False),
        sa.Column("full_name", sa.String(length=255), nullable=False, server_default=""),
        sa.Column("clave", sa.String(length=64), nullable=False, server_default=""),
        sa.Column(
            "role", sa.String(length=32), nullable=False, server_default="anesthesiologist"
        ),
        sa.Column("password_hash", sa.String(length=255), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column(
            "must_change_password", sa.Boolean(), nullable=False, server_default=sa.false()
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("last_login_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint("role IN ('anesthesiologist', 'admin')", name="ck_users_role"),
        sa.UniqueConstraint("username", name="uq_users_username"),
    )
    op.create_index("ix_users_role", "users", ["role"])

    # Mock/legacy tenant rows reference no user -> delete (see module docstring).
    op.execute("DELETE FROM cases")

    with op.batch_alter_table("cases") as batch:
        batch.alter_column(
            "user_id",
            existing_type=sa.String(length=36),
            existing_nullable=False,
            server_default=None,
        )
        batch.create_foreign_key(
            "fk_cases_user_id_users", "users", ["user_id"], ["id"], ondelete="RESTRICT"
        )


def downgrade() -> None:
    with op.batch_alter_table("cases") as batch:
        batch.drop_constraint("fk_cases_user_id_users", type_="foreignkey")
        batch.alter_column(
            "user_id",
            existing_type=sa.String(length=36),
            existing_nullable=False,
            server_default="",
        )
    op.drop_index("ix_users_role", table_name="users")
    op.drop_table("users")
