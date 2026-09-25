---
type: page
updated: 2026-09-25
tags: [backend, api, reference, howto, built, auth, admin]
---

# Backend API — Reference & Usage (as built)

The **as-built** reference for the FastAPI service in `backend/`: how to run it, how callers
authenticate, who may do what, and every endpoint. The design of record for the case payloads is
[[rest-contract]]; the accounts/admin/documents design is [[auth-admin]]. Domain: [[clinical-record]].
Contract deltas forced by the parsing outputs: [[contract-reconciliation-2026-07-10]].

- **Base URL:** `http://127.0.0.1:8000/api/v1` · **Health:** `GET /health` → `{"status":"ok"}`
- **Live docs:** `http://127.0.0.1:8000/docs` (Swagger) · `/openapi.json`. Every endpoint has a
  typed request body and `response_model`, and operation ids are unique, because the web client is
  generated from `openapi.json`. Tests enforce this.
- **Wire format:** JSON, **snake_case**. Timestamps are ISO-8601 UTC.
- **Layering:** config → db → domain (`derivations.py`) → application (`CaseService`,
  `DocumentService`, `AuthService`, `AdminService`, DTOs) → infrastructure (repositories, `render/`,
  `storage.py`) → api (`api/v1/routes_*.py`).

## Run it

```bash
# 1. Postgres (db only) — FROM THE REPO ROOT
docker compose up -d                  # postgres:16, container tiva_pg, localhost:5433, tiva/tiva/tiva

# 2. Backend — everything else from backend/
cd backend
conda activate tiva_backend           # Python 3.11; first time: pip install -r requirements.txt
cp .env.example .env                  # then set TIVA_JWT_SECRET (see below); .env is gitignored
python -c "import secrets; print(secrets.token_urlsafe(48))"   # a good TIVA_JWT_SECRET
alembic upgrade head                  # create/migrate the schema (mandatory on Postgres)
python -m app.cli create-admin --username admin --password '<8+ chars>' --full-name 'Admin'
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

Then log in as the admin and create the anesthesiologist accounts through `POST /admin/users`
(the web admin UI does the same thing). Each new account gets a temporary password and
`must_change_password=true`.

- **Compose:** the repo-root `docker-compose.yml` runs only the database, with the named volume
  `tiva_pg_data`. `docker compose down` stops it and keeps the data; **`down -v` wipes the volume**.
- **SQLite fallback:** leave `TIVA_DATABASE_URL` unset to use `./tiva.db`. Only in SQLite mode does
  the app `create_all` its own tables; on Postgres Alembic owns the schema.
- **Physical device:** `--host 0.0.0.0` makes the service reachable on the LAN (dev only, no real
  patient data). The iOS app only speaks `X-User-Id`, so it needs `TIVA_AUTH_MODE=gateway`. See
  "The iOS app" below.

### Tests

```bash
python -m pytest -q                                     # temp SQLite file (default)
docker exec tiva_pg createdb -U tiva tiva_test          # once; ignore "already exists"
TIVA_TEST_DATABASE_URL=postgresql+psycopg://tiva:tiva@localhost:5433/tiva_test python -m pytest -q
```

The Postgres database name must contain `test`. Each pytest session creates its own schema
(`test_<pid>_<hex>`) in that database, pins the app engine's `search_path` to it (connection
`options=-csearch_path=…`) and drops it (CASCADE) at teardown, so two suites can run against the
same database at once; `public` is never touched.
The suite runs in `local` auth mode with a fixed test secret and gives each test its own
documents root. `tests/conftest.py` provides these fixtures: `client`, `db`, `user_factory`,
`auth_headers`, `anesthesiologist`, `admin_user`, `case_factory`, `gateway_mode`,
`tenant_headers`, `documents_dir` and `document_storage`. `tests/test_migrations.py` round-trips
every migration and checks that models and migrations have not drifted, on SQLite and on Postgres
(in a throwaway schema). The e2e gate against a **running** server (local mode) is:
`TIVA_API=http://127.0.0.1:8000/api/v1 TIVA_E2E_ADMIN_USERNAME=… TIVA_E2E_ADMIN_PASSWORD=… python scripts/e2e.py`.
It needs only an admin account. It logs in as the admin, creates an anesthesiologist
(`e2e-<random>`, random temporary password), logs in as them, checks that the pending
password change blocks `/cases` (403), changes the password and logs in again. It then writes a
synthetic case (`PUT /cases/{id}` plus the section routes), stores a document and finalizes the
case. As admin it checks `/admin/stats`, `/admin/cases` and `/admin/documents` and downloads one
stored PDF (`%PDF-`). Finally it streams the 4 legacy exports to `notebooks/forms/out/e2e_*.pdf`.

