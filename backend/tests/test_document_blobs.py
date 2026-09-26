"""Database document storage (``TIVA_DOCUMENT_STORAGE=db``, migration 0008).

PDF bytes live in ``document_blobs`` (bytea on Postgres) and commit with their ``documents`` row
through the request's Session. Covers: generate / download / delete with identical bytes, finalize
atomicity (no filesystem, one transaction), that no list/index query ever selects the content
column, mixed legacy ``local`` + ``db`` rows, cascades, and the adapter itself. All data synthetic.
"""
import hashlib
import re
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import event, func, inspect, select

from app.application import document_service, dto
from app.core.db import SessionLocal, engine
from app.infrastructure.models import CaseModel, DocumentBlobModel, DocumentModel
from app.infrastructure.repository import SqlDocumentRepository
from app.infrastructure.storage import (
    DatabaseBlobStorage,
    DocumentStores,
    LocalFileStorage,
    StorageError,
    StoredFileMissing,
)
from app.main import app as fastapi_app

from .conftest import IS_SQLITE

API = "/api/v1"
A = f"{API}/admin"
FORM = "nota_postanestesica"

pytestmark = pytest.mark.usefixtures("db_mode")


@pytest.fixture
def owner(anesthesiologist, auth_headers):
    return anesthesiologist, auth_headers(anesthesiologist)


@pytest.fixture
def admin(admin_user, auth_headers):
    return admin_user, auth_headers(admin_user)


def _new_case(client, headers) -> str:
    cid = client.post(f"{API}/cases", json={"owner": "tester"}, headers=headers).json()["id"]
    client.put(f"{API}/cases/{cid}/patient", json={"nombre": "Paciente Sintetico"},
               headers=headers)
    return cid


def _generate(client, headers, cid, form_id=FORM):
    return client.post(f"{API}/cases/{cid}/documents", json={"form_id": form_id},
                       headers=headers)


def _blob(db, doc_id) -> bytes | None:
    db.expire_all()
    return db.scalar(select(DocumentBlobModel.content)
                     .where(DocumentBlobModel.document_id == doc_id))


def _blob_count(db) -> int:
    return db.scalar(select(func.count()).select_from(DocumentBlobModel))


def _files(root):
    return [p for p in root.rglob("*") if p.is_file()] if root.exists() else []


@contextmanager
def _sql_log():
    """Every SQL statement the app engine executes inside the block."""
    seen: list[str] = []

    def hook(conn, cursor, statement, params, context, executemany):
        seen.append(statement)

    event.listen(engine, "before_cursor_execute", hook)
    try:
        yield seen
    finally:
        event.remove(engine, "before_cursor_execute", hook)


_CONTENT = re.compile(r"document_blobs\.content|\bcontent\b.*\bFROM\s+document_blobs", re.I | re.S)


def _reads_content(statements: list[str]) -> list[str]:
    return [s for s in statements if s.lstrip().upper().startswith("SELECT") and _CONTENT.search(s)]


# --- generate / download / delete ------------------------------------------------------------

def test_db_generate_download_delete_bytes_identical(client, owner, db, documents_dir):
    _, h = owner
    cid = _new_case(client, h)
    resp = _generate(client, h, cid)
    assert resp.status_code == 200, resp.text
    doc = resp.json()
    assert set(doc) == set(dto.DocumentDTO.model_fields)  # response shape unchanged

    db.expire_all()
    row = db.get(DocumentModel, doc["id"])
    assert (row.storage_backend, row.storage_path) == ("db", None)
    stored = _blob(db, doc["id"])
    assert stored is not None and bytes(stored).startswith(b"%PDF-")
    assert len(stored) == doc["size_bytes"] == row.size_bytes
    assert hashlib.sha256(stored).hexdigest() == doc["sha256"] == row.sha256
    assert _files(documents_dir) == []  # no filesystem write at all

    dl = client.get(doc["download_url"], headers=h)
    assert dl.status_code == 200
    assert dl.headers["content-type"].startswith("application/pdf")
    assert f"{FORM}_{cid}.pdf" in dl.headers["content-disposition"]
    assert dl.content == bytes(stored)
    assert hashlib.sha256(dl.content).hexdigest() == doc["sha256"]

    assert client.delete(f"{API}/documents/{doc['id']}", headers=h).status_code == 204
    assert _blob(db, doc["id"]) is None and _blob_count(db) == 0
    assert db.get(DocumentModel, doc["id"]) is None
    assert client.get(doc["download_url"], headers=h).status_code == 404


