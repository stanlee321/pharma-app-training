"""Alembic round-trip: upgrade head -> downgrade base -> upgrade head, then no model drift.

Always runs on a fresh SQLite file. When the suite targets Postgres (TIVA_TEST_DATABASE_URL),
it also runs inside a throwaway schema of that test database (search_path pinned through the
connection ``options``), so it never touches the dev DB nor the suite's own tables.
"""
import uuid
from pathlib import Path

import pytest
from alembic import command
from alembic.autogenerate import compare_metadata
from alembic.config import Config
from alembic.migration import MigrationContext
from alembic.script import ScriptDirectory
from sqlalchemy import create_engine, inspect, text

from app.core.db import Base

from .conftest import BASE_TEST_DATABASE_URL, IS_SQLITE, schema_scoped_url

BACKEND_DIR = Path(__file__).resolve().parents[1]


def _config(url: str) -> Config:
    cfg = Config(str(BACKEND_DIR / "alembic.ini"))
    cfg.set_main_option("script_location", str(BACKEND_DIR / "alembic"))
    cfg.set_main_option("sqlalchemy.url", url.replace("%", "%%"))  # configparser escaping
    return cfg


def _round_trip(url: str) -> None:
    cfg = _config(url)
    command.upgrade(cfg, "head")
    command.downgrade(cfg, "base")
    command.upgrade(cfg, "head")

    eng = create_engine(url)
    try:
        with eng.connect() as conn:
            head = ScriptDirectory.from_config(cfg).get_current_head()
            assert conn.execute(text("SELECT version_num FROM alembic_version")).scalar() == head
            insp = inspect(conn)
            cols = {c["name"] for c in insp.get_columns("cases")}
            assert {"status", "updated_at", "finalized_at", "user_id", "data"} <= cols
            assert "ix_cases_status" in {i["name"] for i in insp.get_indexes("cases")}
            diff = compare_metadata(
                MigrationContext.configure(conn, opts={"compare_type": True}), Base.metadata
            )
            assert diff == [], f"models and migrations drifted: {diff}"
        command.downgrade(cfg, "base")
    finally:
        eng.dispose()


def test_round_trip_sqlite(tmp_path):
    _round_trip(f"sqlite:///{tmp_path / 'migrate.db'}")


@pytest.mark.skipif(IS_SQLITE, reason="Postgres round-trip needs TIVA_TEST_DATABASE_URL")
def test_round_trip_postgres_schema():
    schema = f"mig_{uuid.uuid4().hex[:10]}"
    admin = create_engine(BASE_TEST_DATABASE_URL)
    with admin.begin() as conn:
        conn.execute(text(f'CREATE SCHEMA "{schema}"'))
    try:
        _round_trip(schema_scoped_url(BASE_TEST_DATABASE_URL, schema))
    finally:
        with admin.begin() as conn:
            conn.execute(text(f'DROP SCHEMA IF EXISTS "{schema}" CASCADE'))
        admin.dispose()


# --- 0008: local files -> document_blobs (and back on downgrade) ---------------------------

def _seed_0007(conn, root: Path) -> dict[str, str]:
    """A user, a case and three pre-0008 document rows: a good file, a missing file and a
    tampered one. Returns ``{label: document_id}``. All data synthetic."""
    import hashlib
    from datetime import datetime, timezone

    now = datetime(2026, 9, 25, 10, 11, 12, 123456, tzinfo=timezone.utc)
    uid, cid = str(uuid.uuid4()), str(uuid.uuid4())
    conn.execute(text(
        "INSERT INTO users (id, username, full_name, clave, role, password_hash, is_active, "
        "must_change_password, created_at, updated_at) VALUES "
        "(:id, 'mig-user', '', '', 'anesthesiologist', '!', true, false, :now, :now)"
    ), {"id": uid, "now": now})
    conn.execute(text(
        "INSERT INTO cases (id, owner, user_id, created_at, status, updated_at, version, data) "
        "VALUES (:id, 'tester', :uid, :now, 'draft', :now, 1, :data)"
    ), {"id": cid, "uid": uid, "now": now, "data": "{}"})
    ids = {}
    for label, form in (("good", "nota_postanestesica"), ("missing", "registro_transanestesico"),
                        ("tampered", "imss_registro_anestesia")):
        data = f"%PDF-1.7 synthetic {label}".encode()
        path = root / cid / f"{form}_{now:%Y%m%dT%H%M%S%f}.pdf"
        if label != "missing":
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(data if label == "good" else b"%PDF-changed on disk")
        doc_id = str(uuid.uuid4())
        conn.execute(text(
            "INSERT INTO documents (id, case_id, form_id, storage_path, size_bytes, sha256, "
            "is_fallback, created_at) VALUES (:id, :cid, :form, :path, :n, :sha, false, :now)"
        ), {"id": doc_id, "cid": cid, "form": form, "path": str(path), "n": len(data),
            "sha": hashlib.sha256(data).hexdigest(), "now": now})
        ids[label] = doc_id
    ids["case"] = cid
    return ids