## Configuration (`app/core/config.py`, env prefix `TIVA_`)

Settings are read from real env vars first, then `backend/.env` (template: `backend/.env.example`).

| Variable | Default | Meaning |
|---|---|---|
| `TIVA_DATABASE_URL` | `sqlite:///./tiva.db` | SQLAlchemy URL; dev/prod `postgresql+psycopg://tiva:tiva@localhost:5433/tiva` |
| `TIVA_AUTH_MODE` | `local` | `local` = Bearer JWT required · `gateway` = trust `X-User-*` headers |
| `TIVA_JWT_SECRET` | *(empty)* | HS256 key. In `local` mode the app **refuses to start** if it is empty, shorter than 32 bytes, or still the `.env.example` placeholder |
| `TIVA_JWT_TTL_MINUTES` | `720` | token lifetime (one shift; no refresh tokens) |
| `TIVA_DOCUMENTS_DIR` | `<repo>/backend/var/documents` | storage root for generated PDFs; always resolved to an **absolute** path (relative values resolve against `backend/`); gitignored |
| `TIVA_BOOTSTRAP_ADMIN_USERNAME` / `_PASSWORD` | unset | dev seed: **creates** this admin at startup if the username is free; never modifies an existing account |
| `TIVA_SCHEMA_DIR` | `<repo>/notebooks/forms/schema` | form-schema JSON served by `/forms` |
| `TIVA_MOCK_USER_ID` | `00000000-…-0001` | gateway mode only: tenant id used when no header is sent |
| `TIVA_TEST_DATABASE_URL` | unset | tests only: run the suite on this Postgres DB (name must contain `test`) |

## The first admin

```bash
python -m app.cli create-admin --username admin --password '…' [--full-name 'N'] [--clave C]
python -m app.cli create-admin --username admin --password-stdin < secret.txt   # keeps it out of history
```

The command is **idempotent**. If the username exists, it resets the password and forces role
`admin`, active, and `must_change_password=false`. It never prints the password. After that,
create every other account through `/admin/users`. There is no self-registration.

## Auth modes

**`local` (default).** Log in with `POST /auth/login` `{username, password}` to get
`{access_token, token_type:"bearer", expires_at, user: UserDTO}`, then send
`Authorization: Bearer <access_token>` on every protected route.

- A missing, invalid or expired token, or an inactive account, gets **401** with
  `WWW-Authenticate: Bearer`.
- Usernames are case-insensitive (stored lower-cased).
- A wrong password, an unknown user and an inactive user all get the same 401. Unknown users spend
  the same argon2 time as a wrong password.
- Tokens are HS256 (PyJWT) with claims `sub` (user id), `role`, `iat` and `exp`. Passwords are
  argon2 (`pwdlib`).
- The user row is **re-read on every request**. The effective role therefore comes from the
  database, not the token: a demotion or deactivation takes effect on the next request.
- **Revocation on password change.** `users.password_changed_at` (migration `0007`) is stamped
  whenever a password is set: `POST /auth/change-password`, `POST /admin/users/{id}/reset-password`
  and `python -m app.cli create-admin`. A token whose `iat` is before that second gets **401**
  `{"detail":"Invalid or expired token"}`. The comparison is at whole seconds (`iat <
  floor(password_changed_at)`), so a token issued in the same second right after the change still
  works. Changing your own password therefore logs out every session, **including the caller's**:
  the client logs in again with the new password. Deactivation also cuts access at once.
- **Pending password change is enforced.** While `must_change_password` is set, only
  `GET /auth/me` and `POST /auth/change-password` work (they depend on
  `get_current_user_allow_pending`). Every other authenticated route, `/admin` included, gets
  **403** `{"detail":"password change required"}`. Login itself still succeeds and reports the flag.