def test_download_headers_match_local_mode(client, owner, monkeypatch):
    """Same route, same headers, whichever backend holds the bytes."""
    from app.core.config import settings

    _, h = owner
    cid = _new_case(client, h)
    db_doc = _generate(client, h, cid).json()
    monkeypatch.setattr(settings, "document_storage", "local")
    local_doc = _generate(client, h, cid).json()
    a = client.get(db_doc["download_url"], headers=h)
    b = client.get(local_doc["download_url"], headers=h)
    assert a.status_code == b.status_code == 200
    drop = {"content-length", "date"}
    assert {k: v for k, v in a.headers.items() if k not in drop} == \
        {k: v for k, v in b.headers.items() if k not in drop}


def test_admin_index_reports_backend_and_null_path(client, owner, admin):
    _, h = owner
    _, ha = admin
    cid = _new_case(client, h)
    doc = _generate(client, h, cid).json()
    items = client.get(f"{A}/documents", headers=ha).json()["items"]
    assert len(items) == 1
    item = items[0]
    assert item["id"] == doc["id"]
    assert item["storage_backend"] == "db" and item["storage_path"] is None
    schemas = client.get("/openapi.json").json()["components"]["schemas"]
    assert "storage_backend" in schemas["AdminDocumentDTO"]["properties"]
    assert "storage_backend" not in schemas["DocumentDTO"]["properties"]


def test_tampered_blob_is_500_and_missing_blob_is_404(client, owner, db):
    _, h = owner
    cid = _new_case(client, h)
    doc = _generate(client, h, cid).json()
    blob = db.get(DocumentBlobModel, doc["id"])
    blob.content = b"%PDF-tampered"
    db.commit()
    c = TestClient(fastapi_app, raise_server_exceptions=False)
    assert c.get(doc["download_url"], headers=h).status_code == 500
    db.delete(blob)
    db.commit()
    assert client.get(doc["download_url"], headers=h).status_code == 404


def test_registry_refuses_unknown_backend(db, tmp_path):
    """A row naming a backend this build does not know (e.g. a future ``s3``) is never guessed."""
    stores = DocumentStores("db", local=LocalFileStorage(tmp_path), db=DatabaseBlobStorage(db))
    assert stores.writer.backend == "db" and stores.for_backend("local") is stores.local
    with pytest.raises(StorageError):
        stores.for_backend("s3")
    with pytest.raises(StorageError):
        stores.for_backend(None)
    with pytest.raises(ValueError):
        DocumentStores("s3", local=LocalFileStorage(tmp_path))


# --- finalize ----------------------------------------------------------------------------------

def test_db_finalize_stores_four_blobs_no_files(client, owner, db, documents_dir):
    _, h = owner
    cid = _new_case(client, h)
    commits = {"n": 0}

    def count(_session):
        commits["n"] += 1

    event.listen(SessionLocal, "after_commit", count)
    try:
        resp = client.post(f"{API}/cases/{cid}/finalize", headers=h)
    finally:
        event.remove(SessionLocal, "after_commit", count)
    assert resp.status_code == 200, resp.text
    assert resp.json()["status"] == "finalized"
    assert commits["n"] == 1  # status + 4 rows + 4 blobs: ONE transaction

    docs = client.get(f"{API}/cases/{cid}/documents", headers=h).json()
    assert sorted(d["form_id"] for d in docs) == sorted(dto.FORM_IDS)
    for d in docs:
        content = _blob(db, d["id"])
        assert hashlib.sha256(content).hexdigest() == d["sha256"]
        assert client.get(d["download_url"], headers=h).content == bytes(content)
    assert _blob_count(db) == 4
    assert _files(documents_dir) == []


