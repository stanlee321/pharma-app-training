"""LocalFileStorage: absolute root, safe key->path join, atomic writes, sha256."""
import hashlib
import os

import pytest

from app.core.config import settings
from app.infrastructure.storage import LocalFileStorage, StorageError, StoredFileMissing


@pytest.fixture
def store(tmp_path):
    return LocalFileStorage(tmp_path / "root")


def test_root_must_be_absolute():
    with pytest.raises(ValueError):
        LocalFileStorage("relative/documents")


def test_settings_documents_dir_is_absolute():
    assert os.path.isabs(settings.documents_dir)


def test_save_open_delete_round_trip(store):
    data = b"%PDF-1.7 synthetic"
    stored = store.save(data, "11111111-2222-4333-8444-555555555555/nota_x_20260925T101010000001.pdf")
    assert os.path.isabs(stored.path)
    assert stored.path.startswith(str(store.root) + os.sep)
    assert stored.size_bytes == len(data)
    assert stored.sha256 == hashlib.sha256(data).hexdigest()
    assert store.open(stored.path) == data
    # no temp files left next to it
    parent = os.path.dirname(stored.path)
    assert os.listdir(parent) == [os.path.basename(stored.path)]
    store.delete(stored.path)
    assert not os.path.exists(stored.path)
    assert not os.path.exists(parent)  # empty per-case dir removed
    assert store.root.exists()
    with pytest.raises(StoredFileMissing):
        store.open(stored.path)
    store.delete(stored.path)  # idempotent


def test_save_never_overwrites(store):
    store.save(b"one", "c/a.pdf")
    with pytest.raises(StorageError):
        store.save(b"two", "c/a.pdf")
    assert store.open(str(store.root / "c" / "a.pdf")) == b"one"
    assert sorted(os.listdir(store.root / "c")) == ["a.pdf"]


@pytest.mark.parametrize("key", [
    "../escape.pdf", "a/../../escape.pdf", "a/../b.pdf", "/etc/passwd", "a//b.pdf", "",
    "a\\..\\b.pdf", ".hidden.pdf", "a/./b.pdf", "a/b\x00.pdf", "..", "a/..", "a/b c.pdf",
])
def test_bad_keys_rejected(store, key):
    with pytest.raises(StorageError):
        store.save(b"x", key)
    assert not any(p.is_file() for p in store.root.parent.rglob("*"))


def test_open_and_delete_refuse_paths_outside_root(store, tmp_path):
    outside = tmp_path / "outside.pdf"
    outside.write_bytes(b"secret")
    for path in (str(outside), str(store.root / ".." / "outside.pdf"), "outside.pdf",
                 str(store.root)):
        with pytest.raises(StorageError):
            store.open(path)
        with pytest.raises(StorageError):
            store.delete(path)
    assert outside.read_bytes() == b"secret"


def test_symlink_escape_rejected(store, tmp_path):
    target = tmp_path / "elsewhere"
    target.mkdir()
    store.root.mkdir(parents=True)
    (store.root / "link").symlink_to(target, target_is_directory=True)
    with pytest.raises(StorageError):
        store.save(b"x", "link/a.pdf")
    assert list(target.iterdir()) == []
