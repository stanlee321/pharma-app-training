"""users.password_changed_at (Bearer-token revocation on password change/reset)

Revision ID: 0007
Revises: 0006
Create Date: 2026-09-25

Stamped whenever a password is set (self-service change, admin reset, CLI ``create-admin``).
``AuthService.resolve_bearer`` rejects any token whose ``iat`` is earlier than the stamp's
second, so a password change/reset logs out every other session. NULL (existing rows, gateway
JIT users) means "never changed": no token is revoked.
"""

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = "0007"
down_revision = "0006"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("users") as batch:
        batch.add_column(
            sa.Column("password_changed_at", sa.DateTime(timezone=True), nullable=True)
        )


def downgrade() -> None:
    with op.batch_alter_table("users") as batch:
        batch.drop_column("password_changed_at")
