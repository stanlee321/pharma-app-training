"""Must-fixes from the increment-3 review: the finalized lock under concurrency.

1. A draft write authorised BEFORE a concurrent finalize committed must not land afterwards
   (the save is a conditional UPDATE on ``status='draft'``).
2. Finalize must not lock data its PDFs do not show: a write that commits while the four
   forms render makes finalize fail with 409 (compare-and-set on the rendered ``version``).

Both use two real DB sessions (the API request + an independent ``SessionLocal``). All data
synthetic.
"""
import pytest
from fastapi import HTTPException

from app.application import document_service
from app.application.case_service import FINALIZED_DETAIL, CaseService
from app.application.document_service import FINALIZE_CONFLICT_DETAIL
from app.application.identity import CurrentUser
from app.core.db import SessionLocal
from app.infrastructure.models import CaseModel
from app.infrastructure.repository import SqlCaseRepository, SqlDocumentRepository

API = "/api/v1"


def _service(session, user) -> CaseService:
    cu = CurrentUser(id=user.id, role=user.role, username=user.username,
                     full_name=user.full_name, clave=user.clave)
    return CaseService(SqlCaseRepository(session), cu, SqlDocumentRepository(session))


@pytest.fixture
def owner(anesthesiologist, auth_headers):
    return anesthesiologist, auth_headers(anesthesiologist)


def _new_case(client, headers, nombre="NOMBRE ORIGINAL") -> str:
    cid = client.post(f"{API}/cases", json={}, headers=headers).json()["id"]
    assert client.put(f"{API}/cases/{cid}/patient", json={"nombre": nombre},
                      headers=headers).status_code == 200
    return cid


def test_draft_write_authorised_before_finalize_is_refused(client, owner, db):
    user, h = owner
    cid = _new_case(client, h)
    session_a = SessionLocal()
    try:
        svc = _service(session_a, user)
        m = svc.writable(cid)                      # passes: still a draft
        case = svc._load(m)
        case.patient.nombre = "NOMBRE MUTADO"

        assert client.post(f"{API}/cases/{cid}/finalize", headers=h).status_code == 200

        with pytest.raises(HTTPException) as exc:
            svc._persist(m, case)                  # the late write
        assert exc.value.status_code == 409
        assert exc.value.detail == FINALIZED_DETAIL
    finally:
        session_a.close()

    got = client.get(f"{API}/cases/{cid}", headers=h).json()
    assert got["status"] == "finalized"
    assert got["patient"]["nombre"] == "NOMBRE ORIGINAL"


def test_owner_delete_authorised_before_finalize_is_refused(client, owner, db, stored_objects):
    user, h = owner
    cid = _new_case(client, h)
    session_a = SessionLocal()
    try:
        svc = _service(session_a, user)
        m = svc.writable(cid)
        assert client.post(f"{API}/cases/{cid}/finalize", headers=h).status_code == 200
        with pytest.raises(HTTPException) as exc:
            svc._delete_with_documents(m, draft_only=True)
        assert exc.value.status_code == 409
    finally:
        session_a.close()
    assert client.get(f"{API}/cases/{cid}", headers=h).json()["status"] == "finalized"
    assert stored_objects() == 4


def test_write_committed_during_finalize_render_is_409_and_cleans_up(
    client, owner, db, stored_objects, monkeypatch
):
    user, h = owner
    cid = _new_case(client, h)
    real_render = document_service.render_case_pdf
    rendered_names: list[str] = []
    state = {"raced": False}

    def racing_render(case, form_id, *args, **kwargs):
        rendered_names.append(case.patient.nombre)
        if not state["raced"]:
            state["raced"] = True
            other = SessionLocal()           # a concurrent PUT from another request
            try:
                _service(other, user).put_child(cid, "patient", {"nombre": "NOMBRE NUEVO"})
            finally:
                other.close()
        return real_render(case, form_id, *args, **kwargs)

    monkeypatch.setattr(document_service, "render_case_pdf", racing_render)
    resp = client.post(f"{API}/cases/{cid}/finalize", headers=h)
    assert resp.status_code == 409, resp.text
    assert resp.json() == {"detail": FINALIZE_CONFLICT_DETAIL}
    assert set(rendered_names) == {"NOMBRE ORIGINAL"}

    # nothing half-applied: still a draft with the concurrent write, no rows, no files
    db.expire_all()
    row = db.get(CaseModel, cid)
    assert (row.status, row.finalized_at) == ("draft", None)
    assert row.data["patient"]["nombre"] == "NOMBRE NUEVO"
    assert SqlDocumentRepository(db).list_for_case(cid) == []
    assert stored_objects() == 0

    # a retry renders (and locks) the current data
    rendered_names.clear()
    resp = client.post(f"{API}/cases/{cid}/finalize", headers=h)
    assert resp.status_code == 200, resp.text
    assert set(rendered_names) == {"NOMBRE NUEVO"}
    assert resp.json()["patient"]["nombre"] == "NOMBRE NUEVO"
    assert stored_objects() == 4


def test_every_write_bumps_version(client, owner, db):
    _, h = owner
    cid = _new_case(client, h)

    def version() -> int:
        db.expire_all()
        return db.get(CaseModel, cid).version

    v0 = version()
    client.patch(f"{API}/cases/{cid}", json={"sala": "2"}, headers=h)
    v1 = version()
    client.post(f"{API}/cases/{cid}/finalize", headers=h)
    v2 = version()
    assert v0 < v1 < v2
