"""Generated-document storage: the ``DocumentStorage`` port and its two adapters.

Every ``documents`` row records WHERE its bytes live in ``storage_backend``; reading and deleting
always go through the adapter named by the row (``DocumentStores.for_backend``), so rows written
under different ``TIVA_DOCUMENT_STORAGE`` settings coexist. New documents go to the adapter named
by ``TIVA_DOCUMENT_STORAGE`` (``DocumentStores.writer``).

* ``DatabaseBlobStorage`` (``"db"``, the default) keeps the PDF as raw bytes (``bytea`` on
  Postgres) in ``document_blobs``, one row per document. It is **transactional**: it reads and
  writes through the SAME SQLAlchemy ``Session`` as the document row and never commits, so the
  row and its bytes commit (or roll back) together and a failed request can leave nothing behind.
* ``LocalFileStorage`` (``"local"``) keeps files on disk. It is not transactional: the caller
  must remove a file it wrote when the transaction fails, and removes files only after the row
  deletion committed.

``LocalFileStorage`` keeps files under one absolute root (``TIVA_DOCUMENTS_DIR``). Keys are
relative, ``/``-separated paths such as ``<case_id>/<form_id>_<UTC stamp>.pdf``; every key is
validated segment by segment and the joined path must resolve inside the root, so a key (or a
stored path read back from the DB) can never reach outside it. Writes are atomic: the bytes go to
a temp file in the target directory, are fsynced, then hard-linked into place (which also refuses
to overwrite an existing file), and the temp name is removed.

Object storage (S3 & co.) will implement the same port later (a non-transactional adapter,
like ``LocalFileStorage``).
"""
from __future__ import annotations

import hashlib
import os
import re
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from .models import DocumentBlobModel

_SEGMENT = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$")


class StorageError(Exception):
    """A key or path is invalid / outside the root, or the storage operation failed."""


class StoredFileMissing(StorageError):
    """The path is valid but no file exists there."""


BACKEND_DB = "db"
BACKEND_LOCAL = "local"


@dataclass(frozen=True)
class StoredFile:
    path: str | None  # absolute file path (local); None when the bytes live in the database
    size_bytes: int
    sha256: str


class DocumentStorage(Protocol):
    """``key`` is a relative ``<case_id>/<file>.pdf`` name (used by path-based stores);
    ``document_id`` is the ``documents.id`` the bytes belong to (used by the database store).
    ``path`` is what ``save`` returned in ``StoredFile.path`` (``documents.storage_path``)."""

    backend: str        # the value recorded in ``documents.storage_backend``
    transactional: bool  # True: writes/deletes join the caller's DB transaction (never commit)

    def save(self, data: bytes, key: str, *, document_id: str | None = None) -> StoredFile: ...

    def open(self, path: str | None, *, document_id: str | None = None) -> bytes: ...

    def delete(self, path: str | None, *, document_id: str | None = None) -> None: ...