def _docs(conn) -> dict[str, tuple]:
    return {r[0]: (r[1], r[2]) for r in conn.execute(
        text("SELECT id, storage_backend, storage_path FROM documents"))}


def _blob_bytes(conn, doc_id):
    got = conn.execute(text("SELECT content FROM document_blobs WHERE document_id = :i"),
                       {"i": doc_id}).scalar()
    return bytes(got) if got is not None else None


def _data_step(url: str, root: Path) -> None:
    import hashlib

    cfg = _config(url)
    cfg.attributes["documents_dir"] = str(root)
    command.upgrade(cfg, "0007")
    eng = create_engine(url)
    try:
        with eng.begin() as conn:
            ids = _seed_0007(conn, root)
        good_file = root / ids["case"]
        good_path = [p for p in good_file.iterdir() if p.name.startswith("nota_")][0]
        good_bytes = good_path.read_bytes()

        command.upgrade(cfg, "0008")
        with eng.begin() as conn:
            docs = _docs(conn)
            assert docs[ids["good"]] == ("db", None)
            assert _blob_bytes(conn, ids["good"]) == good_bytes
            # unreadable / mismatching files stay local, untouched
            assert docs[ids["missing"]][0] == "local" and docs[ids["missing"]][1]
            assert docs[ids["tampered"]][0] == "local"
            assert _blob_bytes(conn, ids["missing"]) is None
            assert _blob_bytes(conn, ids["tampered"]) is None
            # a db-only document created after the upgrade (no file anywhere)
            fresh_id = str(uuid.uuid4())
            fresh = b"%PDF-1.7 db only \x00\xff"
            conn.execute(text(
                "INSERT INTO documents (id, case_id, form_id, storage_backend, storage_path, "
                "size_bytes, sha256, is_fallback, created_at) VALUES (:id, :cid, "
                "'nota_postanestesica', 'db', NULL, :n, :sha, false, :now)"
            ), {"id": fresh_id, "cid": ids["case"], "n": len(fresh),
                "sha": hashlib.sha256(fresh).hexdigest(), "now": "2026-09-25 11:00:00+00:00"})
            conn.execute(text(
                "INSERT INTO document_blobs (document_id, content, created_at) "
                "VALUES (:id, :c, :now)"
            ), {"id": fresh_id, "c": fresh, "now": "2026-09-25 11:00:00+00:00"})
        assert good_path.read_bytes() == good_bytes  # the source file is left on disk

        command.downgrade(cfg, "0007")
        with eng.begin() as conn:
            rows = {r[0]: r[1] for r in conn.execute(
                text("SELECT id, storage_path FROM documents"))}
            assert rows[ids["good"]] == str(good_path)  # the identical pre-0008 file is reused
            restored = Path(rows[fresh_id])
            assert restored.is_absolute() and restored.parent == root / ids["case"]
            assert restored.name == "nota_postanestesica_20260925T110000000000.pdf"
            assert restored.read_bytes() == fresh
            assert "document_blobs" not in inspect(conn).get_table_names()
        command.downgrade(cfg, "base")
    finally:
        eng.dispose()


def test_0008_data_step_sqlite(tmp_path):
    _data_step(f"sqlite:///{tmp_path / 'm8.db'}", (tmp_path / "docs").resolve())


def test_0008_downgrade_refuses_unwritable_root(tmp_path):
    url = f"sqlite:///{tmp_path / 'm8r.db'}"
    root = (tmp_path / "docs").resolve()
    cfg = _config(url)
    cfg.attributes["documents_dir"] = str(root)
    command.upgrade(cfg, "0007")
    eng = create_engine(url)
    try:
        with eng.begin() as conn:
            ids = _seed_0007(conn, root)
        command.upgrade(cfg, "head")
        blocker = tmp_path / "not-a-dir"
        blocker.write_bytes(b"x")  # a file where the root directory should be
        cfg.attributes["documents_dir"] = str(blocker)
        with pytest.raises(RuntimeError, match="not writable"):
            command.downgrade(cfg, "0007")
        with eng.connect() as conn:
            assert conn.execute(text("SELECT version_num FROM alembic_version")).scalar() == "0008"
            assert _blob_bytes(conn, ids["good"]) is not None

    finally:
        eng.dispose()


@pytest.mark.skipif(IS_SQLITE, reason="Postgres data step needs TIVA_TEST_DATABASE_URL")
def test_0008_data_step_postgres_schema(tmp_path):
    schema = f"mig8_{uuid.uuid4().hex[:10]}"
    admin = create_engine(BASE_TEST_DATABASE_URL)
    with admin.begin() as conn:
        conn.execute(text(f'CREATE SCHEMA "{schema}"'))
    try:
        _data_step(schema_scoped_url(BASE_TEST_DATABASE_URL, schema),
                   (tmp_path / "docs").resolve())
    finally:
        with admin.begin() as conn:
            conn.execute(text(f'DROP SCHEMA IF EXISTS "{schema}" CASCADE'))
        admin.dispose()
