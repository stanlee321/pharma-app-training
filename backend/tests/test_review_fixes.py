"""Must-fixes from the increment-2 review: canonical case ids, 422 (not 500) on invalid
bodies, typed openapi for every /cases route, and weak JWT secrets refused at startup."""
import pytest
from fastapi.testclient import TestClient

from app import main as app_main
from app.core.config import settings
from app.main import app as fastapi_app

from .conftest import fresh_patient_id

API = "/api/v1"
CID = "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d"


@pytest.fixture
def lenient(client):
    """A client that returns 500s instead of raising them (so a 500 would fail the assert)."""
    return TestClient(fastapi_app, raise_server_exceptions=False)


def test_uppercase_case_id_addresses_the_same_row(client, anesthesiologist, auth_headers):
    h = auth_headers(anesthesiologist)
    resp = client.put(f"{API}/cases/{CID.upper()}",
                      json={"sala": "1", "patient_id": fresh_patient_id()}, headers=h)
    assert resp.status_code == 200 and resp.json()["id"] == CID
    got = client.get(f"{API}/cases/{CID}", headers=h)
    assert got.status_code == 200 and got.json()["sala"] == "1"
    assert client.put(f"{API}/cases/{CID}", json={"sala": "2"}, headers=h).status_code == 200
    assert client.get(f"{API}/cases/{CID.upper()}", headers=h).json()["sala"] == "2"
    assert [c["id"] for c in client.get(f"{API}/cases", headers=h).json()] == [CID]
    assert client.post(f"{API}/cases/{CID.upper()}/drugs", json={"farmaco": "Propofol"},
                       headers=h).status_code == 200


def test_uppercase_id_of_another_users_case_is_403(client, user_factory, auth_headers):
    a = user_factory(username="dueno_a")
    b = user_factory(username="intruso_b")
    ha, hb = auth_headers(a), auth_headers(b)
    assert client.put(f"{API}/cases/{CID}", json={"sala": "A", "patient_id": fresh_patient_id()},
                      headers=ha).status_code == 200
    resp = client.put(f"{API}/cases/{CID.upper()}",
                      json={"sala": "B", "patient_id": fresh_patient_id()}, headers=hb)
    assert resp.status_code == 403
    assert client.get(f"{API}/cases", headers=hb).json() == []
    assert client.get(f"{API}/cases/{CID}", headers=ha).json()["sala"] == "A"


def test_invalid_bodies_are_422_not_500(lenient, anesthesiologist, auth_headers):
    h = auth_headers(anesthesiologist)
    assert lenient.put(f"{API}/cases/not-a-uuid", json={}, headers=h).status_code == 422
    assert lenient.get(f"{API}/cases/not-a-uuid", headers=h).status_code == 422
    assert lenient.put(f"{API}/cases/{CID}", json={"patient": "x"}, headers=h).status_code == 422
    assert lenient.put(f"{API}/cases/{CID}", json={}, headers=h).status_code == 422  # no patient
    assert lenient.put(f"{API}/cases/{CID}", json={"patient_id": "not-a-uuid"},
                       headers=h).status_code == 422
    assert lenient.put(f"{API}/cases/{CID}", json={"patient_id": fresh_patient_id()},
                       headers=h).status_code == 200
    assert lenient.post(f"{API}/cases/{CID}/drugs", json={"dose_value": "abc"},
                        headers=h).status_code == 422
    drug = lenient.post(f"{API}/cases/{CID}/drugs", json={"farmaco": "Propofol"}, headers=h)
    did = drug.json()["id"]
    assert lenient.patch(f"{API}/cases/{CID}/drugs/{did}", json={"dose_value": "abc"},
                         headers=h).status_code == 422
    assert lenient.patch(f"{API}/cases/{CID}/drugs/not-a-uuid", json={},
                         headers=h).status_code == 422
    assert lenient.put(f"{API}/cases/{CID}/patient", json={"profile": "x"},
                       headers=h).status_code == 422
    # a partial PATCH merges only the sent keys
    patched = lenient.patch(f"{API}/cases/{CID}/drugs/{did}", json={"dose_value": 5},
                            headers=h).json()
    assert patched["farmaco"] == "Propofol" and patched["dose_value"] == 5