def test_db_finalize_failure_after_two_renders_leaves_nothing(client, owner, db, documents_dir,
                                                              monkeypatch):
    _, h = owner
    cid = _new_case(client, h)
    real = document_service.render_case_pdf
    calls = {"n": 0}

    def failing_render(case, form_id, *a, **kw):
        calls["n"] += 1
        if calls["n"] == 3:
            raise RuntimeError("synthetic failure after 2 of 4 renders")
        return real(case, form_id, *a, **kw)

    monkeypatch.setattr(document_service, "render_case_pdf", failing_render)
    c = TestClient(fastapi_app, raise_server_exceptions=False)
    assert c.post(f"{API}/cases/{cid}/finalize", headers=h).status_code == 500
    assert calls["n"] == 3

    db.expire_all()
    row = db.get(CaseModel, cid)
    assert (row.status, row.finalized_at) == ("draft", None)
    assert SqlDocumentRepository(db).list_for_case(cid) == []
    assert _blob_count(db) == 0
    assert _files(documents_dir) == []

    monkeypatch.setattr(document_service, "render_case_pdf", real)  # (undo() would drop db_mode)
    assert client.post(f"{API}/cases/{cid}/finalize", headers=h).status_code == 200
    assert _blob_count(db) == 4


def test_db_finalize_commit_failure_rolls_back_blobs(client, owner, db, monkeypatch):
    _, h = owner
    cid = _new_case(client, h)
    real_commit = SqlDocumentRepository.commit
    monkeypatch.setattr(SqlDocumentRepository, "commit",
                        lambda self: (_ for _ in ()).throw(RuntimeError("synthetic commit")))
    c = TestClient(fastapi_app, raise_server_exceptions=False)
    assert c.post(f"{API}/cases/{cid}/finalize", headers=h).status_code == 500
    assert _generate(c, h, cid).status_code == 500
    monkeypatch.setattr(SqlDocumentRepository, "commit", real_commit)
    db.expire_all()
    assert db.get(CaseModel, cid).status == "draft"
    assert _blob_count(db) == 0
    assert db.scalar(select(func.count()).select_from(DocumentModel)) == 0


# --- content never selected by list queries -------------------------------------------------

def test_list_endpoints_never_select_blob_content(client, owner, admin):
    _, h = owner
    _, ha = admin
    cid = _new_case(client, h)
    assert client.post(f"{API}/cases/{cid}/finalize", headers=h).status_code == 200
    _generate(client, h, cid)

    with _sql_log() as seen:
        assert len(client.get(f"{API}/cases/{cid}/documents", headers=h).json()) == 5
        assert client.get(f"{A}/documents", headers=ha).json()["total"] == 5
        assert client.get(f"{A}/documents", headers=ha,
                          params={"case_id": cid, "form_id": FORM}).status_code == 200
        assert client.get(f"{A}/stats", headers=ha).json()["documents_total"] == 5
        assert client.get(f"{API}/cases/{cid}", headers=h).status_code == 200
        assert client.get(f"{A}/cases", headers=ha).status_code == 200
    assert seen, "the SQL hook saw nothing"
    assert _reads_content(seen) == []

    doc = client.get(f"{API}/cases/{cid}/documents", headers=h).json()[0]
    with _sql_log() as seen:
        assert client.get(doc["download_url"], headers=h).status_code == 200
    hits = _reads_content(seen)
    assert len(hits) == 1, hits  # the download reads exactly its one blob


# --- mixed legacy local + db rows -----------------------------------------------------------

def test_mixed_local_and_db_rows(client, owner, admin, db, documents_dir, monkeypatch):
    from app.core.config import settings

    _, h = owner
    _, ha = admin
    cid = _new_case(client, h)
    monkeypatch.setattr(settings, "document_storage", "local")
    legacy = _generate(client, h, cid).json()                    # a pre-0008 style file row
    monkeypatch.setattr(settings, "document_storage", "db")
    fresh = _generate(client, h, cid, "registro_transanestesico").json()

    db.expire_all()
    rows = {d.id: d for d in SqlDocumentRepository(db).list_for_case(cid)}
    assert rows[legacy["id"]].storage_backend == "local"
    assert rows[fresh["id"]].storage_backend == "db"
    assert len(_files(documents_dir)) == 1 and _blob_count(db) == 1

    for d in (legacy, fresh):
        dl = client.get(d["download_url"], headers=h)
        assert dl.status_code == 200
        assert hashlib.sha256(dl.content).hexdigest() == d["sha256"]
    backends = {i["id"]: i["storage_backend"]
                for i in client.get(f"{A}/documents", headers=ha).json()["items"]}
    assert backends == {legacy["id"]: "local", fresh["id"]: "db"}

    # document delete uses each row's own backend
    assert client.delete(f"{API}/documents/{legacy['id']}", headers=h).status_code == 204
    assert _files(documents_dir) == [] and _blob_count(db) == 1
    assert client.delete(f"{API}/documents/{fresh['id']}", headers=h).status_code == 204
    assert _blob_count(db) == 0


