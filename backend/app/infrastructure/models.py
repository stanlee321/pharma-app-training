from datetime import date, datetime, timezone

from sqlalchemy import (
    JSON,
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    LargeBinary,
    String,
    UniqueConstraint,
    func,
    true,
)
from sqlalchemy import false as sa_false
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

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


class PatientModel(Base):
    """A patient ("historia clínica"), shared hospital-wide. Identity lives here; the
    per-encounter values (peso, talla, edad, Hb/Hto, cama, dilución) stay on each case, which
    also keeps a snapshot of the identity for its PDFs (refreshed on DRAFT cases only).

    ``registro`` (expediente) is unique on its normalized form ``lower(trim(registro))``
    (functional unique index ``uq_patients_registro_norm``). It is stored trimmed; NULL only for
    legacy rows grouped by migration 0009 from cases that had no registro. NOTE: SQLite's
    ``lower()`` folds ASCII only, so on SQLite two registros differing only in the case of a
    non-ASCII letter are not caught by the index (Postgres folds them).

    ``created_by``/``updated_by`` are SET NULL when that user row is deleted.
    """

    __tablename__ = "patients"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    registro: Mapped[str | None] = mapped_column(String(255), nullable=True)
    nombre: Mapped[str] = mapped_column(String(255), default="", server_default="")
    sexo: Mapped[str] = mapped_column(String(16), default="", server_default="")
    fecha_nacimiento: Mapped[date | None] = mapped_column(Date, nullable=True)
    grupo_sanguineo: Mapped[str] = mapped_column(String(16), default="", server_default="")
    rh: Mapped[str] = mapped_column(String(16), default="", server_default="")
    created_by: Mapped[str | None] = mapped_column(
        String(36),
        ForeignKey("users.id", name="fk_patients_created_by_users", ondelete="SET NULL"),
        nullable=True,
    )
    updated_by: Mapped[str | None] = mapped_column(
        String(36),
        ForeignKey("users.id", name="fk_patients_updated_by_users", ondelete="SET NULL"),
        nullable=True,
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


# Declared after the class so the expression can reference the mapped column.
REGISTRO_INDEX = "uq_patients_registro_norm"
Index(REGISTRO_INDEX, func.lower(func.trim(PatientModel.registro)), unique=True)

# Expression indexes autogenerate cannot compare: SQLite cannot reflect them, and Postgres
# reflects ``lower(trim(registro))`` back as ``lower(TRIM(BOTH FROM registro))``, which alembic
# reports as drift. Migration 0009 owns this index; tests assert that it exists and enforces
# uniqueness on both dialects.
AUTOGENERATE_SKIP_INDEXES = frozenset({REGISTRO_INDEX})


def autogenerate_include_object(obj, name, type_, reflected, compare_to) -> bool:
    """Alembic ``include_object`` hook (env.py and the migration tests)."""
    return not (type_ == "index" and name in AUTOGENERATE_SKIP_INDEXES)


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
    # The patient this encounter belongs to (NOT NULL since migration 0009; RESTRICT, so a
    # patient with cases cannot be deleted). Server-owned: set at create, never changed.
    patient_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("patients.id", name="fk_cases_patient_id_patients", ondelete="RESTRICT"),
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

    ``storage_backend`` says where the bytes are: ``db`` -> one ``document_blobs`` row (then
    ``storage_path`` is NULL), ``local`` -> the file at the ABSOLUTE ``storage_path``
    (LocalFileStorage). Rows cascade with their case (``ON DELETE CASCADE``) and blobs with their
    row; the application deletes local files. ``generated_by`` is SET NULL when that user row is
    deleted, so a document outlives its author's account. Regenerating a form adds a row
    (history); the newest per form is the current one. The PDF bytes are NOT a column of this
    table, so listing documents never reads them.
    """

    __tablename__ = "documents"
    __table_args__ = (
        Index("ix_documents_case_id_created_at", "case_id", "created_at"),
        CheckConstraint(
            "storage_backend IN ('db', 'local')", name="ck_documents_storage_backend"
        ),
        CheckConstraint(
            "storage_backend <> 'local' OR storage_path IS NOT NULL",
            name="ck_documents_local_has_path",
        ),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    case_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("cases.id", name="fk_documents_case_id_cases", ondelete="CASCADE"),
    )
    form_id: Mapped[str] = mapped_column(String(64), index=True)
    storage_backend: Mapped[str] = mapped_column(
        String(16), default="local", server_default="local"
    )
    storage_path: Mapped[str | None] = mapped_column(String(1024), nullable=True)
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


class DocumentBlobModel(Base):
    """The raw PDF bytes of a ``storage_backend='db'`` document (``bytea`` on Postgres, BLOB on
    SQLite). A separate table so no document query ever drags the content along; read only by
    ``DatabaseBlobStorage.open``. Deleted with its document (``ON DELETE CASCADE``).

    The one-way ``document`` relationship exists only so the unit of work INSERTs the
    ``documents`` row before its blob when both are pending in one flush; it is never loaded.
    """

    __tablename__ = "document_blobs"

    document_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("documents.id", name="fk_document_blobs_document_id_documents",
                   ondelete="CASCADE"),
        primary_key=True,
    )
    content: Mapped[bytes] = mapped_column(LargeBinary)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)

    document: Mapped[DocumentModel] = relationship(DocumentModel, lazy="raise")
