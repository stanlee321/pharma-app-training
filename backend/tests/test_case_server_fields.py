"""Server-owned case fields (status / updated_at / finalized_at / user_id / created_at)."""
from datetime import datetime, timezone

from sqlalchemy import inspect

from app.core.config import settings
from app.core.db import engine
from app.infrastructure.models import CaseModel

from .conftest import IS_SQLITE
from .conftest import fresh_patient_id

SERVER_FIELDS = {"status", "updated_at", "finalized_at", "user_id"}


def _ts(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def _aware(value: datetime) -> datetime:
    """SQLite hands back naive datetimes; every stored stamp is UTC."""
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


def test_new_case_has_server_fields(client, anesthesiologist, auth_headers, db):
    headers = auth_headers(anesthesiologist)
    resp = client.post("/api/v1/cases", json={"patient_id": fresh_patient_id(), "owner": "tester"},
                       headers=headers)
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["status"] == "draft"
    assert body["finalized_at"] is None
    assert body["user_id"] == anesthesiologist.id
    assert _ts(body["updated_at"]).tzinfo is not None

    # The JSON blob never carries the server-owned fields; the columns do.
    row = db.get(CaseModel, body["id"])
    assert row.status == "draft"
    assert not SERVER_FIELDS & set(row.data)


def test_gateway_no_header_falls_back_to_mock_tenant(client, gateway_mode):
    body = client.post("/api/v1/cases", json={"patient_id": fresh_patient_id()}).json()
    assert body["user_id"] == settings.mock_user_id


def test_client_put_cannot_set_server_fields(client, anesthesiologist, auth_headers, db):
    headers = auth_headers(anesthesiologist)
    case_id = "11111111-2222-4333-8444-555555555555"
    forged = {
        "owner": "tester",
        "status": "finalized",
        "finalized_at": "2020-01-01T00:00:00Z",
        "updated_at": "2020-01-01T00:00:00Z",
        "user_id": "someone-else",
        "patient": {"nombre": "Paciente Sintetico"},
        "patient_id": fresh_patient_id(),
    }
    # create path
    resp = client.put(f"/api/v1/cases/{case_id}", json=forged, headers=headers)
    assert resp.status_code == 200, resp.text
    first = resp.json()
    assert first["status"] == "draft"
    assert first["finalized_at"] is None
    assert first["user_id"] == anesthesiologist.id
    assert _ts(first["updated_at"]).year >= 2026

    # replace path: still ignored, updated_at advances
    resp = client.put(f"/api/v1/cases/{case_id}", json=forged, headers=headers)
    assert resp.status_code == 200, resp.text
    second = resp.json()
    assert second["status"] == "draft"
    assert second["user_id"] == anesthesiologist.id
    assert _ts(second["updated_at"]) >= _ts(first["updated_at"])

    db.expire_all()
    row = db.get(CaseModel, case_id)
    assert (row.status, row.finalized_at, row.user_id) == ("draft", None, anesthesiologist.id)
    assert not SERVER_FIELDS & set(row.data)


def test_created_at_cannot_be_forged_on_replace(client, anesthesiologist, auth_headers, db):
    """The DTO created_at always equals the column (which drives ordering and admin filters)."""
    headers = auth_headers(anesthesiologist)
    case_id = "21111111-2222-4333-8444-555555555555"
    # Create path accepts the client-minted created_at (offline-first).
    minted = "2026-09-20T08:30:00+00:00"
    resp = client.put(f"/api/v1/cases/{case_id}",
                      json={"created_at": minted, "patient_id": fresh_patient_id()},
                      headers=headers)
    assert resp.status_code == 200, resp.text
    assert _ts(resp.json()["created_at"]) == _ts(minted)

    resp = client.put(
        f"/api/v1/cases/{case_id}", json={"created_at": "2001-01-01T00:00:00Z"}, headers=headers
    )
    assert resp.status_code == 200, resp.text
    db.expire_all()
    row = db.get(CaseModel, case_id)
    column = _aware(row.created_at)
    assert column == _ts(minted)
    assert _ts(resp.json()["created_at"]) == column
    assert _ts(client.get(f"/api/v1/cases/{case_id}", headers=headers)
               .json()["created_at"]) == column
    assert _ts(row.data["created_at"]) == column  # blob copy not forged either


def test_created_at_read_from_column_even_if_blob_differs(
    client, anesthesiologist, auth_headers, case_factory
):
    row = case_factory(user_id=anesthesiologist.id, created_at="1999-01-01T00:00:00+00:00")
    body = client.get(f"/api/v1/cases/{row.id}", headers=auth_headers(anesthesiologist)).json()
    assert _ts(body["created_at"]).year >= 2026


def test_updated_at_moves_on_every_write(client, anesthesiologist, auth_headers):
    headers = auth_headers(anesthesiologist)
    case = client.post("/api/v1/cases", json={"patient_id": fresh_patient_id()},
                       headers=headers).json()
    t0 = _ts(case["updated_at"])
    patched = client.patch(f"/api/v1/cases/{case['id']}", json={"sala": "3"}, headers=headers)
    assert patched.status_code == 200, patched.text
    t1 = _ts(patched.json()["updated_at"])
    child = client.put(f"/api/v1/cases/{case['id']}/patient", json={"nombre": "X"}, headers=headers)
    assert child.status_code == 200, child.text
    t2 = _ts(client.get(f"/api/v1/cases/{case['id']}", headers=headers).json()["updated_at"])
    assert t0 <= t1 <= t2
    assert t2 > t0


def test_summary_exposes_server_fields(client, case_factory, anesthesiologist, auth_headers):
    uid = anesthesiologist.id
    draft = case_factory(user_id=uid)
    final = case_factory(user_id=uid, status="finalized")
    case_factory(user_id="other-tenant")  # never listed

    resp = client.get("/api/v1/cases", headers=auth_headers(anesthesiologist))
    assert resp.status_code == 200, resp.text
    rows = {r["id"]: r for r in resp.json()}
    assert set(rows) == {draft.id, final.id}
    assert rows[draft.id]["status"] == "draft" and rows[draft.id]["finalized_at"] is None
    assert rows[final.id]["status"] == "finalized" and rows[final.id]["finalized_at"]
    assert all(r["user_id"] == uid and r["updated_at"] for r in rows.values())
    assert all(r["owner_name"] == anesthesiologist.full_name for r in rows.values())

    detail = client.get(f"/api/v1/cases/{final.id}", headers=auth_headers(anesthesiologist)).json()
    assert detail["status"] == "finalized"


def test_owner_name_falls_back_to_username(client, user_factory, auth_headers, case_factory):
    nameless = user_factory(username="sinnombre", full_name="")
    case_factory(user_id=nameless.id)
    rows = client.get("/api/v1/cases", headers=auth_headers(nameless)).json()
    assert [r["owner_name"] for r in rows] == ["sinnombre"]


def test_openapi_marks_status_enum(client):
    schema = client.get("/openapi.json").json()["components"]["schemas"]
    for name in ("AnesthesiaCaseDTO", "CaseSummaryDTO"):
        props = schema[name]["properties"]
        assert set(props["status"]["enum"]) == {"draft", "finalized"}
        assert {"updated_at", "finalized_at", "user_id"} <= set(props)
    assert "owner_name" in schema["CaseSummaryDTO"]["properties"]


def test_data_column_is_jsonb_on_postgres():
    col = {c["name"]: c for c in inspect(engine).get_columns("cases")}["data"]
    expected = "JSON" if IS_SQLITE else "JSONB"
    assert type(col["type"]).__name__.upper() == expected
