"""document_blobs table (PDF bytes in the database) + documents.storage_backend

Revision ID: 0008
Revises: 0007
Create Date: 2026-09-25

Generated PDFs can now live in the database as raw bytes (``bytea`` on Postgres, BLOB on SQLite;
never base64), one ``document_blobs`` row per ``documents`` row (``ON DELETE CASCADE``). That makes
finalize truly atomic (case lock + four rows + four blobs in one transaction) and lets a single
``pg_dump`` back up cases and documents together.

Schema:

* ``documents.storage_backend`` — ``'db'`` or ``'local'`` (CHECK ``ck_documents_storage_backend``),
  NOT NULL, server default ``'local'`` so every pre-existing row keeps meaning "a file".
* ``documents.storage_path`` becomes nullable (NULL for ``db`` rows; CHECK
  ``ck_documents_local_has_path`` keeps it required for ``local`` rows).
* ``document_blobs(document_id PK/FK -> documents.id ON DELETE CASCADE, content, created_at)``.

Data step (upgrade): every ``local`` row whose file is readable INSIDE the documents root
(``-x documents_dir=/abs/path``, else ``TIVA_DOCUMENTS_DIR``) and whose bytes match the row's
``sha256`` is copied into ``document_blobs`` and flipped to ``db`` with ``storage_path`` NULL.
Anything else (missing/unreadable file, path outside the root, hash mismatch) stays ``local`` and is
logged as a warning; the app keeps serving it from disk. The source files are NOT deleted — remove
the old directory by hand once you are satisfied. Skipped in offline (``--sql``) mode.

Downgrade writes every ``db`` blob BACK to a file under the documents root (never drops content):
``<root>/<case_id>/<form_id>_<UTC created_at yyyymmddTHHMMSSffffff>.pdf`` — the same name the app
would have used — reusing an existing file there when its sha256 matches, else adding an
``_<id8>`` suffix. The row becomes ``local`` with that path, then the table and column are dropped.
It REFUSES (RuntimeError, nothing changed in the schema) when the root is not writable, a ``db``
row has no blob, or a blob does not match its sha256. Offline (``--sql``) downgrade is refused.
"""

from __future__ import annotations

import hashlib
import logging
import os
import re
import tempfile
from datetime import datetime, timezone
from pathlib import Path

from alembic import context, op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = "0008"
down_revision = "0007"
branch_labels = None
depends_on = None

log = logging.getLogger("alembic.runtime.migration")

_SEGMENT = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$")

_documents = sa.table(
    "documents",
    sa.column("id", sa.String),
    sa.column("case_id", sa.String),
    sa.column("form_id", sa.String),
    sa.column("storage_backend", sa.String),
    sa.column("storage_path", sa.String),
    sa.column("sha256", sa.String),
    sa.column("created_at", sa.DateTime(timezone=True)),
)
_blobs = sa.table(
    "document_blobs",
    sa.column("document_id", sa.String),
    sa.column("content", sa.LargeBinary),
    sa.column("created_at", sa.DateTime(timezone=True)),
)


def _documents_root() -> Path:
    """``-x documents_dir=...`` > ``config.attributes['documents_dir']`` (tests) >
    ``TIVA_DOCUMENTS_DIR`` (app settings; already absolute)."""
    raw = context.get_x_argument(as_dictionary=True).get("documents_dir")
    raw = raw or context.config.attributes.get("documents_dir")
    if not raw:
        from app.core.config import settings

        raw = settings.documents_dir
    root = Path(raw).expanduser()
    if not root.is_absolute():
        raise RuntimeError(f"documents_dir must be absolute, got {str(raw)!r}")
    return root.resolve()


def _sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _inside(root: Path, candidate: Path) -> Path | None:
    resolved = candidate.resolve()
    if resolved == root or not resolved.is_relative_to(root):
        return None
    return resolved


