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