def sha256_hex(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


class LocalFileStorage:
    """Files under an absolute root directory (created on first write). ``document_id`` is
    accepted for the port's sake and ignored."""

    backend = BACKEND_LOCAL
    transactional = False

    def __init__(self, root: str | os.PathLike[str]):
        p = Path(root).expanduser()
        if not p.is_absolute():
            raise ValueError(f"document storage root must be absolute, got {str(root)!r}")
        self.root = p.resolve()

    # ---------------------------------------------------------------- path safety
    def _inside(self, candidate: Path) -> Path:
        resolved = candidate.resolve()
        if resolved == self.root or not resolved.is_relative_to(self.root):
            raise StorageError("path is outside the document storage root")
        return resolved

    def path_for(self, key: str) -> Path:
        """Validated absolute path for a relative key (raises StorageError)."""
        if not isinstance(key, str) or not key or "\x00" in key or "\\" in key:
            raise StorageError("invalid storage key")
        parts = key.split("/")
        for part in parts:
            if part in ("", ".", "..") or not _SEGMENT.match(part):
                raise StorageError("invalid storage key")
        return self._inside(self.root.joinpath(*parts))

    def _stored(self, path: str | None) -> Path:
        if not path:
            raise StorageError("stored document path is missing")
        p = Path(path)
        if not p.is_absolute():
            raise StorageError("stored document path must be absolute")
        return self._inside(p)

    # ---------------------------------------------------------------- port
    def save(self, data: bytes, key: str, *, document_id: str | None = None) -> StoredFile:
        final = self.path_for(key)
        final.parent.mkdir(parents=True, exist_ok=True)
        fd, tmp_name = tempfile.mkstemp(prefix=".tmp-", suffix=".part", dir=final.parent)
        try:
            with os.fdopen(fd, "wb") as fh:
                fh.write(data)
                fh.flush()
                os.fsync(fh.fileno())
            try:
                os.link(tmp_name, final)  # atomic, and never clobbers an existing document
            except FileExistsError as exc:
                raise StorageError(f"a document already exists at key {key!r}") from exc
        finally:
            try:
                os.unlink(tmp_name)
            except FileNotFoundError:
                pass
        return StoredFile(path=str(final), size_bytes=len(data), sha256=sha256_hex(data))

    def open(self, path: str | None, *, document_id: str | None = None) -> bytes:
        p = self._stored(path)
        try:
            return p.read_bytes()
        except FileNotFoundError as exc:
            raise StoredFileMissing("document file is missing") from exc

    def delete(self, path: str | None, *, document_id: str | None = None) -> None:
        p = self._stored(path)
        p.unlink(missing_ok=True)
        # Drop the per-case directory once it is empty (never the root itself).
        parent = p.parent
        if parent != self.root:
            try:
                parent.rmdir()
            except OSError:
                pass


class DatabaseBlobStorage:
    """PDF bytes in ``document_blobs`` (``bytea`` on Postgres), through the caller's Session.

    Never commits and never flushes on its own: ``save`` adds a pending ``DocumentBlobModel``
    (the unit of work inserts it after its ``documents`` row, thanks to the model relationship),
    ``delete`` issues its DELETE inside the open transaction. ``open`` selects ONLY the one
    ``content`` value asked for; nothing else in the app ever selects that column.
    """

    backend = BACKEND_DB
    transactional = True

    def __init__(self, db: Session):
        self.db = db

    @staticmethod
    def _id(document_id: str | None) -> str:
        if not document_id:
            raise StorageError("database storage needs the document id")
        return document_id

    def save(self, data: bytes, key: str, *, document_id: str | None = None) -> StoredFile:
        self.db.add(DocumentBlobModel(document_id=self._id(document_id), content=bytes(data)))
        return StoredFile(path=None, size_bytes=len(data), sha256=sha256_hex(data))

    def open(self, path: str | None, *, document_id: str | None = None) -> bytes:
        content = self.db.scalar(
            select(DocumentBlobModel.content)
            .where(DocumentBlobModel.document_id == self._id(document_id))
        )
        if content is None:
            raise StoredFileMissing("document content is missing")
        return bytes(content)

    def delete(self, path: str | None, *, document_id: str | None = None) -> None:
        self.db.execute(
            delete(DocumentBlobModel)
            .where(DocumentBlobModel.document_id == self._id(document_id))
            .execution_options(synchronize_session=False)
        )


class DocumentStores:
    """The adapters available to one request: ``writer`` for new documents
    (``TIVA_DOCUMENT_STORAGE``), ``for_backend`` for an existing row's ``storage_backend``."""

    def __init__(self, write_backend: str, *, local: LocalFileStorage,
                 db: DatabaseBlobStorage | None = None):
        self._by_backend: dict[str, DocumentStorage] = {BACKEND_LOCAL: local}
        if db is not None:
            self._by_backend[BACKEND_DB] = db
        if write_backend not in self._by_backend:
            raise ValueError(f"document storage {write_backend!r} is not available")
        self.write_backend = write_backend

    @property
    def writer(self) -> DocumentStorage:
        return self._by_backend[self.write_backend]

    @property
    def local(self) -> LocalFileStorage:
        return self._by_backend[BACKEND_LOCAL]  # type: ignore[return-value]

    def for_backend(self, backend: str | None) -> DocumentStorage:
        store = self._by_backend.get(backend or "")
        if store is None:
            raise StorageError(f"unknown document storage backend {backend!r}")
        return store
