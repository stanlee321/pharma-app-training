from datetime import datetime, timezone

from sqlalchemy import (
    JSON,
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    UniqueConstraint,
    true,
)
from sqlalchemy import false as sa_false
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from ..core.db import Base

# JSONB on Postgres, plain JSON elsewhere (SQLite tests / zero-setup dev).
JSONDocument = JSON().with_variant(JSONB(), "postgresql")

CASE_STATUSES = ("draft", "finalized")
USER_ROLES = ("anesthesiologist", "admin")


def _now() -> datetime:
    return datetime.now(timezone.utc)


class UserModel(Base):
    """A local account (``TIVA_AUTH_MODE=local``) or a just-in-time row for a gateway identity
    (``gateway`` mode; unusable password hash ``"!"`` so it can never log in locally).

    ``username`` is stored lower-cased, which makes the unique constraint case-insensitive on
    every dialect. ``clave`` is the professional id that prefills a new case's ``anestesiologo``.
    """

    __tablename__ = "users"
    __table_args__ = (
        CheckConstraint("role IN ('anesthesiologist', 'admin')", name="ck_users_role"),
        UniqueConstraint("username", name="uq_users_username"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    username: Mapped[str] = mapped_column(String(64))
    full_name: Mapped[str] = mapped_column(String(255), default="", server_default="")
    clave: Mapped[str] = mapped_column(String(64), default="", server_default="")
    role: Mapped[str] = mapped_column(
        String(32), default="anesthesiologist", server_default="anesthesiologist", index=True
    )
    password_hash: Mapped[str] = mapped_column(String(255))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, server_default=true())
    must_change_password: Mapped[bool] = mapped_column(
        Boolean, default=False, server_default=sa_false()
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    # Stamped explicitly by SqlUserRepository.save (no onupdate: a login must not move it).
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # Set whenever the password is (re)set; Bearer tokens issued before its second are revoked.
    password_changed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )


class CaseModel(Base):
    """One row per AnesthesiaCase. The nested aggregate (envelope + 9 children) is stored as
    a JSON document keyed by the DTO field names — matches rest-contract §1's "JSONB blobs".
    Normalising into per-entity tables is a later migration.

    Server-owned columns (never taken from the client payload, never stored inside ``data``):
    ``user_id``, ``status``, ``created_at`` (row), ``updated_at``, ``finalized_at``, ``version``.
    """

    __tablename__ = "cases"
    __table_args__ = (
        CheckConstraint("status IN ('draft', 'finalized')", name="ck_cases_status"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    owner: Mapped[str] = mapped_column(String(255), default="", server_default="", index=True)
    user_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("users.id", name="fk_cases_user_id_users", ondelete="RESTRICT"),
        index=True,
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    status: Mapped[str] = mapped_column(
        String(16), default="draft", server_default="draft", index=True
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_now, onupdate=_now
    )
    finalized_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # Optimistic-concurrency counter: bumped by every write (data save, finalize, reopen).
    # Finalize compare-and-sets on it so the stored PDFs always match the locked data.
    version: Mapped[int] = mapped_column(Integer, default=1, server_default="1")
    data: Mapped[dict] = mapped_column(JSONDocument, default=dict)


class DocumentModel(Base):
    """A generated PDF stored by the ``DocumentStorage`` port (plan phase 3).

    ``storage_path`` is the ABSOLUTE path of the file (LocalFileStorage). Rows cascade with
    their case (``ON DELETE CASCADE``); the application deletes the files. ``generated_by`` is
    SET NULL when that user row is deleted, so a document outlives its author's account.
    Regenerating a form adds a row (history); the newest per form is the current one.
    """

    __tablename__ = "documents"
    __table_args__ = (
        Index("ix_documents_case_id_created_at", "case_id", "created_at"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    case_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("cases.id", name="fk_documents_case_id_cases", ondelete="CASCADE"),
    )
    form_id: Mapped[str] = mapped_column(String(64), index=True)
    storage_path: Mapped[str] = mapped_column(String(1024))
    size_bytes: Mapped[int] = mapped_column(Integer)
    sha256: Mapped[str] = mapped_column(String(64))
    is_fallback: Mapped[bool] = mapped_column(Boolean, default=False, server_default=sa_false())
    generated_by: Mapped[str | None] = mapped_column(
        String(36),
        ForeignKey("users.id", name="fk_documents_generated_by_users", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
