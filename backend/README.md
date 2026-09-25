# TivaTrainer Backend

FastAPI service that persists anesthesia **cases** (patient record, pre-anesthetic
assessment, technique, transanesthetic record, drug administrations, fluid balance,
recovery score, newborns) behind a clean REST contract. It is the server that sits
behind the app's **CaseStore** port — the iOS app talks to it over HTTP; swapping the
app's local store for this backend requires no call-site changes.

- **Stack:** Python 3.11, FastAPI, Pydantic v2, SQLAlchemy 2.0, Alembic.
- **Domain core is frozen** under `app/` (config → db → domain → application → infrastructure → api).
  DTOs are snake_case Pydantic models; `CaseService` is the single application entrypoint.
- **Contract & data model:** see the wiki — [`../docs/wiki/plans/rest-contract.md`](../docs/wiki/plans/rest-contract.md)
  (endpoints, singletons vs. collections) and [`../docs/wiki/app/clinical-record.md`](../docs/wiki/app/clinical-record.md)
  (the case envelope the app records into).

## Quick start

```bash
# one-time: create the env (Python 3.11)
conda create -n tiva_backend python=3.11
conda activate tiva_backend
pip install -r requirements.txt

# 1. start Postgres (db only) — from the REPO ROOT, not backend/
(cd .. && docker compose up -d)        # container tiva_pg, localhost:5433, tiva/tiva/tiva

# 2. configure (backend/.env is gitignored)
cp .env.example .env
python -c "import secrets; print(secrets.token_urlsafe(48))"   # paste as TIVA_JWT_SECRET in .env

# 3. apply DB migrations (mandatory on Postgres)
alembic upgrade head

# 4. first admin (idempotent; resets the password if the username exists)
python -m app.cli create-admin --username admin --password '<8+ chars>' --full-name 'Admin'

# 5. run the API — docs at http://127.0.0.1:8000/docs
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

Then log in as the admin (`POST /api/v1/auth/login`) and create the anesthesiologist accounts
with `POST /api/v1/admin/users`. Each gets a temporary password it must change at first login.

```bash
# tests (temp SQLite by default; same suite on Postgres via TIVA_TEST_DATABASE_URL)
python -m pytest -q
docker exec tiva_pg createdb -U tiva tiva_test   # once; ignore "already exists"
TIVA_TEST_DATABASE_URL=postgresql+psycopg://tiva:tiva@localhost:5433/tiva_test python -m pytest -q

# e2e gate against a RUNNING server (needs an admin account; creates an e2e-<random> user)
TIVA_API=http://127.0.0.1:8000/api/v1 TIVA_E2E_ADMIN_USERNAME=… TIVA_E2E_ADMIN_PASSWORD=… python scripts/e2e.py
```

Run all commands from the `backend/` directory, except `docker compose` (repo root).
`docker compose down` stops the database and keeps its data; `down -v` deletes the volume.

## Auth

`TIVA_AUTH_MODE=local` (default): `POST /api/v1/auth/login` with username + password returns a
Bearer JWT (HS256, `TIVA_JWT_SECRET`, TTL `TIVA_JWT_TTL_MINUTES`); every `/cases` call needs
`Authorization: Bearer …`. The app refuses to start in this mode when `TIVA_JWT_SECRET` is empty,
shorter than 32 bytes, or still the `.env.example` placeholder.
`TIVA_AUTH_MODE=gateway`: legacy trusted `X-User-Id` headers (what the iOS app sends); unknown ids
become `users` rows just-in-time. Roles: `anesthesiologist` (own cases only; finalized cases are
read-only, 409) and `admin` (reads every case, generates/downloads PDFs, deletes and reopens cases,
manages users through `/api/v1/admin/*`; content writes on `/cases` are 403). Full reference,
including the authorization matrix and every endpoint: `docs/wiki/backend-api.md`.

## Database

Configured via `app/core/config.py` (`settings`, env prefix `TIVA_`, optional `.env`).

- **Dev/prod: Postgres.** The repo-root `docker-compose.yml` runs only the database
  (`postgres:16`, container `tiva_pg`, host port **5433**, user/pass/db `tiva`, named volume
  `tiva_pg_data`). `backend/.env.example` holds
  `TIVA_DATABASE_URL=postgresql+psycopg://tiva:tiva@localhost:5433/tiva`.
  `docker compose down` stops it and keeps the data; `down -v` would wipe the volume.
- **Fallback:** with no `TIVA_DATABASE_URL`, a local SQLite file `sqlite:///./tiva.db`
  (zero dependencies; the app auto-creates its tables only in this SQLite mode).
- **Tests:** `tests/conftest.py` pins a temp SQLite file, or `TIVA_TEST_DATABASE_URL`
  (its name must contain `test`; the suite drops and recreates that schema).

`alembic upgrade head` provisions/migrates whichever database `TIVA_DATABASE_URL` points at;
on Postgres it is mandatory (the app never runs `create_all` there). Migrations run on both
Postgres and SQLite and every one has a working downgrade (`tests/test_migrations.py`).

`cases` columns: `id`, `owner`, `user_id`, `created_at`, `status` (`draft|finalized`, indexed),
`updated_at` (stamped on every write), `finalized_at`, `version` (bumped on every write; guards the
finalized lock under concurrency), `data` (the aggregate; **JSONB** on
Postgres). `status`/`updated_at`/`finalized_at`/`user_id` are server-owned: returned on
`AnesthesiaCaseDTO`/`CaseSummaryDTO`, ignored on client writes.

## Endpoints

All routes are mounted under the `/api/v1` prefix (see `app/main.py`):

- **Cases** — create / list / get / patch-envelope / delete; nested singleton children
  (`patient`, `preanesthetic-assessment`, `anesthetic-technique`, `transanesthetic-record`,
  `fluid-balance`, `recovery-score`) and collections (`drugs`, `newborns`).
- **Forms** — read the form schema served from `settings.schema_dir`
  (`notebooks/forms/schema`).
- **Export** — `POST /cases/{id}/export/{form_id}` streams the filled form PDF (summary-PDF
  fallback); nothing is stored.
- **Documents / finalize** — `POST /cases/{id}/documents` stores a generated PDF under the absolute
  `TIVA_DOCUMENTS_DIR` (default `backend/var/documents`, gitignored) and records it;
  `POST /cases/{id}/finalize` locks the case and stores all 4 forms.
- **Admin** — `/admin/users` (CRUD, reset password, guards), `/admin/cases` (filtered, paginated
  list; detail; delete; reopen), `/admin/documents`, `/admin/stats`.

See [`../docs/wiki/backend-api.md`](../docs/wiki/backend-api.md) for the full reference.
