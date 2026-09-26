"""Increment 3: stored documents (generate / list / download / delete) and finalize.

Storage is a per-test ``tmp_path`` root (conftest ``document_storage``). Tests about files on
disk force ``local_mode``; the rest run in whatever ``TIVA_DOCUMENT_STORAGE`` the suite uses
(database-blob specifics live in ``test_document_blobs.py``). All data synthetic.
"""
import hashlib
import re
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.application import dto
from app.application.case_service import CaseService
from app.application.identity import CurrentUser
from sqlalchemy import func, select

from app.infrastructure.models import CaseModel, DocumentBlobModel, DocumentModel
from app.infrastructure.render import FORM_MAP, FormRenderer
from app.infrastructure.repository import SqlCaseRepository, SqlDocumentRepository
from app.main import app as fastapi_app

API = "/api/v1"
FORM = "nota_postanestesica"


@pytest.fixture
def owner(anesthesiologist, auth_headers):
    return anesthesiologist, auth_headers(anesthesiologist)


@pytest.fixture
def other(user_factory, auth_headers):
    u = user_factory(username="otro1", full_name="Dr. Otro Sintetico", clave="OTR-2")
    return u, auth_headers(u)


@pytest.fixture
def admin(admin_user, auth_headers):
    return admin_user, auth_headers(admin_user)


def _new_case(client, headers) -> str:
    resp = client.post(f"{API}/cases", json={"owner": "tester"}, headers=headers)
    assert resp.status_code == 200, resp.text
    cid = resp.json()["id"]
    client.put(f"{API}/cases/{cid}/patient", json={"nombre": "Paciente Sintetico"},
               headers=headers)
    return cid


def _generate(client, headers, cid, form_id=FORM):
    return client.post(f"{API}/cases/{cid}/documents", json={"form_id": form_id},
                       headers=headers)


def _row(db, doc_id) -> DocumentModel:
    db.expire_all()
    return db.get(DocumentModel, doc_id)


def _files(root: Path) -> list[Path]:
    return sorted(p for p in root.rglob("*") if p.is_file()) if root.exists() else []


# --- generate / download / list / delete --------------------------------------------------

@pytest.mark.usefixtures("local_mode")
def test_generate_stores_file_with_matching_hash(client, owner, db, documents_dir):
    user, h = owner
    cid = _new_case(client, h)
    resp = _generate(client, h, cid)
    assert resp.status_code == 200, resp.text
    doc = resp.json()
    assert "storage_path" not in doc
    assert doc["case_id"] == cid and doc["form_id"] == FORM
    assert doc["generated_by"] == user.id
    assert doc["download_url"] == f"{API}/documents/{doc['id']}/file"

    row = _row(db, doc["id"])
    path = Path(row.storage_path)
    assert path.is_absolute() and path.is_file()
    assert path.parent == documents_dir / cid
    assert re.fullmatch(rf"{FORM}_\d{{8}}T\d{{12}}\.pdf", path.name)
    data = path.read_bytes()
    assert data.startswith(b"%PDF-")
    assert len(data) == doc["size_bytes"] == row.size_bytes
    assert hashlib.sha256(data).hexdigest() == doc["sha256"] == row.sha256
    assert not [p for p in path.parent.iterdir() if p.name.startswith(".tmp-")]

    dl = client.get(doc["download_url"], headers=h)
    assert dl.status_code == 200
    assert dl.headers["content-type"].startswith("application/pdf")
    assert dl.content.startswith(b"%PDF-") and dl.content == data


def test_list_is_newest_first(client, owner):
    _, h = owner
    cid = _new_case(client, h)
    ids = [_generate(client, h, cid, f).json()["id"] for f in
           ("nota_postanestesica", "registro_transanestesico", "nota_postanestesica")]
    listed = client.get(f"{API}/cases/{cid}/documents", headers=h)
    assert listed.status_code == 200
    rows = listed.json()
    assert [r["id"] for r in rows] == list(reversed(ids))
    stamps = [r["created_at"] for r in rows]
    assert stamps == sorted(stamps, reverse=True)


