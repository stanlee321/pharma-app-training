"""Shared pytest wiring for the backend suite (reused by every later increment).

Test database
-------------
* ``TIVA_TEST_DATABASE_URL`` unset  -> a fresh SQLite file in a temp dir (fast default).
* ``TIVA_TEST_DATABASE_URL`` set    -> that database, e.g.
  ``postgresql+psycopg://tiva:tiva@localhost:5433/tiva_test``. Its name MUST contain "test"
  (the suite refuses anything that looks like the dev database). Each pytest session gets its
  OWN schema ``test_<pid>_<hex>`` in that database: the app engine's ``search_path`` is pinned
  to it through the connection ``options`` (``-csearch_path=...``), it is created at session
  start and dropped (CASCADE) at teardown. Concurrent suites against the same database
  therefore never see each other's tables; ``public`` is never touched.

The URL is exported as ``TIVA_DATABASE_URL`` (and ``TIVA_DOCUMENTS_DIR`` as a temp dir) BEFORE
the app is imported, because ``app.core.config.settings`` and ``app.core.db.engine`` bind at
import time. Test modules must therefore never import ``app`` before this file runs (pytest
always loads conftest.py first) and must not set ``TIVA_DATABASE_URL`` themselves.

Isolation
---------
The schema is built once per session from ``Base.metadata`` (the migrations are exercised
separately in ``test_migrations.py``). After every test all tables are emptied, so each test
starts from an empty database regardless of order.

Auth
----
The suite runs in ``local`` auth mode with a fixed test JWT secret (Bearer required).
``gateway_mode`` flips ``settings.auth_mode`` to ``gateway`` for one test (legacy X-User-Id).

Fixtures
--------
``client`` (TestClient), ``db`` (a SQLAlchemy Session), ``user_factory`` (insert a user —
role/username/password/full_name/clave/is_active), ``auth_headers`` (Bearer headers for a user
row, minted directly), ``anesthesiologist`` / ``admin_user`` (ready users),
``patient_factory`` (insert a patient row directly; returns the PatientModel),
``case_factory`` (insert a case row directly — any ``user_id``/``status``; the owning user row is
created when missing, and a fresh patient unless ``patient_id`` is given),
``new_case`` (create a case through ``POST /cases`` for a fresh patient, or ``patient_id=``;
returns the response JSON), ``gateway_mode``, ``tenant_headers`` (legacy gateway ``X-User-Id``
headers for a tenant id), ``documents_dir`` (this test's storage root, a ``tmp_path`` dir),
``document_storage`` (the ``LocalFileStorage`` the app uses in this test), ``test_database_url``,
``local_mode`` / ``db_mode`` (force ``TIVA_DOCUMENT_STORAGE`` for one test), ``stored_objects``
(files under the storage root + ``document_blobs`` rows, whatever the mode).

Document storage
----------------
Every test gets its own ``LocalFileStorage`` rooted in ``tmp_path`` (autouse override of the
``get_local_storage`` dependency), so stored PDFs never leak between tests. New documents go to
``TIVA_DOCUMENT_STORAGE`` — ``db`` unless the variable is set when pytest starts, so
``TIVA_DOCUMENT_STORAGE=local python -m pytest`` reruns the mode-agnostic tests on local files.
Tests about one specific backend request ``local_mode`` or ``db_mode``.
"""
from __future__ import annotations

import os
import shutil
import tempfile
import uuid
from datetime import datetime, timezone
from pathlib import Path

import pytest
from sqlalchemy.engine import make_url

_TMP_ROOT = Path(tempfile.mkdtemp(prefix="tiva_tests_"))

# The database as given (no search_path pin); used to create/drop per-session schemas.
BASE_TEST_DATABASE_URL = os.environ.get("TIVA_TEST_DATABASE_URL") or (
    f"sqlite:///{_TMP_ROOT / 'test_tiva.db'}"
)
_url = make_url(BASE_TEST_DATABASE_URL)
IS_SQLITE = _url.get_backend_name() == "sqlite"
if not IS_SQLITE and "test" not in (_url.database or "").lower():
    raise pytest.UsageError(
        f"TIVA_TEST_DATABASE_URL must point at a throwaway database whose name contains "
        f"'test' (got database={_url.database!r}); the suite creates schemas there."
    )


def schema_scoped_url(base_url: str, schema: str) -> str:
    """``base_url`` with every connection's search_path pinned to ``schema`` (Postgres)."""
    return make_url(base_url).update_query_dict(
        {"options": f"-csearch_path={schema}"}
    ).render_as_string(hide_password=False)


if IS_SQLITE:
    TEST_SCHEMA = None
    TEST_DATABASE_URL = BASE_TEST_DATABASE_URL
else:
    TEST_SCHEMA = f"test_{os.getpid()}_{uuid.uuid4().hex[:8]}"
    TEST_DATABASE_URL = schema_scoped_url(BASE_TEST_DATABASE_URL, TEST_SCHEMA)

