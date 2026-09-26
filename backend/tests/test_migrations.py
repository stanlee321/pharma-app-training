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
from app.infrastructure.models import REGISTRO_INDEX, autogenerate_include_object

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
            assert {"status", "updated_at", "finalized_at", "user_id", "patient_id",
                    "data"} <= cols
            assert "ix_cases_status" in {i["name"] for i in insp.get_indexes("cases")}
            diff = compare_metadata(
                MigrationContext.configure(conn, opts={
                    "compare_type": True, "include_object": autogenerate_include_object,
                }), Base.metadata
            )
            assert diff == [], f"models and migrations drifted: {diff}"
            # the expression index autogenerate skips must still exist
            assert REGISTRO_INDEX in _index_names(conn, "patients")
        command.downgrade(cfg, "base")
    finally:
        eng.dispose()


def _index_names(conn, table: str) -> set[str]:
    """Every index of ``table``, expression indexes included (inspect() skips them)."""
    if conn.dialect.name == "sqlite":
        sql = "SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = :t"
    else:
        sql = "SELECT indexname FROM pg_indexes WHERE tablename = :t " \
              "AND schemaname = current_schema()"
    return {r[0] for r in conn.execute(text(sql), {"t": table})}


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


# --- 0009: existing cases grouped into patients ----------------------------------------------

def _seed_0008_cases(conn) -> dict[str, str]:
    """Two users and ten synthetic cases covering every grouping rule (and over-long values). Returns
    ``{label: case_id}`` plus the two user ids."""
    import json
    from datetime import datetime, timedelta, timezone

    t0 = datetime(2026, 9, 1, 8, 0, tzinfo=timezone.utc)
    ua, ub = str(uuid.uuid4()), str(uuid.uuid4())
    for uid, name in ((ua, "mig9-a"), (ub, "mig9-b")):
        conn.execute(text(
            "INSERT INTO users (id, username, full_name, clave, role, password_hash, is_active, "
            "must_change_password, created_at, updated_at) VALUES "
            "(:id, :u, '', '', 'anesthesiologist', '!', true, false, :now, :now)"
        ), {"id": uid, "u": name, "now": t0})

    def patient(**kw):
        return {"patient": kw}

    specs = {
        # registro group (global, across owners): " ABC-1 " + "abc-1" -> one patient
        "reg_old": (ua, 0, patient(registro=" ABC-1 ", nombre="Juan Viejo",
                                   profile={"gender": "male"}, grupo_sanguineo="A", rh="-")),
        "reg_new": (ub, 2, patient(registro="abc-1", nombre=" Juan Nuevo ",
                                   profile={"gender": "female"}, grupo_sanguineo="O", rh="+")),
        # (owner, name) group: A's "maria lopez" + "MARIA LOPEZ " -> one patient
        "name_a1": (ua, 1, patient(registro="  ", nombre="maria lopez")),
        "name_a2": (ua, 3, patient(nombre="MARIA LOPEZ ")),
        # same name, other owner -> a separate patient
        "name_b": (ub, 1, patient(nombre="Maria Lopez")),
        # nothing to group by -> one "Sin nombre" patient each
        "anon1": (ua, 4, patient(nombre="   ")),
        "anon2": (ua, 5, patient()),
        "empty": (ub, 6, {}),
        # a long registro (> the old 64) is still a key; the name is cut to 255 characters
        "long_reg": (ua, 7, patient(registro="R" * 200, nombre="N" * 300)),
        # a registro past 255 is not a key -> falls back to (owner, nombre); name cut to 255
        "huge_reg": (ub, 8, patient(registro="Q" * 300, nombre="L" * 400)),
    }
    ids = {"user_a": ua, "user_b": ub}
    for label, (uid, days, data) in specs.items():
        cid = str(uuid.uuid4())
        at = t0 + timedelta(days=days)
        conn.execute(text(
            "INSERT INTO cases (id, owner, user_id, created_at, status, updated_at, version, "
            "data) VALUES (:id, '', :uid, :at, 'draft', :at, 1, :data)"
        ), {"id": cid, "uid": uid, "at": at, "data": json.dumps(data)})
        ids[label] = cid
    return ids