@pytest.mark.usefixtures("local_mode")
def test_owner_deletes_draft_document_and_file(client, owner, db):
    _, h = owner
    cid = _new_case(client, h)
    doc = _generate(client, h, cid).json()
    path = Path(_row(db, doc["id"]).storage_path)
    assert path.is_file()

    assert client.delete(f"{API}/documents/{doc['id']}", headers=h).status_code == 204
    assert not path.exists()
    assert _row(db, doc["id"]) is None
    assert client.get(doc["download_url"], headers=h).status_code == 404
    assert client.get(f"{API}/cases/{cid}/documents", headers=h).json() == []
    assert client.delete(f"{API}/documents/{doc['id']}", headers=h).status_code == 404


def test_unknown_or_path_like_form_id_is_422(client, owner, documents_dir):
    _, h = owner
    cid = _new_case(client, h)
    for bad in ("unknown_form", "../../etc/passwd", "../x", "nota_postanestesica/../../x",
                "/etc/passwd", "", "NOTA_POSTANESTESICA"):
        resp = _generate(client, h, cid, bad)
        assert resp.status_code == 422, (bad, resp.text)
    assert _files(documents_dir) == []
    assert client.get(f"{API}/documents/..%2F..%2Fetc/file", headers=h).status_code in (404, 422)
    assert client.get(f"{API}/documents/not-a-uuid/file", headers=h).status_code == 422


def test_form_ids_match_renderer():
    assert set(dto.FORM_IDS) == set(FORM_MAP)


@pytest.mark.usefixtures("local_mode")
def test_cross_user_access_is_404(client, owner, other, db):
    _, ho = owner
    _, hx = other
    cid = _new_case(client, ho)
    doc = _generate(client, ho, cid).json()
    path = Path(_row(db, doc["id"]).storage_path)

    assert _generate(client, hx, cid).status_code == 404
    assert client.get(f"{API}/cases/{cid}/documents", headers=hx).status_code == 404
    assert client.get(doc["download_url"], headers=hx).status_code == 404
    assert client.delete(f"{API}/documents/{doc['id']}", headers=hx).status_code == 404
    assert client.post(f"{API}/cases/{cid}/finalize", headers=hx).status_code == 404
    assert path.is_file()
    assert len(client.get(f"{API}/cases/{cid}/documents", headers=ho).json()) == 1


def test_admin_generates_lists_downloads_and_deletes(client, owner, admin, db):
    _, ho = owner
    au, ha = admin
    cid = _new_case(client, ho)
    resp = _generate(client, ha, cid)
    assert resp.status_code == 200, resp.text
    doc = resp.json()
    assert doc["generated_by"] == au.id
    assert [d["id"] for d in client.get(f"{API}/cases/{cid}/documents",
                                        headers=ha).json()] == [doc["id"]]
    assert client.get(doc["download_url"], headers=ha).content.startswith(b"%PDF-")
    assert client.post(f"{API}/cases/{cid}/finalize", headers=ha).status_code == 403
    assert client.delete(f"{API}/documents/{doc['id']}", headers=ha).status_code == 204


def test_no_token_is_401(client, owner):
    _, h = owner
    cid = _new_case(client, h)
    assert client.get(f"{API}/cases/{cid}/documents").status_code == 401
    assert _generate(client, {}, cid).status_code == 401


@pytest.mark.usefixtures("local_mode")
def test_download_detects_missing_and_tampered_files(client, owner, db):
    _, h = owner
    cid = _new_case(client, h)
    doc = _generate(client, h, cid).json()
    path = Path(_row(db, doc["id"]).storage_path)
    path.write_bytes(b"%PDF-tampered")
    tampered = TestClient(fastapi_app, raise_server_exceptions=False)
    assert tampered.get(doc["download_url"], headers=h).status_code == 500
    path.unlink()
    assert client.get(doc["download_url"], headers=h).status_code == 404


@pytest.mark.usefixtures("local_mode")
def test_stored_path_outside_root_is_never_served(client, owner, db, tmp_path):
    _, h = owner
    cid = _new_case(client, h)
    doc = _generate(client, h, cid).json()
    outside = tmp_path / "outside.pdf"
    outside.write_bytes(b"%PDF-secret")
    row = _row(db, doc["id"])
    row.storage_path = str(outside)
    db.commit()
    c = TestClient(fastapi_app, raise_server_exceptions=False)
    resp = c.get(doc["download_url"], headers=h)
    assert resp.status_code == 500 and b"secret" not in resp.content