TEST_DOCUMENTS_DIR = _TMP_ROOT / "documents"

# MUST happen before importing the app (settings + engine bind at import time).
os.environ["TIVA_DATABASE_URL"] = TEST_DATABASE_URL
os.environ["TIVA_DOCUMENTS_DIR"] = str(TEST_DOCUMENTS_DIR)
# Real env var wins (a "local" run of the suite); otherwise db, whatever backend/.env says.
os.environ.setdefault("TIVA_DOCUMENT_STORAGE", "db")
os.environ["TIVA_AUTH_MODE"] = "local"
os.environ["TIVA_JWT_SECRET"] = "test-only-secret-" + "x" * 40  # >= 32 bytes for HS256
os.environ["TIVA_JWT_TTL_MINUTES"] = "720"
os.environ["TIVA_BOOTSTRAP_ADMIN_USERNAME"] = ""
os.environ["TIVA_BOOTSTRAP_ADMIN_PASSWORD"] = ""

TEST_PASSWORD = "Sint3tico-pass"

from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy import create_engine, func, select, text  # noqa: E402

from app.api.deps import get_local_storage  # noqa: E402
from app.core import security  # noqa: E402
from app.core.config import settings  # noqa: E402
from app.core.db import Base, SessionLocal, engine  # noqa: E402
from app.infrastructure import models  # noqa: E402
from app.infrastructure.storage import LocalFileStorage  # noqa: E402
from app.main import app as fastapi_app  # noqa: E402

assert settings.database_url == TEST_DATABASE_URL, "app imported before tests/conftest.py"


def _run_on_base(sql: str) -> None:
    """Execute DDL on the un-pinned test database (schema create/drop)."""
    admin = create_engine(BASE_TEST_DATABASE_URL)
    try:
        with admin.begin() as conn:
            conn.execute(text(sql))
    finally:
        admin.dispose()


@pytest.fixture(scope="session", autouse=True)
def _schema():
    if IS_SQLITE:
        Base.metadata.drop_all(engine)
    else:
        _run_on_base(f'CREATE SCHEMA "{TEST_SCHEMA}"')
    try:
        Base.metadata.create_all(engine)
        yield
    finally:
        engine.dispose()
        if not IS_SQLITE:
            _run_on_base(f'DROP SCHEMA IF EXISTS "{TEST_SCHEMA}" CASCADE')
        shutil.rmtree(_TMP_ROOT, ignore_errors=True)


@pytest.fixture(autouse=True)
def _clean_tables():
    """Empty every table after each test (children first) and wipe stored documents."""
    yield
    with engine.begin() as conn:
        for table in reversed(Base.metadata.sorted_tables):
            conn.execute(table.delete())
    shutil.rmtree(TEST_DOCUMENTS_DIR, ignore_errors=True)


@pytest.fixture
def test_database_url() -> str:
    return TEST_DATABASE_URL


@pytest.fixture(autouse=True)
def document_storage(tmp_path) -> LocalFileStorage:
    """Per-test storage root (absolute, resolved) wired into the app via dependency override."""
    storage = LocalFileStorage(tmp_path / "documents")
    fastapi_app.dependency_overrides[get_local_storage] = lambda: storage
    yield storage
    fastapi_app.dependency_overrides.pop(get_local_storage, None)


@pytest.fixture
def documents_dir(document_storage) -> Path:
    return document_storage.root


@pytest.fixture
def local_mode(monkeypatch):
    """New documents are written as local files for this test."""
    monkeypatch.setattr(settings, "document_storage", "local")
    return settings


@pytest.fixture
def db_mode(monkeypatch):
    """New documents are written as database blobs for this test."""
    monkeypatch.setattr(settings, "document_storage", "db")
    return settings


@pytest.fixture
def stored_objects(documents_dir):
    """Callable -> number of stored PDFs in either backend (files + document_blobs rows)."""

    def count() -> int:
        files = [p for p in documents_dir.rglob("*") if p.is_file()] if documents_dir.exists() \
            else []
        with engine.connect() as conn:
            blobs = conn.scalar(select(func.count()).select_from(models.DocumentBlobModel))
        return len(files) + int(blobs or 0)

    return count


@pytest.fixture
def client():
    with TestClient(fastapi_app) as c:
        yield c


@pytest.fixture
def db():
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()


def _ensure_user(db, user_id: str, role: str = "anesthesiologist") -> models.UserModel:
    row = db.get(models.UserModel, user_id)
    if row is None:
        now = datetime.now(timezone.utc)
        row = models.UserModel(
            id=user_id, username=f"u-{user_id}".lower(), full_name="", clave="", role=role,
            password_hash=security.UNUSABLE_PASSWORD, is_active=True,
            must_change_password=False, created_at=now, updated_at=now,
        )
        db.add(row)
        db.commit()
        db.refresh(row)
    return row


