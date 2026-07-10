from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

# repo root = backend/app/core/config.py -> parents[3]
BASE_DIR = Path(__file__).resolve().parents[3]
NOTEBOOKS_DIR = BASE_DIR / "notebooks"
SCHEMA_DIR = NOTEBOOKS_DIR / "forms" / "schema"


class Settings(BaseSettings):
    """Backend settings. Override via env vars prefixed TIVA_ or a .env file.

    DB is Postgres in prod (TIVA_DATABASE_URL=postgresql+psycopg://...); defaults to a
    local SQLite file so the service runs with no external dependency.
    """

    model_config = SettingsConfigDict(env_prefix="TIVA_", env_file=".env", extra="ignore")

    database_url: str = "sqlite:///./tiva.db"
    schema_dir: str = str(SCHEMA_DIR)
    default_owner: str = "demo"


settings = Settings()