def test_case_delete_removes_files_and_cascades_blobs(client, owner, admin, db, documents_dir,
                                                      monkeypatch):
    from app.core.config import settings

    _, h = owner
    _, ha = admin
    draft = _new_case(client, h)
    monkeypatch.setattr(settings, "document_storage", "local")
    _generate(client, h, draft)
    monkeypatch.setattr(settings, "document_storage", "db")
    _generate(client, h, draft)
    assert len(_files(documents_dir)) == 1 and _blob_count(db) == 1
    assert client.delete(f"{API}/cases/{draft}", headers=h).status_code == 204  # owner, draft
    assert _files(documents_dir) == [] and _blob_count(db) == 0

    fin = _new_case(client, h)
    assert client.post(f"{API}/cases/{fin}/finalize", headers=h).status_code == 200
    assert _blob_count(db) == 4
    assert client.delete(f"{A}/cases/{fin}", headers=ha).status_code == 204     # admin
    assert _blob_count(db) == 0
    assert db.scalar(select(func.count()).select_from(DocumentModel)) == 0


def test_user_delete_keeps_their_documents(client, owner, admin, user_factory, auth_headers, db):
    """generated_by is SET NULL; the document row and its blob survive the author's account."""
    _, h = owner
    _, ha = admin
    admin2 = user_factory(username="admin2", role="admin")
    cid = _new_case(client, h)
    doc = _generate(client, auth_headers(admin2), cid).json()
    assert client.delete(f"{A}/users/{admin2.id}", headers=ha).status_code == 204
    db.expire_all()
    row = db.get(DocumentModel, doc["id"])
    assert row is not None and row.generated_by is None
    assert _blob(db, doc["id"]) is not None
    assert client.get(doc["download_url"], headers=h).status_code == 200


# --- the adapter --------------------------------------------------------------------------------

def _doc_row(db, case_factory) -> DocumentModel:
    case = case_factory()
    row = DocumentModel(
        id=str(uuid.uuid4()), case_id=case.id, form_id=FORM, storage_backend="db",
        storage_path=None, size_bytes=3, sha256="0" * 64, created_at=datetime.now(timezone.utc),
    )
    return row


def test_adapter_never_commits_and_joins_the_session(db, case_factory):
    store = DatabaseBlobStorage(db)
    row = _doc_row(db, case_factory)
    data = b"%PDF-1.7 \x00\x01\xff binary"
    stored = store.save(data, "ignored/key.pdf", document_id=row.id)  # blob added BEFORE row
    db.add(row)
    assert stored.path is None and stored.size_bytes == len(data)
    assert stored.sha256 == hashlib.sha256(data).hexdigest()

    other = SessionLocal()
    try:
        db.flush()  # the unit of work inserts the documents row first (FK order)
        assert other.scalar(select(func.count()).select_from(DocumentBlobModel)) == 0
        db.rollback()  # never committed by the adapter -> gone
        assert other.scalar(select(func.count()).select_from(DocumentBlobModel)) == 0

        row = _doc_row(db, case_factory)
        db.add(row)
        store.save(data, "k.pdf", document_id=row.id)
        db.commit()
        assert store.open(None, document_id=row.id) == data  # raw bytes round-trip
        store.delete(None, document_id=row.id)
        assert other.scalar(select(func.count()).select_from(DocumentBlobModel)) == 1
        db.rollback()
        assert store.open(None, document_id=row.id) == data
        store.delete(None, document_id=row.id)
        db.commit()
        with pytest.raises(StoredFileMissing):
            store.open(None, document_id=row.id)
    finally:
        other.close()
    with pytest.raises(StorageError):
        store.save(b"x", "k.pdf")  # no document id


@pytest.mark.skipif(IS_SQLITE, reason="bytea is Postgres-only")
def test_content_column_is_bytea_on_postgres(db):
    cols = {c["name"]: c for c in inspect(db.get_bind()).get_columns("document_blobs")}
    assert type(cols["content"]["type"]).__name__.upper() == "BYTEA"