**`gateway` (legacy).** The service sits behind the Lookia `ms-api-gateway` and trusts its `X-*`
identity headers (see "Gateway integration"). Unknown tenant ids are provisioned just-in-time as
`anesthesiologist` rows that can never log in locally. In this mode the `X-User-Role` header is
ignored for authorization: only a database change can make a gateway user an admin.
`POST /auth/login` answers **404** `{"detail":"local login disabled in gateway mode"}`.

Both modes go through **one** resolver, `api.deps.get_current_user_allow_pending` →
`CurrentUser{id, role, username, full_name, clave, must_change_password}`; `get_current_user`
(used by every route except `/auth/me` and `/auth/change-password`) adds the pending-password
gate in local mode. The `/admin` routes add `require_admin` on top, which returns
**403** `{"detail":"admin only"}` for any non-admin.

| Method & path | Result |
|---|---|
| `POST /auth/login` `{username, password}` | `LoginResponse`; **401** on bad credentials or an inactive account; **404** in gateway mode |
| `GET /auth/me` | `UserDTO` |
| `POST /auth/change-password` `{current_password, new_password}` | **204**. Clears `must_change_password` and revokes every older token (log in again). New password 8–128 chars (**422**); wrong current password → **400** (not 401, so the client is not logged out) |

`UserDTO = {id, username, full_name, clave, role: "anesthesiologist"|"admin", is_active,
must_change_password, created_at, updated_at, last_login_at}`. It never contains a password or hash.

`must_change_password` **is** enforced server-side (403 `password change required` everywhere
except `/auth/me` and `/auth/change-password`); the web UI also forces the change-password screen.

## Roles and authorization matrix

| | own draft case | own finalized case | other users' cases | users | admin API |
|---|---|---|---|---|---|
| **anesthesiologist** | read, write, delete, finalize; generate / download / delete documents | read + export; generate / download documents. Every write, finalize, document delete and case delete → **409** `{"detail":"case is finalized"}` | **404** (documents too) | — | **403** |
| **admin** | — | — | read any case (`/cases` and `/admin/cases`); generate / list / download / delete documents; **delete** any case; **reopen** a finalized case. Every content write on `/cases` (POST, PUT, PATCH, child writes, DELETE) and finalize → **403** | full CRUD via `/admin/users` | yes |

Admins **never edit case content**. They view it, manage its PDFs, delete it, or reopen it so the
owner can edit again. The `/admin` API deliberately has no PUT or PATCH on cases.

**Prefill:** when an anesthesiologist creates a case (`POST /cases`, or the create path of
`PUT /cases/{id}`) with an empty `anestesiologo` (no `nombre` and no `clave`), those two fields are
filled from the caller's `full_name` and `clave`. A replace never re-fills them.

## Case lifecycle and concurrency

`status` is `draft` → `finalized` (lock), and `finalized` → `draft` only through the admin
**reopen**. Server-owned fields (`status`, `updated_at`, `finalized_at`, `user_id`, plus the
internal `version` column) live in `cases` columns, never in the `data` JSON document (JSONB on
Postgres). They are ignored when a client sends them. `created_at` is also read from its column: the
client-minted value is accepted only when `PUT /cases/{id}` creates the case (offline-first).

The lock holds under concurrency:

- **Every data write is conditional.** It runs `UPDATE cases … WHERE id=:id AND status='draft'`,
  bumps `version` and stamps `updated_at`. A write that passed the status check before a concurrent
  finalize committed matches no row, so it gets **409** `case is finalized` and changes nothing.
  The owner's case DELETE is conditional in the same way.
- **Finalize compare-and-sets on the version it rendered.** It renders the 4 PDFs from the case at
  version *v*, then runs `UPDATE … SET status='finalized' WHERE status='draft' AND version=v` and
  inserts the 4 document rows in the same transaction. If anything wrote to the case while the PDFs
  rendered, finalize fails with **409** `{"detail":"case changed during finalize; retry"}`, every
  file it wrote is removed, and the case stays a draft. The stored finalized PDFs therefore always
  show exactly the locked data.
- A lost race with a concurrent finalize → **409** `case is finalized`. Reopening a draft → **409**
  `case is not finalized`.
- Concurrent draft writes by the **same owner** are still last-writer-wins on the whole aggregate,
  as before. No version is required from clients.

## Endpoints