def test_export_route_still_streams_and_stores_nothing(client, owner, documents_dir):
    _, h = owner
    cid = _new_case(client, h)
    for form_id in (*dto.FORM_IDS, "legacy_unknown_form"):
        resp = client.post(f"{API}/cases/{cid}/export/{form_id}", headers=h)
        assert resp.status_code == 200, form_id
        assert resp.content.startswith(b"%PDF-")
    assert client.get(f"{API}/cases/{cid}/documents", headers=h).json() == []
    assert _files(documents_dir) == []


@pytest.mark.usefixtures("local_mode")
def test_case_delete_removes_its_document_files(client, owner, db, documents_dir):
    _, h = owner
    cid = _new_case(client, h)
    ids = [_generate(client, h, cid, f).json()["id"] for f in dto.FORM_IDS[:2]]
    assert len(_files(documents_dir)) == 2
    assert client.delete(f"{API}/cases/{cid}", headers=h).status_code == 204
    assert _files(documents_dir) == []
    assert all(_row(db, i) is None for i in ids)


# --- finalize ------------------------------------------------------------------------------

@pytest.mark.usefixtures("local_mode")
def test_finalize_stores_four_forms_and_locks(client, owner, db, documents_dir):
    user, h = owner
    cid = _new_case(client, h)
    resp = client.post(f"{API}/cases/{cid}/finalize", headers=h)
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["status"] == "finalized" and body["finalized_at"] is not None

    docs = client.get(f"{API}/cases/{cid}/documents", headers=h).json()
    assert sorted(d["form_id"] for d in docs) == sorted(dto.FORM_IDS)
    assert all(d["generated_by"] == user.id for d in docs)
    for d in docs:
        path = Path(_row(db, d["id"]).storage_path)
        data = path.read_bytes()
        assert path.parent == documents_dir / cid
        assert data.startswith(b"%PDF-") and hashlib.sha256(data).hexdigest() == d["sha256"]
    assert len(_files(documents_dir)) == 4

    # locked: every write is 409, finalize again is 409, owner cannot delete its documents
    put = client.put(f"{API}/cases/{cid}", json={"owner": "x"}, headers=h)
    assert put.status_code == 409 and put.json() == {"detail": "case is finalized"}
    assert client.put(f"{API}/cases/{cid}/patient", json={"nombre": "X"},
                      headers=h).status_code == 409
    assert client.post(f"{API}/cases/{cid}/finalize", headers=h).status_code == 409
    assert client.delete(f"{API}/documents/{docs[0]['id']}", headers=h).status_code == 409
    assert client.delete(f"{API}/cases/{cid}", headers=h).status_code == 409
    # ...but reads, downloads and new documents still work
    assert client.get(docs[0]["download_url"], headers=h).status_code == 200
    assert _generate(client, h, cid).status_code == 200
    assert len(client.get(f"{API}/cases/{cid}/documents", headers=h).json()) == 5


@pytest.mark.usefixtures("local_mode")
def test_admin_can_delete_documents_of_finalized_case(client, owner, admin, db):
    _, ho = owner
    _, ha = admin
    cid = _new_case(client, ho)
    client.post(f"{API}/cases/{cid}/finalize", headers=ho)
    doc = client.get(f"{API}/cases/{cid}/documents", headers=ho).json()[0]
    path = Path(_row(db, doc["id"]).storage_path)
    assert client.delete(f"{API}/documents/{doc['id']}", headers=ha).status_code == 204
    assert not path.exists()


def test_finalize_falls_back_to_summary_per_form(client, owner, monkeypatch):
    _, h = owner
    real = FormRenderer.render

    def flaky(self, case, form_id):
        if form_id == "imss_registro_anestesia":
            raise RuntimeError("synthetic draw failure")
        return real(self, case, form_id)

    monkeypatch.setattr(FormRenderer, "render", flaky)
    cid = _new_case(client, h)
    assert client.post(f"{API}/cases/{cid}/finalize", headers=h).status_code == 200
    docs = {d["form_id"]: d for d in
            client.get(f"{API}/cases/{cid}/documents", headers=h).json()}
    assert len(docs) == 4
    assert docs["imss_registro_anestesia"]["is_fallback"] is True
    pdf = client.get(docs["imss_registro_anestesia"]["download_url"], headers=h)
    assert pdf.content.startswith(b"%PDF-")


