"""End-to-end smoke tests for the TivaTrainer API.

Run from the backend/ directory so `app` is importable:  cd backend && python -m pytest

The DB URL is pinned to an isolated SQLite file *before* importing the app, because
`app.core.config.Settings()` and `app.core.db.engine` are both instantiated at import
time. The autouse module-scoped fixture guarantees a clean schema for this module.
"""
import os

# MUST be set before importing the app: config/engine bind the DB URL at import time.
os.environ["TIVA_DATABASE_URL"] = "sqlite:///./test_tiva.db"

import pathlib

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.core.db import Base, engine

client = TestClient(app)

_DB_FILE = pathlib.Path("./test_tiva.db")


def _remove_db() -> None:
    engine.dispose()
    if _DB_FILE.exists():
        _DB_FILE.unlink()


@pytest.fixture(autouse=True, scope="module")
def _isolated_db():
    # Start from a clean file + fresh schema, tear the file down afterwards.
    _remove_db()
    Base.metadata.create_all(engine)
    yield
    _remove_db()


def test_health():
    resp = client.get("/health")
    assert resp.status_code == 200
    assert resp.json() == {"status": "ok"}


def test_case_lifecycle():
    # create
    resp = client.post("/api/v1/cases", json={"owner": "tester"})
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