@pytest.fixture
def user_factory(db):
    """Insert a user (password hashed with argon2). All values synthetic."""

    def make(
        *,
        username: str | None = None,
        password: str = TEST_PASSWORD,
        role: str = "anesthesiologist",
        full_name: str = "Dra. Sintetica Prueba",
        clave: str = "CLV-0001",
        is_active: bool = True,
        must_change_password: bool = False,
        user_id: str | None = None,
    ) -> models.UserModel:
        now = datetime.now(timezone.utc)
        uid = user_id or str(uuid.uuid4())
        row = models.UserModel(
            id=uid, username=(username or f"user-{uid[:8]}").lower(), full_name=full_name,
            clave=clave, role=role, password_hash=security.hash_password(password),
            is_active=is_active, must_change_password=must_change_password,
            created_at=now, updated_at=now,
        )
        db.add(row)
        db.commit()
        db.refresh(row)
        return row

    return make


@pytest.fixture
def auth_headers():
    """Bearer headers for a user row (token minted directly, no login round-trip)."""

    def make(user: models.UserModel) -> dict[str, str]:
        token = security.create_access_token(user.id, user.role).access_token
        return {"Authorization": f"Bearer {token}"}

    return make


@pytest.fixture
def anesthesiologist(user_factory):
    return user_factory(username="anest1", full_name="Dra. Ana Sintetica", clave="ANE-111")


@pytest.fixture
def admin_user(user_factory):
    return user_factory(username="admin1", role="admin", full_name="Admin Sintetico", clave="")


@pytest.fixture
def gateway_mode(monkeypatch):
    """Legacy trusted-header mode for one test (X-User-Id, JIT-provisioned users)."""
    monkeypatch.setattr(settings, "auth_mode", "gateway")
    return settings


@pytest.fixture
def tenant_headers():
    """Legacy gateway identity headers (X-User-Id) for a tenant id; random when omitted."""

    def make(user_id: str | None = None) -> dict[str, str]:
        return {"X-User-Id": user_id or str(uuid.uuid4())}

    return make


def insert_patient(db, *, registro: str | None = None, nombre: str = "Paciente Sintetico",
                   **fields) -> models.PatientModel:
    """Insert a patient row (synthetic values); a random registro unless one is given."""
    now = datetime.now(timezone.utc)
    row = models.PatientModel(
        id=str(uuid.uuid4()),
        registro=registro if registro is not None else f"SYN-{uuid.uuid4().hex[:10]}",
        nombre=nombre, created_at=now, updated_at=now, **fields,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def fresh_patient_id(**kwargs) -> str:
    """Insert a synthetic patient in its own session and return its id (for inline use in
    request bodies, e.g. ``json={"patient_id": fresh_patient_id()}``)."""
    with SessionLocal() as session:
        return insert_patient(session, **kwargs).id


@pytest.fixture
def patient_factory(db):
    """Insert a patient row directly (bypasses the API). All values synthetic."""

    def make(**kwargs) -> models.PatientModel:
        return insert_patient(db, **kwargs)

    return make


@pytest.fixture
def new_case(client, db):
    """Create a case through ``POST /api/v1/cases`` (for a fresh synthetic patient unless
    ``patient_id`` is given); asserts 200 and returns the case JSON."""

    def make(headers: dict[str, str] | None = None, *, patient_id: str | None = None,
             **body) -> dict:
        pid = patient_id or insert_patient(db).id
        resp = client.post("/api/v1/cases", json={"patient_id": pid, **body},
                           headers=headers or {})
        assert resp.status_code == 200, resp.text
        return resp.json()

    return make


@pytest.fixture
def case_factory(db):
    """Insert a case row directly (bypasses the API), e.g. to seed another tenant's case or a
    finalized one. Returns the persisted CaseModel. All values are synthetic. A fresh patient
    (named after ``nombre``) is created unless ``patient_id`` is given."""

    def make(
        *,
        user_id: str | None = None,
        status: str = "draft",
        owner: str = "tester",
        nombre: str = "Paciente Sintetico",
        finalized_at: datetime | None = None,
        patient_id: str | None = None,
        at: datetime | None = None,
        **data_overrides,
    ) -> models.CaseModel:
        case_id = str(uuid.uuid4())
        now = at or datetime.now(timezone.utc)  # the row's created_at/updated_at
        owner_id = user_id if user_id is not None else settings.mock_user_id
        _ensure_user(db, owner_id)  # cases.user_id is a FK to users.id
        pid = patient_id or insert_patient(db, nombre=nombre).id
        data = {
            "id": case_id,
            "created_at": now.isoformat(),
            "owner": owner,
            "patient": {"nombre": nombre},
            **data_overrides,
        }
        row = models.CaseModel(
            id=case_id,
            owner=owner,
            user_id=owner_id,
            patient_id=pid,
            created_at=now,
            updated_at=now,
            status=status,
            finalized_at=finalized_at or (now if status == "finalized" else None),
            data=data,
        )
        db.add(row)
        db.commit()
        db.refresh(row)
        return row

    return make