All paths are under `/api/v1`. Path ids `case_id`, `item_id` and `document_id` are UUIDs: a
non-UUID is **422**, and upper-case forms address the same row (the response `id` is always lower
case). `user_id` is a string of at most 36 characters, because gateway users keep the gateway's id.

### Cases (anesthesiologist: own; admin: read-only)

| Method & path | Result |
|---|---|
| `POST /cases` `{owner}` | `AnesthesiaCaseDTO` (new draft, prefilled provider) |
| `GET /cases` | `CaseSummaryDTO[]`, newest first. Own cases; an admin sees all (unpaginated; use `/admin/cases`) |
| `GET /cases/{id}` | `AnesthesiaCaseDTO` (envelope + all children + derived values) |
| `PUT /cases/{id}` `AnesthesiaCaseWrite` | full-aggregate create-or-replace with a client-owned id → `AnesthesiaCaseDTO` |
| `PATCH /cases/{id}` `CaseEnvelopePatch` | update envelope fields → `AnesthesiaCaseDTO` |
| `DELETE /cases/{id}` | **204**; also deletes its documents (rows and files) |
| `GET` / `PUT /cases/{id}/{singleton}` | read / upsert one sub-form (body = that sub-form's DTO) |
| `GET` / `POST /cases/{id}/{collection}` | list / add items |
| `PATCH` / `DELETE /cases/{id}/{collection}/{item_id}` | partial update (only the keys sent) / delete (**204**) |
| `POST /cases/{id}/finalize` | owner only: draft → finalized + stores all 4 forms → `AnesthesiaCaseDTO` |
| `POST /cases/{id}/export/{form_id}` | legacy: streams the filled PDF (`application/pdf`); stores nothing; any `form_id` (summary fallback) |

Singletons: `patient`, `preanesthetic-assessment`, `anesthetic-technique`,
`transanesthetic-record`, `fluid-balance`, `recovery-score`. Collections: `drugs`, `newborns`
(PATCH bodies `DrugAdministrationPatch` / `NewbornRecordPatch`). Each is its own explicit route
with a typed body. **Derived fields** are server-stamped and read-only: `patient.imc`,
`peso_ideal`, `vsc`, `vsc_25` and `vsc_15`; `recovery.totals`; and `fluid_balance.balance_parcial`,
`balance_total`, `total_a_reponer`, `gasto_urinario` and `tasa_fentanilo`.

`CaseSummaryDTO = {id, owner, nombre, diagnostico_preop, created_at, status, updated_at,
finalized_at, user_id, owner_name}`. `owner_name` is the owning user's `full_name`, or their
`username` if that is empty.

### Documents (owner or admin)

| Method & path | Result |
|---|---|
| `POST /cases/{id}/documents` `{form_id}` | render + store + record → `DocumentDTO`. Owner (draft or finalized) or admin; unknown `form_id` → **422** |
| `GET /cases/{id}/documents` | `DocumentDTO[]`, newest first |
| `GET /documents/{doc_id}/file` | the stored PDF (`application/pdf`). The file is re-hashed first: a mismatch → **500**, a missing file → **404** |
| `DELETE /documents/{doc_id}` | **204**, row + file. Admin, or the owner while the case is a draft (**409** once finalized) |

`DocumentDTO = {id, case_id, form_id, size_bytes, sha256, generated_by, created_at, is_fallback,
download_url}`. `is_fallback` means the real form failed to render and the summary PDF was stored
instead. `AdminDocumentDTO` adds `storage_path`, which is shown to admins only.

`form_id` is one of `registro_transanestesico`, `nota_postanestesica`,
`imss_valoracion_preanestesica` or `imss_registro_anestesia`.

### Forms (unauthenticated; structure only, no case data)

| Method & path | Result |
|---|---|
| `GET /forms` | `FormInfoDTO[]` = `{form_id, title}` |
| `GET /forms/{form_id}/schema` | `FormSchemaDTO`, the parsed schema file unchanged. `form_id`, `source`, `page{width,height}`, `fields[]` (`FormFieldDTO`: `id`, `type`, `label`, `unit`, `section`, `bbox`, …), `tables[]`, `charts[]`, `major_sections[]` and `subsections[]` are typed; any other key passes through. **404** if unknown |

### Admin (`require_admin`: 401 without identity, 403 for an anesthesiologist)

| Method & path | Result |
|---|---|
| `GET /admin/users?q=&role=&is_active=` | `UserDTO[]` ordered by username. `q` = case-insensitive substring of username, full_name or clave |
| `POST /admin/users` `{username, full_name, clave, role, password}` | `UserDTO` with `must_change_password=true`. Username `[A-Za-z0-9][A-Za-z0-9._@-]*` (≤ 64, stored lower-cased); password 8–128; the `gw-` prefix (any case) is reserved for gateway users → **422**; taken username (case-insensitive) → **409**; unknown fields → **422** |
| `GET /admin/users/{user_id}` | `UserDTO`; **404** if unknown |
| `PATCH /admin/users/{user_id}` `{full_name?, clave?, role?, is_active?}` | `UserDTO`. Only the keys sent are applied; an explicit `null` or an unknown field (e.g. `username`) → **422** |
| `POST /admin/users/{user_id}/reset-password` `{password}` | **204**; sets a new temporary password and `must_change_password=true`. The old password stops working and every token issued before the reset is revoked (401). Unknown fields → **422** |
| `DELETE /admin/users/{user_id}` | **204** if the user owns no cases, else **409** (deactivate instead). Documents they generated are kept, with `generated_by` set to null |
| `GET /admin/cases?status=&user_id=&q=&date_from=&date_to=&limit=&offset=` | `AdminCasePage = {items: CaseSummaryDTO[], total, limit, offset}`, newest first |
| `GET /admin/cases/{case_id}` | `AnesthesiaCaseDTO` |
| `DELETE /admin/cases/{case_id}` | **204**, any status; also deletes its document rows and files |
| `POST /admin/cases/{case_id}/reopen` | finalized → draft → `AnesthesiaCaseDTO` (`finalized_at` cleared; documents kept); a draft → **409** |
| `GET /admin/documents?case_id=&form_id=&limit=&offset=` | `AdminDocumentPage = {items: AdminDocumentDTO[], total, limit, offset}`, newest first |
| `GET /admin/stats` | `AdminStatsDTO` (below) |

**User guards** (all **409**):

- An admin can never delete, deactivate or demote **themself**.
- The **last active admin** can never be deleted, deactivated or demoted. The check runs after
  row-locking the active admins in the same transaction (a no-op `UPDATE … WHERE role='admin' AND
  is_active`: row locks on Postgres, the write lock on SQLite). Two admins demoting each other at
  the same moment therefore cannot leave zero admins.
- Deleting a user who owns cases gets 409. `cases.user_id` is `ON DELETE RESTRICT`, which also
  covers a race.

Deactivating a user cuts access at once: their token gets 401 and login fails.

**Case search:**

- `status` ∈ `draft|finalized`; `user_id` = the owner.
- `q` = case-insensitive substring of patient `nombre` or `registro`, `diagnostico_preop`,
  `procedimiento`, `owner`, the case id, or the owner's username or full name. `%` and `_` match
  literally.
- `date_from` / `date_to` are **inclusive UTC calendar days** on `created_at`
  (`YYYY-MM-DD`); `date_from > date_to` → 422.
- `limit` 1–200 (default 50), `offset` ≥ 0. `total` is the filtered count before paging.
- The same `limit`/`offset` rules apply to `/admin/documents`.

**Stats:** `AdminStatsDTO = {cases_total, cases_by_status: {draft, finalized}, cases_per_day:
[{date, count}], per_user: [{user_id, username, full_name, drafts, finalized, last_activity}],
documents_total}`.

- `cases_per_day` covers the **last 30 UTC days including today**, oldest first, zero-filled, by
  `created_at`. The days are bucketed in Python from the raw timestamps, so SQLite and Postgres
  agree whatever the database session time zone is.
- `per_user` lists every anesthesiologist (including those with zero cases) plus any other user
  who owns cases, ordered by number of cases.
- `last_activity` is the later of the user's last case write and last login (`null` if neither).

## Stored documents

- **Port:** `DocumentStorage` (`save(bytes, key)` → `StoredFile(path, size_bytes, sha256)`,
  `open(path)`, `delete(path)`), in `backend/app/infrastructure/storage.py`.
- **Adapter:** `LocalFileStorage`, rooted at the absolute `TIVA_DOCUMENTS_DIR`. Files are stored
  as `<root>/<case_id>/<form_id>_<UTC yyyymmddTHHMMSSffffff>.pdf`, and `documents.storage_path`
  holds the absolute path.
- **Path safety:** each key segment is validated and must resolve inside the root, so `..`,
  absolute paths, backslashes and symlink escapes are all refused. Paths read back from the
  database are re-checked the same way.
- **Writes** are atomic (temp file → fsync → hard link, never overwriting) and hashed with sha256.
- **Consistency:** a file is written before its row commits, and is removed if the commit fails.
  Deletes commit first, then remove the files; a file that cannot be removed is logged and
  orphaned, never a dangling row. Finalize is all-or-nothing (see "Case lifecycle and
  concurrency").
- **Moving `TIVA_DOCUMENTS_DIR`** makes stored documents unreadable, because their absolute paths
  then fall outside the new root and downloads get 500. Move the files and rewrite `storage_path`
  together.
- Regenerating a form adds a row (history); the newest row per form is the current one.

## Schema and migrations

| Rev | What |
|---|---|
| `0001`–`0002` | `cases` baseline + `user_id` |
| `0003` | `cases.data` → JSONB on Postgres; `status` (CHECK + index), `updated_at`, `finalized_at` |
| `0004` | `users` (`uq_users_username`, `ck_users_role`); `cases.user_id` FK → `users.id` ON DELETE RESTRICT. **Deletes existing case rows** (mock data; their tenant ids matched no user) |
| `0005` | `documents` (FK `case_id` ON DELETE CASCADE, FK `generated_by` ON DELETE SET NULL, index `(case_id, created_at)`). Downgrade leaves the files on disk |
| `0006` | `cases.version` (integer, default 1): the optimistic-concurrency counter behind the lock guarantees |
| `0007` | `users.password_changed_at` (nullable, timezone-aware): tokens issued before it are revoked. NULL = never changed |

Every migration runs on Postgres and SQLite (`batch_alter_table`) and has a working downgrade.
SQLite enforces foreign keys on the app engine (`PRAGMA foreign_keys=ON`).

## Errors

Every non-422 error body is `ErrorDTO = {"detail": str}`, declared as router-level `responses`
(401/403/404/409) so openapi.json types it for the generated client.

**401** no, invalid, expired or revoked identity (also a gateway id that belongs to a local
account) · **403** admin writing `/cases`, a non-admin on `/admin`, or `password change required`
· **404** missing, or not yours (never 403 for other users' data); local login in gateway mode ·
**409** finalized lock, lost race, user guards, taken username, a user who owns cases · **422**
invalid body, query or path id, or an unknown field on the admin user bodies (never a 500).

422 bodies are FastAPI's `{"detail": [...]}`, except that the echoed `input` is dropped from any
error whose location names a password field or whose input carries one (e.g. a "missing field"
error that would echo the whole body). Passwords never come back in an error.

## Payload examples

```bash
API=localhost:8000/api/v1
ADMIN=$(curl -s -XPOST $API/auth/login -H 'content-type: application/json' \
        -d '{"username":"admin","password":"…"}' | jq -r .access_token)

# admin creates an anesthesiologist (temporary password; must change at first login)
curl -XPOST $API/admin/users -H "Authorization: Bearer $ADMIN" -H 'content-type: application/json' \
     -d '{"username":"dra.demo","full_name":"Dra. Demo Sintetica","clave":"DEM-01","password":"Temporal-123"}'

TOKEN=$(curl -s -XPOST $API/auth/login -H 'content-type: application/json' \
        -d '{"username":"dra.demo","password":"Temporal-123"}' | jq -r .access_token)
curl -XPOST $API/auth/change-password -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' \
     -d '{"current_password":"Temporal-123","new_password":"Definitiva-456"}'   # → 204
H="Authorization: Bearer $TOKEN"

CID=$(curl -s -XPOST $API/cases -H "$H" -H 'content-type: application/json' -d '{"owner":"dr.demo"}' | jq -r .id)
curl -XPATCH $API/cases/$CID -H "$H" -H 'content-type: application/json' \
     -d '{"sala":"Q3","diagnostico_preop":"Colecistitis aguda","asa":2}'
curl -XPUT $API/cases/$CID/patient -H "$H" -H 'content-type: application/json' \
     -d '{"nombre":"Paciente Sintetico","profile":{"weight":72,"height":161,"age":54,"gender":"female"}}'
# → derived: "imc":27.8, "peso_ideal":53.3, "vsc":5040.0 …
curl -XPOST $API/cases/$CID/drugs -H "$H" -H 'content-type: application/json' \
     -d '{"farmaco":"Propofol","dose_value":120,"dose_unit":"mg","via":"IV","rust_model_id":"marsh"}'

curl -XPOST $API/cases/$CID/finalize -H "$H"                       # → status "finalized", 4 PDFs stored
curl -s $API/cases/$CID/documents -H "$H" | jq '.[].download_url'

# admin: dashboard, search, download, reopen
curl -s "$API/admin/stats" -H "Authorization: Bearer $ADMIN"
curl -s "$API/admin/cases?status=finalized&q=sintetico&date_from=2026-09-01&limit=20" -H "Authorization: Bearer $ADMIN"
curl -s "$API/documents/$DOC/file" -H "Authorization: Bearer $ADMIN" -o nota.pdf
curl -XPOST "$API/admin/cases/$CID/reopen" -H "Authorization: Bearer $ADMIN"   # → back to draft
```

## Gateway integration (`ms-api-gateway`)

These headers apply **only with `TIVA_AUTH_MODE=gateway`**; `local` mode ignores them. The gateway
authenticates once and injects `X-*` identity headers, which this service trusts and never
re-validates with Identity. The cross-repo contract is
`…/video-server_microservicios_apigateway/docs/GATEWAY_HEADERS.md`. `api/deps.py` parses the
headers into a `UserContext`:

| Header | Used for |
|---|---|
| `X-User-Id` | the authenticated user id, which is the **tenant key** |
| `X-User-Created-By` | for **guest** tokens, the parent becomes the effective owner (`ctx.owner_id`) |
| `X-User-Role` / `X-User-Scopes` | parsed only; authorization uses the DB role |
| `X-App-Type`, `X-Request-Id`, `X-Service-Name` / `X-Auth-Mode` | parsed (namespace, correlation, S2S) |

The tenant key is `ctx.owner_id`, falling back to `TIVA_MOCK_USER_ID` when no header is sent.

- An unknown id becomes a `users` row (`username = "gw-<id>"`, role anesthesiologist, unusable
  password hash `!`). The `gw-` prefix is reserved: `POST /admin/users` and `create-admin` reject
  it (422 / CLI error).
- An **existing** row is accepted only if it is gateway-provisioned (`gw-` username or the
  unusable password `!`). A header naming a local account (e.g. a local admin's id) gets **401**
  `{"detail":"Invalid gateway identity"}`. The same rule applies to a guest's
  `X-User-Created-By` parent. A provisioning conflict (e.g. `gw-<id>` already taken by another
  row) is also 401.
- Ids longer than 36 chars get 401.
- A deactivated gateway user gets 403.
- **Trust boundary:** keep the service on the internal network. If it is ever exposed publicly,
  strip inbound `X-User-*` / `X-Service-*` headers first.

## The iOS app

The app talks to this service through its `CaseStore` port (`RestBackend`, [[clinical-record]],
[[decisions]] ADR-2). It sends only `X-User-Id`, so it works **only in `gateway` mode**; in the
default `local` mode every call gets 401. It knows nothing of finalize, documents or the lock (a
PUT on a finalized case gets 409). The app is on hold per [[auth-admin]]; the web client
([[web-port]]) is the primary consumer.

## Sources

- Routers: `backend/app/api/v1/routes_{auth,cases,documents,forms,export,admin}.py`. Identity and
  guards: `backend/app/api/deps.py` (`get_current_user`, `require_admin`).
- DTOs: `backend/app/application/dto.py`. Services: `…/application/{case,document,auth,admin}_service.py`.
- Repositories: `backend/app/infrastructure/repository.py`. Models: `…/models.py`. Storage:
  `…/storage.py`. Render: `…/render/`.
- Security: `backend/app/core/security.py`. Settings: `…/core/config.py`. CLI: `backend/app/cli.py`.
- Migrations: `backend/alembic/versions/0001–0007`. Tests: `backend/tests/`. Run guide:
  `backend/README.md`.
- Design: [[auth-admin]], [[rest-contract]], [[web-port]].
