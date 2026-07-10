"""FastAPI application entrypoint for the TivaTrainer backend.

Wires the frozen application/infrastructure core to the HTTP layer: mounts the v1
routers under /api/v1 and exposes a liveness probe. `create_all` here is a dev
convenience so the service runs against a fresh SQLite file with no migration step;
Alembic remains authoritative for production schema management.
"""
from __future__ import annotations

from fastapi import FastAPI

from .core.db import Base, engine
from .infrastructure import models  # noqa: F401 — registers CaseModel on Base.metadata before create_all
from .api.v1 import routes_cases, routes_forms, routes_export


def create_app() -> FastAPI:
    # Dev convenience: ensure tables exist. Prod schema is owned by Alembic.
    Base.metadata.create_all(engine)

    app = FastAPI(title="TivaTrainer API", version="0.1.0")

    app.include_router(routes_cases.router, prefix="/api/v1")
    app.include_router(routes_forms.router, prefix="/api/v1")
    app.include_router(routes_export.router, prefix="/api/v1")

    @app.get("/health")
    def health() -> dict[str, str]:
        return {"status": "ok"}

    return app


app = create_app()
