---
type: page
updated: 2026-09-25
tags: [backend, api, reference, howto, built, auth, admin, patients]
---

# Backend API — Reference & Usage (as built)

The **as-built** reference for the FastAPI service in `backend/`: how to run it, how callers
authenticate, who may do what, and every endpoint. The design of record for the case payloads is
[[rest-contract]]; the accounts/admin/documents design is [[auth-admin]]; patients (historias
clínicas) and the shared-read model are [[patients-historias]]. Domain: [[clinical-record]].
Contract deltas forced by the parsing outputs: [[contract-reconciliation-2026-07-10]].

- **Base URL:** `http://127.0.0.1:8000/api/v1` · **Health:** `GET /health` → `{"status":"ok"}`
- **Live docs:** `http://127.0.0.1:8000/docs` (Swagger) · `/openapi.json`. Every endpoint has a
  typed request body and `response_model`, and operation ids are unique, because the web client is
  generated from `openapi.json`. Tests enforce this.
- **Wire format:** JSON, **snake_case**. Timestamps are ISO-8601 UTC.
- **Layering:** config → db → domain (`derivations.py`) → application (`CaseService`,
  `PatientService`, `DocumentService`, `AuthService`, `AdminService`, DTOs) → infrastructure (repositories, `render/`,
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
`auth_headers`, `anesthesiologist`, `admin_user`, `patient_factory`, `case_factory` (creates a
patient for the case unless `patient_id=` is given), `new_case` (POST /cases for a fresh patient),
`gateway_mode`,
`tenant_headers`, `documents_dir`, `document_storage` (the per-test `LocalFileStorage`),
`local_mode` / `db_mode` (force `TIVA_DOCUMENT_STORAGE` for one test) and `stored_objects` (files +
blob rows). New documents go to the database unless `TIVA_DOCUMENT_STORAGE=local` is set when
pytest starts; `TIVA_DOCUMENT_STORAGE=local python -m pytest` reruns the mode-agnostic tests on
files (file-specific tests always force `local_mode`, blob-specific ones in
`tests/test_document_blobs.py` force `db_mode`). `tests/test_migrations.py` round-trips
every migration and checks that models and migrations have not drifted, on SQLite and on Postgres
(in a throwaway schema), and exercises the `0008` data step and its downgrade and the `0009`
case→patient grouping (seeded before `0009`, on both dialects). The helper
`tests.conftest.fresh_patient_id()` inserts a synthetic patient inline for request bodies. The e2e gate against a **running** server (local mode) is:
`TIVA_API=http://127.0.0.1:8000/api/v1 TIVA_E2E_ADMIN_USERNAME=… TIVA_E2E_ADMIN_PASSWORD=… python scripts/e2e.py`.
It needs only an admin account. It logs in as the admin, creates an anesthesiologist
(`e2e-<random>`, random temporary password), logs in as them, checks that the pending
password change blocks `/cases` (403), changes the password and logs in again. It then creates
the synthetic patient `SYN-E2E-0000` (or reuses it: the duplicate answers 409 with its id), checks
the case/whitespace-variant 409 and the 422 for a case without `patient_id`, writes a synthetic case
under that patient (`PUT /cases/{id}` plus the section routes), checks it on `GET /patients/{id}`,
stores a document and finalizes the case. As admin it checks `/admin/stats`, `/admin/cases`
(also `?patient_id=`), `/admin/patients` and `/admin/documents` and downloads one stored PDF
(`%PDF-`). Finally it streams the 4 legacy exports to `notebooks/forms/out/e2e_*.pdf`.

## Configuration (`app/core/config.py`, env prefix `TIVA_`)

Settings are read from real env vars first, then `backend/.env` (template: `backend/.env.example`).

| Variable | Default | Meaning |
|---|---|---|
| `TIVA_DATABASE_URL` | `sqlite:///./tiva.db` | SQLAlchemy URL; dev/prod `postgresql+psycopg://tiva:tiva@localhost:5433/tiva` |
| `TIVA_AUTH_MODE` | `local` | `local` = Bearer JWT required · `gateway` = trust `X-User-*` headers |
| `TIVA_JWT_SECRET` | *(empty)* | HS256 key. In `local` mode the app **refuses to start** if it is empty, shorter than 32 bytes, or still the `.env.example` placeholder |
| `TIVA_JWT_TTL_MINUTES` | `720` | token lifetime (one shift; no refresh tokens) |
| `TIVA_DOCUMENT_STORAGE` | `db` | where **new** generated PDFs go: `db` = raw bytes in `document_blobs` (bytea), `local` = files under `TIVA_DOCUMENTS_DIR`. Existing rows are always read from the backend recorded on the row |
| `TIVA_DOCUMENTS_DIR` | `<repo>/backend/var/documents` | root for `local` PDFs (still read for legacy/`local` rows in `db` mode; also where the `0008` data step reads from and its downgrade writes to); always resolved to an **absolute** path (relative values resolve against `backend/`); gitignored |
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

| | own draft case | own finalized case | other users' cases | patients | users | admin API |
|---|---|---|---|---|---|---|
| **anesthesiologist** | read, write, delete, finalize; generate / download / delete documents | read + export; generate / download documents. Every write, finalize, document delete and case delete → **409** `{"detail":"case is finalized"}` | **read** (case, sub-forms, export, document list + download). Every write, finalize, document generate/delete and case delete → **403** `{"detail":"case belongs to another anesthesiologist"}` (checked before the finalized lock) | list, read, create, edit (all patients, shared) | — | **403** |
| **admin** | — | — | read any case (`/cases` and `/admin/cases`); generate / list / download / delete documents; **delete** any case; **reopen** a finalized case. Every content write on `/cases` (POST, PUT, PATCH, child writes, DELETE) and finalize → **403** | list, read, create, edit; **delete** (only without cases) | full CRUD via `/admin/users` | yes |

**Shared hospital-wide (since `0009`, [[patients-historias]]).** Every anesthesiologist reads every
patient and every case; writes stay owner + draft. `GET /cases` still lists only the caller's own
cases (an admin: all); the patient screen (`GET /patients/{id}`) is where everyone's cases appear,
each with `can_edit`. Gateway tenants follow the same rules.

Admins **never edit case content**. They view it, manage its PDFs, delete it, or reopen it so the
owner can edit again. The `/admin` API deliberately has no PUT or PATCH on cases.

**Prefill:** when an anesthesiologist creates a case (`POST /cases`, or the create path of
`PUT /cases/{id}`) with an empty `anestesiologo` (no `nombre` and no `clave`), those two fields are
filled from the caller's `full_name` and `clave`. A replace never re-fills them.

**Patient on create:** creating a case requires `patient_id` (`POST /cases` body, or the body of
the create path of `PUT /cases/{id}`): missing/null → **422** (`loc: ["body","patient_id"]`),
unknown → **404** `Patient not found`. The server then copies the patient's identity into
`case.patient` (`nombre`, `registro` always; `profile.gender` ← `sexo`, `grupo_sanguineo`, `rh`
when the patient has them) and, for every per-encounter profile value the client left at its
default (`weight` 70, `height` 170, `age` 40, `dilution` 10), takes the value of the patient's most
recent case; `age` comes from `fecha_nacimiento` (whole years) when the patient has one. A value the
client chose is kept. `cases.patient_id` never changes afterwards: a different `patient_id` on a
replace is ignored.

## Case lifecycle and concurrency

`status` is `draft` → `finalized` (lock), and `finalized` → `draft` only through the admin
**reopen**. Server-owned fields (`status`, `updated_at`, `finalized_at`, `user_id`, plus the
internal `version` column) and `patient_id` (client-supplied on create only) live in `cases` columns, never in the `data` JSON document (JSONB on
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

All paths are under `/api/v1`. Path ids `case_id`, `patient_id`, `item_id` and `document_id` are UUIDs: a
non-UUID is **422**, and upper-case forms address the same row (the response `id` is always lower
case). `user_id` is a string of at most 36 characters, because gateway users keep the gateway's id.

### Patients — historias clínicas (any authenticated user; delete: admin)

| Method & path | Result |
|---|---|
| `GET /patients?q=&limit=&offset=` | `PatientPage = {items: PatientDTO[], total, limit, offset}`, ordered by name (case-insensitive). `q` = case-insensitive substring of `nombre` or `registro` (`%`/`_` literal); `limit` 1–200 (default 50) |
| `POST /patients` `PatientCreate` | `PatientDTO`. Duplicate registro → **409** `{"detail":"patient exists","patient_id":"…"}` (`PatientConflictDTO`; the client opens that patient) |
| `GET /patients/{patient_id}` | `PatientDetailDTO` = `PatientDTO` + `cases: PatientCaseSummaryDTO[]` (every author's cases, `numero` ascending) |
| `PATCH /patients/{patient_id}` `PatientUpdate` | `PatientDTO`; records `updated_by`; refreshes the identity snapshot of the patient's **draft** cases (finalized cases never change). Duplicate registro → the same **409** body |
| `DELETE /patients/{patient_id}` | **204**, admin only (**403** otherwise); **409** `patient has cases; delete them first` while it has cases |

- `PatientDTO = {id, registro, nombre, sexo, fecha_nacimiento, grupo_sanguineo, rh, created_by,
  updated_by, created_at, updated_at, edad, cases_count}`. `sexo` ∈ `male|female|""` (the same
  values as `profile.gender`); `edad` = whole years today (UTC) from `fecha_nacimiento`, `null`
  without it; `registro` is `null` only for legacy patients grouped by `0009` from cases without one.
- `PatientCreate = {registro (required, 1–255), nombre (required, 1–255), sexo?, fecha_nacimiento?,
  grupo_sanguineo? (≤16), rh? (≤16)}`; text is trimmed; blank `registro`/`nombre`, a future
  `fecha_nacimiento` or an unknown field → **422**. `PatientUpdate` = the same fields, all
  optional, only the keys sent are applied; `null` is rejected except `fecha_nacimiento: null`
  (clears it).
- **Unique registro:** stored trimmed; unique on `lower(trim(registro))` (functional unique index
  `uq_patients_registro_norm`), so `EXP-1`, `exp-1` and ` Exp-1 ` are the same patient. The
  service checks first and the index settles races (also answered with the 409 body). The lookup
  normalises in SQL (`lower(trim(col)) = lower(trim(:registro))`), never in Python, whose case
  folding differs (`'İ'` → `'i̇'` in Python, `'i'` in Postgres), so a Unicode variant is a 409 too.
  Caveat:
  SQLite's `lower()` folds ASCII only, so on SQLite two registros differing only in the case of a
  non-ASCII letter are not caught (Postgres folds them).
- `PatientCaseSummaryDTO = {id, numero, created_at, fecha, diagnostico_preop, status, user_id,
  author_name, can_edit}`. `numero` is 1-based by `created_at` (then id) within the patient
  ("Caso 1, Caso 2…"); `author_name` = the owner's `full_name`, else username; `can_edit` = the
  caller owns it, it is a draft, and the caller is not an admin.
- **Snapshot refresh on PATCH:** each draft's `patient.nombre`/`registro` (and `profile.gender`,
  `grupo_sanguineo`, `rh` when the patient has them) are rewritten in the same transaction as the
  patient, with a compare-and-set on the case `version` (bumped; a concurrently written draft is
  re-read and retried). Per-encounter values (peso, talla, edad, Hb/Hto, cama, dilución) are never
  touched.
- **The patient owns the identity of every draft.** Every draft write (the `PUT /cases/{id}`
  replace path, `PATCH /cases/{id}`, `PUT /cases/{id}/{child}`, the collection writes), `finalize`
  (before rendering the four PDFs; a stale snapshot is rewritten in the same compare-and-set
  transaction) and `reopen` re-copy the identity from the case's patient
  (`CaseService.sync_identity`). Whatever `nombre`/`registro`/`gender`/`grupo_sanguineo`/`rh` a
  client sends on a draft is replaced by the patient's, so a client cannot diverge a case from its
  patient, and a stale full-aggregate PUT after `PATCH /patients/{id}` cannot put the old identity
  back. `POST /cases/{id}/documents` on a draft renders with the patient's current identity too.
  A patient without registro (legacy) leaves the case's own registro. Finalized cases keep their
  snapshot. Residual race: a `PATCH /patients` that commits between a draft write's patient read
  and its UPDATE is overwritten until the next write re-syncs it.

### Cases (anesthesiologist: read all, write own; admin: read-only)

| Method & path | Result |
|---|---|
| `POST /cases` `{owner, patient_id}` | `AnesthesiaCaseDTO` (new draft for that patient: prefilled provider, identity + last profile copied). No/null `patient_id` → **422**, unknown → **404** |
| `GET /cases` | `CaseSummaryDTO[]`, newest first. Own cases; an admin sees all (unpaginated; use `/admin/cases`) |
| `GET /cases/{id}` | `AnesthesiaCaseDTO` (envelope + all children + derived values + `patient_id`); any authenticated user |
| `PUT /cases/{id}` `AnesthesiaCaseWrite` | full-aggregate create-or-replace with a client-owned id → `AnesthesiaCaseDTO`. Create requires `patient_id` (422 / 404 as above); replace ignores it; another user's case → **403** |
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

`CaseSummaryDTO = {id, owner, nombre, registro, diagnostico_preop, created_at, status, updated_at,
finalized_at, user_id, owner_name, patient_id, patient_nombre, patient_registro}`. `owner_name` is
the owning user's `full_name`, or their `username` if that is empty. `nombre` and `registro` are the
case's own snapshot (`registro` `""` when none); `patient_nombre`/`patient_registro` are the
patient's current identity (the admin case list falls back to the snapshot when they are empty).

### Documents (read: any user; write: owner or admin)

| Method & path | Result |
|---|---|
| `POST /cases/{id}/documents` `{form_id}` | render + store + record → `DocumentDTO`. Owner (draft or finalized) or admin; another anesthesiologist → **403**; unknown `form_id` → **422** |
| `GET /cases/{id}/documents` | `DocumentDTO[]`, newest first; any authenticated user |
| `GET /documents/{doc_id}/file` | the stored PDF (`application/pdf`), from the row's own backend; any authenticated user. The bytes are re-hashed first: a mismatch → **500**, missing content → **404** |
| `DELETE /documents/{doc_id}` | **204**, row + bytes (blob or file). Admin, or the owner while the case is a draft (**409** once finalized); another anesthesiologist → **403** |

`DocumentDTO = {id, case_id, form_id, size_bytes, sha256, generated_by, created_at, is_fallback,
download_url}`. `is_fallback` means the real form failed to render and the summary PDF was stored
instead. `AdminDocumentDTO` adds `storage_backend` (`db` | `local`) and `storage_path` (absolute
file path for `local`, `null` for `db`), shown to admins only.

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
| `GET /admin/cases?status=&user_id=&patient_id=&q=&date_from=&date_to=&limit=&offset=` | `AdminCasePage = {items: CaseSummaryDTO[], total, limit, offset}`, newest first; rows carry `patient_id`, `patient_nombre`, `patient_registro` |
| `GET /admin/cases/{case_id}` | `AnesthesiaCaseDTO` |
| `DELETE /admin/cases/{case_id}` | **204**, any status; also deletes its document rows and files |
| `POST /admin/cases/{case_id}/reopen` | finalized → draft → `AnesthesiaCaseDTO` (`finalized_at` cleared; documents kept); a draft → **409** |
| `GET /admin/patients?q=&limit=&offset=` | `PatientPage` (same as `GET /patients`, with `cases_count`) |
| `DELETE /admin/patients/{patient_id}` | **204**; **409** while the patient has cases (`cases.patient_id` is ON DELETE RESTRICT, which also covers a race) |
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

- `status` ∈ `draft|finalized`; `user_id` = the owner; `patient_id` = the patient (UUID, else 422).
- `q` = case-insensitive substring of patient `nombre` or `registro` (the case snapshot or the
  patient row), `diagnostico_preop`,
  `procedimiento`, `owner`, the case id, or the owner's username or full name. `%` and `_` match
  literally.
- `date_from` / `date_to` are **inclusive UTC calendar days** on `created_at`
  (`YYYY-MM-DD`); `date_from > date_to` → 422.
- `limit` 1–200 (default 50), `offset` ≥ 0. `total` is the filtered count before paging.
- The same `limit`/`offset` rules apply to `/admin/documents`.

**Stats:** `AdminStatsDTO = {patients_total, cases_total, cases_by_status: {draft, finalized}, cases_per_day:
[{date, count}], per_user: [{user_id, username, full_name, drafts, finalized, last_activity}],
documents_total}`.

- `cases_per_day` covers the **last 30 UTC days including today**, oldest first, zero-filled, by
  `created_at`. The days are bucketed in Python from the raw timestamps, so SQLite and Postgres
  agree whatever the database session time zone is.
- `per_user` lists every anesthesiologist (including those with zero cases) plus any other user
  who owns cases, ordered by number of cases.
- `last_activity` is the later of the user's last case write and last login (`null` if neither).

## Stored documents

- **Where the bytes live.** Each `documents` row records `storage_backend`: `db` (the PDF is a
  `document_blobs` row, `storage_path` NULL) or `local` (a file at the absolute `storage_path`).
  New documents go to `TIVA_DOCUMENT_STORAGE` (default `db`); reads and deletes always use the
  backend named by the row, so legacy `local` rows and new `db` rows coexist and switching the
  setting never strands a document.
- **Why bytea in Postgres (the default).** The row and its bytes commit in the same transaction:
  finalize (case lock + 4 rows + 4 blobs) is truly atomic with one commit, a failed request
  leaves nothing behind with no file-cleanup path, and a single `pg_dump` backs up cases and
  documents together. Raw `bytea` (never base64: no 33 % bloat, no encode/decode). A PDF is
  ~0.1–1 MB, well within what Postgres handles comfortably; TOAST compresses/out-of-lines it.
- **Port:** `DocumentStorage` in `backend/app/infrastructure/storage.py`:
  `save(bytes, key, *, document_id)` → `StoredFile(path | None, size_bytes, sha256)`,
  `open(path, *, document_id)`, `delete(path, *, document_id)`, plus `backend` (the value stored
  on the row) and `transactional`. `DocumentStores` (built per request by
  `api.deps.get_document_stores`) holds both adapters: `writer` for new documents,
  `for_backend(row.storage_backend)` for existing ones (an unknown backend → 500, never guessed).
- **`DatabaseBlobStorage` (`db`, transactional).** Uses the request's SQLAlchemy Session (the same
  one as the document row) and never commits or flushes on its own; the unit of work inserts the
  `documents` row before its blob (a one-way `DocumentBlobModel.document` relationship orders
  them). The content is in a **separate table**, so no list/index/stats query ever selects it;
  only `open` reads one `content` value (a test counts statements to enforce this). Deleting a
  document deletes its blob in the same transaction; case deletes cascade
  (`documents` → `document_blobs`, both `ON DELETE CASCADE`).
- **`LocalFileStorage` (`local`).** Rooted at the absolute `TIVA_DOCUMENTS_DIR`. Files are stored
  as `<root>/<case_id>/<form_id>_<UTC yyyymmddTHHMMSSffffff>.pdf`, and `documents.storage_path`
  holds the absolute path. Each key segment is validated and must resolve inside the root, so
  `..`, absolute paths, backslashes and symlink escapes are all refused; paths read back from the
  database are re-checked the same way. Writes are atomic (temp file → fsync → hard link, never
  overwriting). Not transactional: a file is written before its row commits and removed if the
  commit fails; deletes commit first, then remove the file (an unremovable file is logged and
  orphaned, never a dangling row).
- **Moving `TIVA_DOCUMENTS_DIR`** makes `local` documents unreadable, because their absolute
  paths then fall outside the new root and downloads get 500. Move the files and rewrite
  `storage_path` together (or run the `0008` data step while the old root is configured).
- **Object storage later.** S3/MinIO will be a third, non-transactional adapter (like
  `LocalFileStorage`) behind the same port and a new `storage_backend` value (extend the CHECK in
  a migration); nothing above the port changes.
- Every download is re-hashed against `documents.sha256`, whatever the backend.
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
| `0009` | `patients(id, registro (varchar 255), nombre, sexo, fecha_nacimiento, grupo_sanguineo, rh, created_by/updated_by → users ON DELETE SET NULL, created_at, updated_at)` + functional unique index `uq_patients_registro_norm` on `lower(trim(registro))` (NULLs allowed); `cases.patient_id` → `patients.id` ON DELETE RESTRICT, indexed, **NOT NULL**. **Data step** groups every existing case: non-empty trimmed registro → one patient per `lower(trim(registro))` as computed **by the database** (global, across owners; Python's `lower()` differs, e.g. `'İ'`, and would abort the upgrade on the unique index); else non-empty nombre → one per `(user_id, lower(trim(nombre)))`; else one patient per case named `Sin nombre`. A registro longer than 255 characters (after trimming) is not a key: the case falls through to the nombre / per-case rule and keeps the full value in its snapshot; `nombre` is cut to 255. Identity from the group's most recent case (`sexo` from `profile.gender`; `fecha_nacimiento` NULL); `created_by`/`updated_by` = owners of the oldest/newest case. Case data is not modified. Refused offline (`--sql`). **Downgrade** drops `cases.patient_id` and `patients` (case rows keep their name/registro snapshot) |
| `0008` | `document_blobs(document_id PK/FK → documents.id ON DELETE CASCADE, content bytea, created_at)`; `documents.storage_backend` (`db`\|`local`, NOT NULL, server default `local`, CHECK) and nullable `storage_path` (CHECK: required when `local`). **Data step:** every `local` row whose file is readable inside the documents root (`-x documents_dir=/abs` or `TIVA_DOCUMENTS_DIR`) and matches its sha256 is copied into a blob and flipped to `db`; the rest stay `local` with a warning. Source files are left on disk. **Downgrade** writes every blob back to `<root>/<case_id>/<form_id>_<created_at stamp>.pdf` (reusing an identical existing file) and flips the rows to `local`; it refuses (no schema change) if the root is not writable, a blob is missing or fails its hash, or in offline `--sql` mode |

Every migration runs on Postgres and SQLite (`batch_alter_table`) and has a working downgrade.
SQLite enforces foreign keys on the app engine (`PRAGMA foreign_keys=ON`).

`uq_patients_registro_norm` is an expression index that autogenerate cannot compare (SQLite cannot
reflect it; Postgres reflects it as `lower(TRIM(BOTH FROM registro))`), so
`models.autogenerate_include_object` excludes it from `alembic check` / the drift test (env.py and
`tests/test_migrations.py`); the tests assert it exists and enforces uniqueness instead.

## Errors

Every non-422 error body is `ErrorDTO = {"detail": str}`, declared as router-level `responses`
(401/403/404/409) so openapi.json types it for the generated client.

**401** no, invalid, expired or revoked identity (also a gateway id that belongs to a local
account) · **403** admin writing `/cases`, a write on another anesthesiologist's case (`case
belongs to another anesthesiologist`), a non-admin on `/admin` or deleting a patient, or `password
change required` · **404** missing; local login in gateway mode · **409** finalized lock, lost
race, user guards, taken username, a user who owns cases, a patient with cases, and a duplicate
registro (the only 409 with an extra key: `{"detail":"patient exists","patient_id":"…"}`) ·
**422** invalid body, query or path id, a case create without `patient_id`, or an unknown field on
the admin user / patient bodies (never a 500).

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

PID=$(curl -s -XPOST $API/patients -H "$H" -H 'content-type: application/json' \
      -d '{"registro":"SYN-0001","nombre":"Paciente Sintetico","sexo":"female","fecha_nacimiento":"1972-03-04"}' | jq -r .id)
# a second POST with " syn-0001 " → 409 {"detail":"patient exists","patient_id":"$PID"}
CID=$(curl -s -XPOST $API/cases -H "$H" -H 'content-type: application/json' \
      -d "{\"owner\":\"dr.demo\",\"patient_id\":\"$PID\"}" | jq -r .id)
curl -s $API/patients/$PID -H "$H" | jq '.cases'                    # → [{numero:1, can_edit:true, …}]
curl -XPATCH $API/cases/$CID -H "$H" -H 'content-type: application/json' \
     -d '{"sala":"Q3","diagnostico_preop":"Colecistitis aguda","asa":2}'
curl -XPUT $API/cases/$CID/patient -H "$H" -H 'content-type: application/json' \
     -d '{"cama":"12","profile":{"weight":72,"height":161,"age":54,"gender":"female"}}'   # identity comes from the patient
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
PUT on a finalized case gets 409), nor of patients: since `0009` its create-path `PUT /cases/{id}`
carries no `patient_id` and gets **422** until the Swift client learns to pick a patient. The app is on hold per [[auth-admin]]; the web client
([[web-port]]) is the primary consumer.

## Sources

- Routers: `backend/app/api/v1/routes_{auth,patients,cases,documents,forms,export,admin}.py`. Identity and
  guards: `backend/app/api/deps.py` (`get_current_user`, `require_admin`).
- DTOs: `backend/app/application/dto.py`. Services: `…/application/{case,patient,document,auth,admin}_service.py`.
- Repositories: `backend/app/infrastructure/repository.py`. Models: `…/models.py`. Storage:
  `…/storage.py`. Render: `…/render/`.
- Security: `backend/app/core/security.py`. Settings: `…/core/config.py`. CLI: `backend/app/cli.py`.
- Migrations: `backend/alembic/versions/0001–0009`. Tests: `backend/tests/`. Run guide:
  `backend/README.md`.
- Design: [[auth-admin]], [[patients-historias]], [[rest-contract]], [[web-port]].