def _assert_untouched(db, cid, documents_dir):
    db.expire_all()
    row = db.get(CaseModel, cid)
    assert (row.status, row.finalized_at) == ("draft", None)
    assert SqlDocumentRepository(db).list_for_case(cid) == []
    assert _files(documents_dir) == []
    assert db.scalar(select(func.count()).select_from(DocumentBlobModel)) == 0


@pytest.mark.usefixtures("local_mode")
def test_finalize_commit_failure_rolls_back_and_removes_files(client, owner, db, documents_dir,
                                                             monkeypatch):
    _, h = owner
    cid = _new_case(client, h)

    def boom(self):
        raise RuntimeError("synthetic commit failure")

    real_commit = SqlDocumentRepository.commit
    monkeypatch.setattr(SqlDocumentRepository, "commit", boom)
    c = TestClient(fastapi_app, raise_server_exceptions=False)
    assert c.post(f"{API}/cases/{cid}/finalize", headers=h).status_code == 500
    monkeypatch.setattr(SqlDocumentRepository, "commit", real_commit)  # keep local_mode
    _assert_untouched(db, cid, documents_dir)
    # and the case can still be finalized afterwards
    assert client.post(f"{API}/cases/{cid}/finalize", headers=h).status_code == 200


@pytest.mark.usefixtures("local_mode")
def test_finalize_storage_failure_midway_removes_written_files(client, owner, db, documents_dir,
                                                              document_storage, monkeypatch):
    _, h = owner
    cid = _new_case(client, h)
    real_save = type(document_storage).save
    calls = {"n": 0}

    def failing_save(self, data, key, **kw):
        calls["n"] += 1
        if calls["n"] == 3:
            raise OSError("synthetic disk full")
        return real_save(self, data, key, **kw)

    monkeypatch.setattr(type(document_storage), "save", failing_save)
    c = TestClient(fastapi_app, raise_server_exceptions=False)
    assert c.post(f"{API}/cases/{cid}/finalize", headers=h).status_code == 500
    assert calls["n"] == 3
    _assert_untouched(db, cid, documents_dir)


@pytest.mark.usefixtures("local_mode")
def test_generate_commit_failure_removes_file(client, owner, documents_dir, monkeypatch):
    _, h = owner
    cid = _new_case(client, h)
    monkeypatch.setattr(SqlDocumentRepository, "commit",
                        lambda self: (_ for _ in ()).throw(RuntimeError("synthetic")))
    c = TestClient(fastapi_app, raise_server_exceptions=False)
    assert _generate(c, h, cid).status_code == 500
    assert _files(documents_dir) == []


def test_finalize_lost_race_is_409_and_cleans_up(client, owner, db, documents_dir, monkeypatch):
    """Another request finalized the case between the check and the compare-and-set."""
    _, h = owner
    cid = _new_case(client, h)
    monkeypatch.setattr(SqlCaseRepository, "set_status", lambda self, *a, **k: False)
    resp = client.post(f"{API}/cases/{cid}/finalize", headers=h)
    assert resp.status_code == 409
    assert _files(documents_dir) == []
    assert SqlDocumentRepository(db).list_for_case(cid) == []


# --- reopen (service only; the admin route lands in increment 4) ----------------------------

def _svc(db, user) -> CaseService:
    cu = CurrentUser(id=user.id, role=user.role, username=user.username)
    return CaseService(SqlCaseRepository(db), cu, SqlDocumentRepository(db))


def test_reopen_service(client, owner, admin, db):
    ou, h = owner
    au, _ = admin
    cid = _new_case(client, h)
    client.post(f"{API}/cases/{cid}/finalize", headers=h)

    with pytest.raises(Exception) as exc:
        _svc(db, ou).reopen(cid)
    assert exc.value.status_code == 403
    reopened = _svc(db, au).reopen(cid.upper())
    assert reopened.status == "draft" and reopened.finalized_at is None
    with pytest.raises(Exception) as exc:
        _svc(db, au).reopen(cid)
    assert exc.value.status_code == 409
    # documents are kept; the owner can edit again
    assert len(client.get(f"{API}/cases/{cid}/documents", headers=h).json()) == 4
    assert client.patch(f"{API}/cases/{cid}", json={"sala": "3"}, headers=h).status_code == 200
