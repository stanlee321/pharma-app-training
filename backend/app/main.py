"""FastAPI application entrypoint for the TivaTrainer backend.

Wires the frozen application/infrastructure core to the HTTP layer: mounts the v1
routers under /api/v1 and exposes a liveness probe. `create_all` here is a dev
convenience so the service runs against a fresh SQLite file with no migration step (SQLite
only); on Postgres Alembic is authoritative — run `alembic upgrade head` first.

Startup (lifespan): in ``local`` auth mode the app refuses to start without
``TIVA_JWT_SECRET``; if ``TIVA_BOOTSTRAP_ADMIN_USERNAME``/``_PASSWORD`` are set, that admin is
created when missing (dev seed; an existing account is left untouched).
"""
from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from .application.auth_service import AuthService
from .core.config import settings
from .core.db import Base, SessionLocal, engine
from .infrastructure import models  # noqa: F401 — registers the tables on Base.metadata before create_all
from .infrastructure.repository import SqlUserRepository
from .api.v1 import (
    routes_admin,
    routes_auth,
    routes_cases,
    routes_documents,
    routes_export,
    routes_forms,
)

logger = logging.getLogger(__name__)


# The value shipped in backend/.env.example: publicly known, so never accepted as a secret.
JWT_SECRET_PLACEHOLDER = "replace-me-with-a-long-random-secret"
JWT_SECRET_MIN_BYTES = 32  # HS256 key should be at least as long as the SHA-256 output


def check_auth_config() -> None:
    """Refuse to start in local mode without a usable JWT secret (empty, the .env.example
    placeholder, or shorter than 32 bytes). The secret itself is never logged."""
    if settings.auth_mode != "local":
        return
    secret = settings.jwt_secret
    if not secret:
        raise RuntimeError(
            "TIVA_AUTH_MODE=local requires TIVA_JWT_SECRET (see backend/.env.example)"
        )
    if secret.strip() == JWT_SECRET_PLACEHOLDER:
        raise RuntimeError(
            "TIVA_JWT_SECRET is still the backend/.env.example placeholder; generate a real one"
        )
    if len(secret.encode("utf-8")) < JWT_SECRET_MIN_BYTES:
        raise RuntimeError(
            f"TIVA_JWT_SECRET must be at least {JWT_SECRET_MIN_BYTES} bytes long"
        )


def bootstrap_admin() -> None:
    username = settings.bootstrap_admin_username
    password = settings.bootstrap_admin_password
    if not (username and password):
        return
    with SessionLocal() as db:
        try:
            created = AuthService(SqlUserRepository(db)).bootstrap_admin(username, password)
        except ValueError as exc:
            logger.error("bootstrap admin skipped: %s", exc)
            return
    if created:
        logger.warning("bootstrap admin %r created from TIVA_BOOTSTRAP_ADMIN_*", username)


def _mentions_password(value) -> bool:
    """True if ``value`` is (or nests) a mapping with a key containing "password"."""
    if isinstance(value, dict):
        return any("password" in str(k).lower() or _mentions_password(v)
                   for k, v in value.items())
    if isinstance(value, (list, tuple)):
        return any(_mentions_password(v) for v in value)
    return False


def redact_validation_errors(errors) -> list:
    """Drop the echoed ``input`` of any 422 error about a password field, or whose input
    carries one (e.g. a "missing field" error echoes the whole body)."""
    out = []
    for err in errors:
        err = dict(err)
        loc = err.get("loc") or ()
        if (any("password" in str(part).lower() for part in loc)
                or _mentions_password(err.get("input"))):
            err.pop("input", None)
        out.append(err)
    return out


async def validation_exception_handler(_request: Request, exc: RequestValidationError):
    """FastAPI's default 422 body, minus echoed password values."""
    return JSONResponse(
        status_code=422,
        content={"detail": jsonable_encoder(redact_validation_errors(exc.errors()))},
    )


@asynccontextmanager
async def lifespan(_app: FastAPI):
    check_auth_config()
    bootstrap_admin()
    yield


def create_app() -> FastAPI:
    # Dev convenience for the zero-setup SQLite file only. On Postgres the schema is owned
    # by Alembic (`alembic upgrade head`); create_all there would build tables without an
    # alembic_version stamp and make the next `upgrade` fail on "already exists".
    if settings.is_sqlite:
        Base.metadata.create_all(engine)

    app = FastAPI(title="TivaTrainer API", version="0.2.0", lifespan=lifespan)
    app.add_exception_handler(RequestValidationError, validation_exception_handler)

    app.include_router(routes_auth.router, prefix="/api/v1")
    app.include_router(routes_cases.router, prefix="/api/v1")
    app.include_router(routes_forms.router, prefix="/api/v1")
    app.include_router(routes_export.router, prefix="/api/v1")
    app.include_router(routes_documents.router, prefix="/api/v1")
    app.include_router(routes_admin.router, prefix="/api/v1")

    @app.get("/health")
    def health() -> dict[str, str]:
        return {"status": "ok"}

    return app


app = create_app()
