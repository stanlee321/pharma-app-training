from pathlib import Path
from typing import Literal

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

# repo root = backend/app/core/config.py -> parents[3]
BASE_DIR = Path(__file__).resolve().parents[3]
BACKEND_DIR = BASE_DIR / "backend"
NOTEBOOKS_DIR = BASE_DIR / "notebooks"
SCHEMA_DIR = NOTEBOOKS_DIR / "forms" / "schema"
DEFAULT_DOCUMENTS_DIR = BACKEND_DIR / "var" / "documents"


class Settings(BaseSettings):
    """Backend settings. Override via env vars prefixed TIVA_ or backend/.env
    (template: backend/.env.example). Real env vars win over the .env file.

    Dev/prod DB is Postgres (TIVA_DATABASE_URL=postgresql+psycopg://..., see the repo-root
    docker-compose.yml); the default remains a local SQLite file so the service and the test
    suite run with no external dependency.
    """

    model_config = SettingsConfigDict(
        env_prefix="TIVA_", env_file=str(BACKEND_DIR / ".env"), extra="ignore"
    )

    database_url: str = "sqlite:///./tiva.db"
    schema_dir: str = str(SCHEMA_DIR)
    default_owner: str = "demo"
    mock_user_id: str = "00000000-0000-0000-0000-000000000001"

    # --- auth ---
    # "local": Bearer JWT required (401 without). "gateway": trust the ms-api-gateway X-*
    # headers (legacy; X-User-Id is provisioned as a user row just-in-time).
    auth_mode: Literal["local", "gateway"] = "local"
    # No usable default on purpose: in local mode the app refuses to start while this is
    # empty, and token issue/verify refuse to run.
    jwt_secret: str = ""
    jwt_ttl_minutes: int = Field(default=720, ge=1)
    # Dev seed: if both are set, this admin is CREATED on startup when the username does not
    # exist yet (an existing account is never modified; use `python -m app.cli create-admin`).
    bootstrap_admin_username: str | None = None
    bootstrap_admin_password: str | None = None

    # --- generated-document storage (LocalFileStorage root; always absolute) ---
    documents_dir: str = str(DEFAULT_DOCUMENTS_DIR)

    @field_validator("documents_dir")
    @classmethod
    def _absolute_documents_dir(cls, v: str) -> str:
        p = Path(v).expanduser()
        if not p.is_absolute():
            p = BACKEND_DIR / p
        return str(p.resolve())

    @property
    def is_sqlite(self) -> bool:
        return self.database_url.startswith("sqlite")


settings = Settings()