def test_service_level_validation_error_is_422():
    from fastapi import HTTPException

    from app.application.case_service import validate_input
    from app.application.dto import DrugAdministrationDTO

    with pytest.raises(HTTPException) as exc:
        validate_input(DrugAdministrationDTO, {"dose_value": "abc"})
    assert exc.value.status_code == 422 and exc.value.detail[0]["loc"] == ["dose_value"]


def test_unknown_child_resource_is_not_found(client, anesthesiologist, auth_headers):
    h = auth_headers(anesthesiologist)
    client.put(f"{API}/cases/{CID}", json={"patient_id": fresh_patient_id()}, headers=h)
    assert client.get(f"{API}/cases/{CID}/nonexistent", headers=h).status_code == 404
    assert client.put(f"{API}/cases/{CID}/nonexistent", json={},
                      headers=h).status_code in (404, 405)


def test_every_cases_route_is_typed(client):
    spec = client.get("/openapi.json").json()
    typed_prefixes = tuple(f"{API}/{p}" for p in ("cases", "documents", "forms", "admin",
                                                     "patients"))
    walked = set()
    for path, ops in spec["paths"].items():
        if not path.startswith(typed_prefixes):
            continue
        walked.add(path.split("/")[3])
        for method, op in ops.items():
            responses = op["responses"]
            if "204" in responses:
                continue
            content = responses["200"].get("content", {})
            assert content, (method, path)
            if "application/pdf" in content:
                continue
            schema = content["application/json"]["schema"]
            assert schema.get("$ref") or schema.get("items", {}).get("$ref"), (method, path)
            if method in ("put", "post", "patch") and not path.endswith(("/finalize", "/reopen")):
                body = op.get("requestBody", {}).get("content", {}).get("application/json", {})
                assert body.get("schema", {}).get("$ref"), (method, path)
    assert walked == {"cases", "documents", "forms", "admin", "patients"}
    schemas = spec["components"]["schemas"]
    write = schemas["AnesthesiaCaseWrite"]["properties"]
    assert not {"status", "updated_at", "finalized_at", "user_id"} & set(write)
    assert "patient_id" in write and "patient_id" in schemas["AnesthesiaCaseDTO"]["properties"]
    assert "patient_id" in schemas["CreateCaseRequest"]["required"]
    assert set(schemas["GenerateDocumentRequest"]["properties"]["form_id"]["enum"]) == {
        "registro_transanestesico", "nota_postanestesica", "imss_valoracion_preanestesica",
        "imss_registro_anestesia"}
    assert "storage_path" not in schemas["DocumentDTO"]["properties"]
    op_ids = [op["operationId"] for p in spec["paths"].values() for op in p.values()]
    assert len(op_ids) == len(set(op_ids))


@pytest.mark.parametrize("secret, message", [
    ("replace-me-with-a-long-random-secret", "placeholder"),
    ("short-secret", "at least 32 bytes"),
    ("x" * 31, "at least 32 bytes"),
])
def test_weak_jwt_secret_refused(monkeypatch, secret, message):
    monkeypatch.setattr(settings, "auth_mode", "local")
    monkeypatch.setattr(settings, "jwt_secret", secret)
    with pytest.raises(RuntimeError, match=message):
        app_main.check_auth_config()
    monkeypatch.setattr(settings, "jwt_secret", "y" * 32)
    app_main.check_auth_config()
    monkeypatch.setattr(settings, "jwt_secret", secret)
    monkeypatch.setattr(settings, "auth_mode", "gateway")
    app_main.check_auth_config()  # gateway mode issues no tokens


def test_env_example_placeholder_is_the_refused_one():
    from pathlib import Path

    text = (Path(__file__).resolve().parents[1] / ".env.example").read_text()
    assert f"TIVA_JWT_SECRET={app_main.JWT_SECRET_PLACEHOLDER}" in text