def _grouping(url: str) -> None:
    from sqlalchemy.exc import IntegrityError

    cfg = _config(url)
    command.upgrade(cfg, "0008")
    eng = create_engine(url)
    try:
        with eng.begin() as conn:
            ids = _seed_0008_cases(conn)
        command.upgrade(cfg, "0009")
        with eng.begin() as conn:
            case_patient = {r[0]: r[1] for r in conn.execute(
                text("SELECT id, patient_id FROM cases"))}
            assert len(case_patient) == 10 and all(case_patient.values())
            patients = {r.id: r for r in conn.execute(text(
                "SELECT id, registro, nombre, sexo, fecha_nacimiento, grupo_sanguineo, rh, "
                "created_by, updated_by FROM patients"))}
            assert len(patients) == 8

            reg = patients[case_patient[ids["reg_old"]]]
            assert case_patient[ids["reg_new"]] == reg.id
            # identity from the most recent case of the group, trimmed
            assert (reg.registro, reg.nombre, reg.sexo, reg.grupo_sanguineo, reg.rh) == (
                "abc-1", "Juan Nuevo", "female", "O", "+")
            assert reg.fecha_nacimiento is None
            assert (reg.created_by, reg.updated_by) == (ids["user_a"], ids["user_b"])

            name_a = patients[case_patient[ids["name_a1"]]]
            assert case_patient[ids["name_a2"]] == name_a.id
            assert name_a.registro is None and name_a.nombre == "MARIA LOPEZ"
            name_b = patients[case_patient[ids["name_b"]]]
            assert name_b.id != name_a.id and name_b.nombre == "Maria Lopez"

            anon = {case_patient[ids[k]] for k in ("anon1", "anon2", "empty")}
            assert len(anon) == 3
            assert {patients[p].nombre for p in anon} == {"Sin nombre"}
            assert {patients[p].registro for p in anon} == {None}

            long_reg = patients[case_patient[ids["long_reg"]]]
            assert long_reg.registro == "R" * 200 and long_reg.nombre == "N" * 255
            huge = patients[case_patient[ids["huge_reg"]]]
            assert huge.registro is None and huge.nombre == "L" * 255

        # the normalized registro is unique (case/whitespace variants collide; NULLs do not)
        with pytest.raises(IntegrityError):
            with eng.begin() as conn:
                conn.execute(text(
                    "INSERT INTO patients (id, registro, nombre, sexo, grupo_sanguineo, rh, "
                    "created_at, updated_at) VALUES (:id, ' ABC-1', 'X', '', '', '', "
                    "'2026-09-25 00:00:00+00:00', '2026-09-25 00:00:00+00:00')"
                ), {"id": str(uuid.uuid4())})
        # cases.patient_id is NOT NULL after the data step
        with pytest.raises(IntegrityError):
            with eng.begin() as conn:
                conn.execute(text("UPDATE cases SET patient_id = NULL WHERE id = :id"),
                             {"id": ids["anon1"]})

        command.downgrade(cfg, "0008")
        with eng.begin() as conn:
            insp = inspect(conn)
            assert "patients" not in insp.get_table_names()
            assert "patient_id" not in {c["name"] for c in insp.get_columns("cases")}
            assert conn.execute(text("SELECT count(*) FROM cases")).scalar() == 10
        command.upgrade(cfg, "head")  # re-grouping after a downgrade works too
        with eng.begin() as conn:
            assert conn.execute(text("SELECT count(*) FROM patients")).scalar() == 8
        command.downgrade(cfg, "base")
    finally:
        eng.dispose()


def test_0009_grouping_sqlite(tmp_path):
    _grouping(f"sqlite:///{tmp_path / 'm9.db'}")


@pytest.mark.skipif(IS_SQLITE, reason="Postgres grouping needs TIVA_TEST_DATABASE_URL")
def test_0009_grouping_postgres_schema():
    schema = f"mig9_{uuid.uuid4().hex[:10]}"
    admin = create_engine(BASE_TEST_DATABASE_URL)
    with admin.begin() as conn:
        conn.execute(text(f'CREATE SCHEMA "{schema}"'))
    try:
        _grouping(schema_scoped_url(BASE_TEST_DATABASE_URL, schema))
    finally:
        with admin.begin() as conn:
            conn.execute(text(f'DROP SCHEMA IF EXISTS "{schema}" CASCADE'))
        admin.dispose()


def _unicode_registro_grouping(url: str) -> None:
    """Legacy 'İ-7' and 'i-7': Python lower() keeps them apart ('i̇-7' vs 'i-7'), Postgres'
    lower() (the unique index) makes them equal. 0009 must group them into ONE patient instead
    of aborting with a UniqueViolation."""
    import json
    from datetime import datetime, timezone

    cfg = _config(url)
    command.upgrade(cfg, "0008")
    eng = create_engine(url)
    try:
        t0 = datetime(2026, 9, 1, 8, 0, tzinfo=timezone.utc)
        uid = str(uuid.uuid4())
        ids = [str(uuid.uuid4()) for _ in range(2)]
        with eng.begin() as conn:
            conn.execute(text(
                "INSERT INTO users (id, username, full_name, clave, role, password_hash, "
                "is_active, must_change_password, created_at, updated_at) VALUES "
                "(:id, 'mig9-u', '', '', 'anesthesiologist', '!', true, false, :now, :now)"
            ), {"id": uid, "now": t0})
            for cid, reg in zip(ids, ("İ-7", "i-7")):
                conn.execute(text(
                    "INSERT INTO cases (id, owner, user_id, created_at, status, updated_at, "
                    "version, data) VALUES (:id, '', :uid, :at, 'draft', :at, 1, :data)"
                ), {"id": cid, "uid": uid, "at": t0,
                    "data": json.dumps({"patient": {"registro": reg, "nombre": "Sintetico"}})})
        command.upgrade(cfg, "0009")
        with eng.begin() as conn:
            pids = {r[0] for r in conn.execute(text("SELECT patient_id FROM cases"))}
            assert len(pids) == 1
            assert conn.execute(text("SELECT count(*) FROM patients")).scalar() == 1
        command.downgrade(cfg, "base")
    finally:
        eng.dispose()


@pytest.mark.skipif(IS_SQLITE, reason="SQLite lower() is ASCII-only; Postgres is authoritative")
def test_0009_groups_by_the_db_registro_key_postgres_schema():
    schema = f"mig9u_{uuid.uuid4().hex[:10]}"
    admin = create_engine(BASE_TEST_DATABASE_URL)
    with admin.begin() as conn:
        conn.execute(text(f'CREATE SCHEMA "{schema}"'))
    try:
        _unicode_registro_grouping(schema_scoped_url(BASE_TEST_DATABASE_URL, schema))
    finally:
        with admin.begin() as conn:
            conn.execute(text(f'DROP SCHEMA IF EXISTS "{schema}" CASCADE'))
        admin.dispose()