# ------------------------------------------------------------------------------ upgrade
def upgrade() -> None:
    with op.batch_alter_table("documents") as batch:
        batch.add_column(
            sa.Column("storage_backend", sa.String(length=16), nullable=False,
                      server_default="local")
        )
        batch.alter_column("storage_path", existing_type=sa.String(length=1024), nullable=True)
        batch.create_check_constraint(
            "ck_documents_storage_backend", "storage_backend IN ('db', 'local')"
        )
        batch.create_check_constraint(
            "ck_documents_local_has_path",
            "storage_backend <> 'local' OR storage_path IS NOT NULL",
        )
    op.create_table(
        "document_blobs",
        sa.Column("document_id", sa.String(length=36), primary_key=True),
        sa.Column("content", sa.LargeBinary(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["document_id"], ["documents.id"],
            name="fk_document_blobs_document_id_documents", ondelete="CASCADE",
        ),
    )
    if context.is_offline_mode():
        log.warning("0008: offline mode — local files were NOT copied into document_blobs")
        return
    _copy_local_files_into_blobs()


def _copy_local_files_into_blobs() -> None:
    bind = op.get_bind()
    rows = bind.execute(
        sa.select(_documents.c.id, _documents.c.storage_path, _documents.c.sha256)
        .where(_documents.c.storage_backend == "local")
        .order_by(_documents.c.id)
    ).all()
    if not rows:
        return
    root = _documents_root()
    moved = 0
    for doc_id, path, sha in rows:
        target = _inside(root, Path(path)) if path and os.path.isabs(path) else None
        if target is None:
            log.warning("0008: document %s left as 'local': path is outside %s", doc_id, root)
            continue
        try:
            data = target.read_bytes()
        except OSError as exc:
            log.warning("0008: document %s left as 'local': file unreadable (%s)",
                        doc_id, exc.__class__.__name__)
            continue
        if _sha(data) != sha:
            log.warning("0008: document %s left as 'local': sha256 mismatch", doc_id)
            continue
        bind.execute(_blobs.insert().values(
            document_id=doc_id, content=data, created_at=datetime.now(timezone.utc)
        ))
        bind.execute(
            _documents.update().where(_documents.c.id == doc_id)
            .values(storage_backend="db", storage_path=None)
        )
        moved += 1
    log.info("0008: moved %d of %d local document(s) into document_blobs "
             "(source files left on disk)", moved, len(rows))


# ------------------------------------------------------------------------------ downgrade
def downgrade() -> None:
    if context.is_offline_mode():
        raise RuntimeError(
            "0008 downgrade cannot run offline: database-stored PDFs must be written back to "
            "files first"
        )
    _write_blobs_back_to_files()
    op.drop_table("document_blobs")
    with op.batch_alter_table("documents") as batch:
        batch.drop_constraint("ck_documents_local_has_path", type_="check")
        batch.drop_constraint("ck_documents_storage_backend", type_="check")
        batch.alter_column("storage_path", existing_type=sa.String(length=1024), nullable=False)
        batch.drop_column("storage_backend")


def _stamp(at: datetime) -> str:
    if at.tzinfo is None:  # SQLite hands back naive values; they were stored as UTC
        at = at.replace(tzinfo=timezone.utc)
    return f"{at.astimezone(timezone.utc):%Y%m%dT%H%M%S%f}"


def _write_new(final: Path, data: bytes) -> bool:
    """Atomically create ``final`` (temp file + fsync + hard link). False if it already exists."""
    final.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(prefix=".tmp-", suffix=".part", dir=final.parent)
    try:
        with os.fdopen(fd, "wb") as fh:
            fh.write(data)
            fh.flush()
            os.fsync(fh.fileno())
        try:
            os.link(tmp, final)
        except FileExistsError:
            return False
        return True
    finally:
        try:
            os.unlink(tmp)
        except FileNotFoundError:
            pass


def _write_blobs_back_to_files() -> None:
    bind = op.get_bind()
    rows = bind.execute(
        sa.select(_documents.c.id, _documents.c.case_id, _documents.c.form_id,
                  _documents.c.sha256, _documents.c.created_at)
        .where(_documents.c.storage_backend == "db")
        .order_by(_documents.c.id)
    ).all()
    if not rows:
        return
    root = _documents_root()
    try:
        root.mkdir(parents=True, exist_ok=True)
        probe_fd, probe = tempfile.mkstemp(prefix=".tmp-probe-", dir=root)
        os.close(probe_fd)
        os.unlink(probe)
    except OSError as exc:
        raise RuntimeError(
            f"0008 downgrade refused: {len(rows)} document(s) are stored only in the database "
            f"and the documents directory {str(root)!r} is not writable ({exc}). Set "
            f"TIVA_DOCUMENTS_DIR (or -x documents_dir=/abs/path) to a writable directory."
        ) from exc

    written = 0
    for doc_id, case_id, form_id, sha, created_at in rows:
        # One blob at a time: never holds more than one PDF in memory.
        data = bind.execute(
            sa.select(_blobs.c.content).where(_blobs.c.document_id == doc_id)
        ).scalar()
        if data is None:
            raise RuntimeError(f"0008 downgrade refused: document {doc_id} has no stored content")
        data = bytes(data)
        if _sha(data) != sha:
            raise RuntimeError(f"0008 downgrade refused: document {doc_id} fails its sha256 check")
        if not (_SEGMENT.match(case_id or "") and _SEGMENT.match(form_id or "")):
            raise RuntimeError(f"0008 downgrade refused: document {doc_id} has an unsafe "
                               f"case_id/form_id for a file name")
        base = f"{form_id}_{_stamp(created_at)}"
        final: Path | None = None
        for name in (f"{base}.pdf", f"{base}_{doc_id[:8]}.pdf"):
            candidate = root / case_id / name
            if _write_new(candidate, data):
                final = candidate
                break
            if candidate.is_file() and _sha(candidate.read_bytes()) == sha:
                final = candidate  # e.g. the pre-0008 file is still there: reuse it
                break
        if final is None:
            raise RuntimeError(f"0008 downgrade refused: no free file name for document {doc_id} "
                               f"under {str(root / case_id)!r}")
        bind.execute(
            _documents.update().where(_documents.c.id == doc_id)
            .values(storage_backend="local", storage_path=str(final))
        )
        written += 1
    log.info("0008 downgrade: wrote %d database-stored document(s) back under %s", written, root)
