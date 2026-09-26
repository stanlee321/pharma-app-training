"""End-to-end smoke tests for the TivaTrainer API.

Run from the backend/ directory so `app` is importable:  cd backend && python -m pytest

DB wiring (temp SQLite by default, Postgres via TIVA_TEST_DATABASE_URL), schema creation and
per-test isolation live in tests/conftest.py; `client` is its TestClient fixture.
"""
from .conftest import fresh_patient_id


def test_health(client):
    resp = client.get("/health")
    assert resp.status_code == 200
    assert resp.json() == {"status": "ok"}


def test_case_lifecycle(client, anesthesiologist, auth_headers):
    client.headers.update(auth_headers(anesthesiologist))
    # create
    resp = client.post("/api/v1/cases", json={"patient_id": fresh_patient_id(), "owner": "tester"})
    assert resp.status_code == 200, resp.text
    case_id = resp.json()["id"]
    assert case_id

    # patient child (server derives imc/peso_ideal/vsc)
    resp = client.put(
        f"/api/v1/cases/{case_id}/patient",
        json={
            "nombre": "N. Pérez",
            "profile": {"weight": 72, "height": 161, "age": 54, "gender": "female"},
        },
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["imc"] is not None

    # list contains the new case
    resp = client.get("/api/v1/cases")
    assert resp.status_code == 200, resp.text
    assert case_id in [c["id"] for c in resp.json()]

    # recovery score: full Aldrete column of 2s -> total 10 at time point "0"
    resp = client.put(
        f"/api/v1/cases/{case_id}/recovery-score",
        json={
            "aldrete": {
                "Actividad": {"0": 2},
                "Respiración": {"0": 2},
                "Circulación": {"0": 2},
                "Conciencia": {"0": 2},
                "Coloración": {"0": 2},
            }
        },
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["totals"]["0"] == 10

    # add a drug to the collection
    resp = client.post(
        f"/api/v1/cases/{case_id}/drugs",
        json={"farmaco": "Propofol", "dose_value": 120},
    )
    assert resp.status_code == 200, resp.text

    # export the post-anesthesia note as a PDF
    resp = client.post(f"/api/v1/cases/{case_id}/export/nota_postanestesica")
    assert resp.status_code == 200, resp.text
    assert resp.headers["content-type"].startswith("application/pdf")
