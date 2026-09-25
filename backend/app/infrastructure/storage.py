"""Generated-document storage: the ``DocumentStorage`` port and its local-disk adapter.

``LocalFileStorage`` keeps files under one absolute root (``TIVA_DOCUMENTS_DIR``). Keys are
relative, ``/``-separated paths such as ``<case_id>/<form_id>_<UTC stamp>.pdf``; every key is
validated segment by segment and the joined path must resolve inside the root, so a key (or a
stored path read back from the DB) can never reach outside it. Writes are atomic: the bytes go to
a temp file in the target directory, are fsynced, then hard-linked into place (which also refuses
to overwrite an existing file), and the temp name is removed.

Object storage (S3 & co.) can implement the same three methods later.
"""
from __future__ import annotations

import hashlib
import os
import re
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol

_SEGMENT = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$")


class StorageError(Exception):
    """A key or path is invalid / outside the root, or the storage operation failed."""


class StoredFileMissing(StorageError):
    """The path is valid but no file exists there."""


@dataclass(frozen=True)
class StoredFile:
    path: str  # absolute
    size_bytes: int
    sha256: str


class DocumentStorage(Protocol):
    def save(self, data: bytes, key: str) -> StoredFile: ...

    def open(self, path: str) -> bytes: ...

    def delete(self, path: str) -> None: ...


def sha256_hex(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


class LocalFileStorage:
    """Files under an absolute root directory (created on first write)."""

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

    def _stored(self, path: str) -> Path:
        p = Path(path)
        if not p.is_absolute():
            raise StorageError("stored document path must be absolute")
        return self._inside(p)

    # ---------------------------------------------------------------- port
    def save(self, data: bytes, key: str) -> StoredFile:
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

    def open(self, path: str) -> bytes:
        p = self._stored(path)
        try:
            return p.read_bytes()
        except FileNotFoundError as exc:
            raise StoredFileMissing("document file is missing") from exc

    def delete(self, path: str) -> None:
        p = self._stored(path)
        p.unlink(missing_ok=True)
        # Drop the per-case directory once it is empty (never the root itself).
        parent = p.parent
        if parent != self.root:
            try:
                parent.rmdir()
            except OSError:
                pass
