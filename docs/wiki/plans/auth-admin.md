---
type: plan
updated: 2026-09-25
tags: [plan, backend, auth, admin, postgres, documents]
---

# Postgres + accounts + admin dashboard + stored documents

Follows [[web-port]]. Decisions taken 2026-09-25:

| Decision | Choice |
|---|---|
| Database | Postgres via Docker Compose (**db only**); backend + web keep running natively |
| Login | **username + password**, accounts created by an admin; roles `anesthesiologist`, `admin` |
| Admin on cases | **view all + generate/download PDFs + delete**; only the owner edits |
| Case lifecycle | **draft → finalized**; finalized cases are locked (read-only) |
| Generated PDFs | stored on local disk (absolute path) behind a storage port; object storage later |
| iOS app | on hold — it will stop working against `local` auth mode (accepted) |

## Phase 1 — Postgres baseline

- Repo-root `docker-compose.yml` (moved from `backend/`): `postgres:16`, host port 5433, named
  volume, healthcheck. `backend/.env.example` → `TIVA_DATABASE_URL=postgresql+psycopg://…:5433/tiva`
  (real `.env` gitignored). SQLite stays only as the fast test default.
- Migration `0003`: `cases.data` JSON → **JSONB** on Postgres; add `status` (`draft|finalized`,
  default `draft`), `updated_at`, `finalized_at`.
- Existing `backend/tiva.db` is mock data → start clean, no data migration.
- Verify on a fresh Postgres: `alembic upgrade head` → `downgrade base` → `upgrade head`;
  pytest runs against Postgres (`TIVA_TEST_DATABASE_URL`) as well as SQLite.

**Status (2026-09-25): built (increment 1).** Compose moved to the repo root (volume now named
`tiva_pg_data`; the old `backend_tiva_pg_data` volume was left untouched, not migrated — mock data).
`backend/.env.example`, migration `0003` (+ CHECK `ck_cases_status`), `tests/conftest.py`
(`TIVA_TEST_DATABASE_URL`, fixtures `client`/`db`/`case_factory`/`tenant_headers`/`documents_dir`) and
`tests/test_migrations.py` (round-trip + model-drift check) are in. The app only `create_all`s on SQLite.

## Phase 2 — Accounts and auth

- Table `users`: `id` uuid · `username` (unique, case-insensitive) · `full_name` · `clave`
  (professional id — prefills the case's `anestesiologo` provider) · `role` · `password_hash`
  (argon2) · `is_active` · `must_change_password` · `created_at` · `updated_at` · `last_login_at`.
- `POST /auth/login` → JWT (HS256, secret from env, ~12 h — one shift, no refresh tokens in MVP);
  `GET /auth/me`; `POST /auth/change-password`.
- First admin: `python -m app.cli create-admin` (idempotent), optional env seed for dev.
- `get_current_user` replaces the trusted `X-User-Id`. `TIVA_AUTH_MODE=local|gateway` keeps the
  gateway-header path for the later deploy behind `ms-api-gateway`.
- `cases.user_id` → FK `users.id`. Authorization matrix:

| | own draft | own finalized | others' cases | users |
|---|---|---|---|---|
| anesthesiologist | read/write/delete/finalize | read + PDFs | — | — |
| admin | — | — | read + PDFs + delete + reopen | CRUD |

**Status (2026-09-25): built (increment 2).** Migration `0004` (`users` + `cases.user_id` FK
ON DELETE RESTRICT; **existing case rows are deleted** — mock data, documented in the migration),
`core/security.py` (argon2 via pwdlib, HS256 JWT via PyJWT), `/auth/login|me|change-password`,
`get_current_user` for both modes (`gateway` JIT-provisions a `users` row per `X-User-Id`, since the
FK needs one), `CaseService` authorization (own-only, admin read-only 403, finalized lock 409),
`anestesiologo` prefill, `owner_name` on summaries, `python -m app.cli create-admin`, and the env seed
(creates only if missing). Also fixed: `created_at` is read from its column (a replace cannot forge
it). The role is re-read from the DB on every request. Not done yet: token revocation on password
reset (a token stays valid until `exp` unless the user is deactivated), and a server-side
`must_change_password` gate (the web UI enforces it). Both landed later, with the phase 4
review fixes.

## Phase 3 — Stored documents

- `DocumentStorage` port + `LocalFileStorage` (root `TIVA_DOCUMENTS_DIR`, default absolute
  `backend/var/documents`, gitignored). File path `<root>/<case_id>/<form_id>_<timestamp>.pdf`.
- Table `documents`: `id` · `case_id` (FK, cascade) · `form_id` · `storage_path` · `size_bytes` ·
  `sha256` · `generated_by` (FK users) · `created_at`. Regenerating keeps history; the UI shows the latest per form.
- `POST /cases/{id}/documents {form_id}` (generate + store + record), `GET /cases/{id}/documents`,
  `GET /documents/{id}/file`, `DELETE /documents/{id}`. The old `POST …/export/{form_id}` stays working.
- `POST /cases/{id}/finalize` → locks the case and generates all 4 forms as the finalized snapshot.
  `POST /cases/{id}/reopen` (admin) → back to draft.

**Status (2026-09-25): built (increment 3).** `infrastructure/storage.py` (`DocumentStorage` port,
`LocalFileStorage`: absolute root, per-segment key validation + resolve-inside-root check on keys
and stored paths, atomic temp→fsync→hard-link writes that never overwrite, sha256), migration
`0005` (`documents`; `generated_by` is ON DELETE SET NULL; extra `is_fallback` column), and
`DocumentService` + `routes_documents.py` (generate / list newest-first / download with a sha256
re-check / delete; finalize writes the 4 files, then flips the status with a compare-and-set and
inserts the rows in one transaction, cleaning up the files on any failure). Case delete removes
the files too. `CaseService.reopen` exists; its admin route is phase 4. The legacy export route
still streams and records nothing. Review fixes landed with it: canonical lower-case UUID case
ids (`PUT` with an upper-case id no longer creates a duplicate), 422 instead of 500 on invalid
bodies, typed bodies + `response_model` on every `/cases` route (per-resource routes replace the
generic `{child}`/`{coll}` templates and the GET dispatcher), and startup refuses a JWT secret
that is the `.env.example` placeholder or shorter than 32 bytes.

## Phase 4 — Admin API

- `/admin/users`: list/search, create (temporary password + `must_change_password`), update
  (name, clave, role, active), reset password, delete (hard only if the user owns no cases, else
  deactivate). Guards: never remove/demote/deactivate yourself or the last active admin.
- `/admin/cases`: paginated list across all users, filters (status, anesthesiologist, date range,
  text); detail; delete; reopen.
- `/admin/stats`: counts by status, per anesthesiologist, cases per day (30 d), documents generated.

**Status (2026-09-25): built (increment 4). Backend phases 1–4 are done.**

- **Admin API.** `application/admin_service.py` and `api/v1/routes_admin.py` sit behind a
  router-level `require_admin` (401 unauthenticated, 403 for anesthesiologists).
- **Users.** List/search, create (temporary password + `must_change_password`), get, patch,
  reset-password (sets `must_change_password`) and delete (409 if the user owns cases; their
  documents keep `generated_by=NULL`).
- **User guards (409).** No self delete/deactivate/demote. The last active admin cannot be removed,
  checked after row-locking the active admins so concurrent demotions cannot leave zero admins.
- **Cases.** A paginated list with `total`, filtered by status, owner, text and an inclusive UTC
  day range. Also detail, delete (any status; files removed) and reopen.
- **Documents.** `/admin/documents` is a paginated index that includes `storage_path`.
- **Stats.** `/admin/stats` returns a 30-day zero-filled series, bucketed in Python so SQLite and
  Postgres agree, a per-user table and the totals.
- **Review fixes (lock races).**
  - Migration `0006` adds `cases.version`.
  - Every draft write is now a conditional `UPDATE … WHERE status='draft'`, so a write authorised
    before a concurrent finalize gets 409 instead of landing on the locked case. The owner's case
    delete is conditional the same way.
  - Finalize compare-and-sets on the version it rendered. A write during rendering gives 409
    "case changed during finalize; retry" and removes the files, so the finalized PDFs always
    match the locked data.
- **Typed forms.** `/forms` and `/forms/{id}/schema` now have typed responses (`FormInfoDTO`,
  `FormSchemaDTO`).
- **Docs.** [[backend-api]] was rewritten as the as-built reference.
- **Review fixes (2026-09-25, closes the items that were open).**
  - Migration `0007` adds `users.password_changed_at`. A password change, admin reset or
    `create-admin` revokes every older token (`iat` before the stamp's second → 401).
  - `must_change_password` is enforced server-side: only `/auth/me` and `/auth/change-password`
    work while it is set, everything else is 403 `password change required`.
  - Gateway hardening: the `gw-` username prefix is reserved, a gateway header can only act as a
    gateway-provisioned row, and `/auth/login` is 404 in gateway mode.
  - The admin user bodies reject unknown fields. 422 bodies never echo passwords. The error body
    `ErrorDTO` is typed in openapi.
  - Each Postgres test session uses its own schema, so concurrent suites are safe.
  - `scripts/e2e.py` drives the full gate (admin creates a user → login → change password →
    fill + finalize → admin dashboard + PDF download).

## Phase 5 — Web

- Login = username + password (the role comes from the account; the role picker goes away).
  Token in the auth store → `Authorization: Bearer`; 401 → back to login. Forced change-password screen.
- **Anesthesiologist:** the current flow unchanged, plus a **Finalize** action on Review/Export, a
  per-case documents list, and finalized cases opening read-only.
- **Admin (`/admin`):** Dashboard (stat tiles, cases-per-day chart, per-anesthesiologist table) ·
  Cases (filterable table → read-only case view reusing the section screens, documents, delete,
  reopen) · Users (CRUD + reset password) · Documents.

## Build and verification

Two `/delegate-build` workflows so the API can be reviewed before the UI consumes it:
**A = phases 1–4 (backend)**, **B = phase 5 (web)**. Gates: pytest on SQLite + Postgres (auth,
authorization matrix, finalize lock, documents on disk, migration up/down), Vitest + typecheck +
lint + build, and an e2e run (admin creates an anesthesiologist → they fill + finalize → admin sees
it on the dashboard and downloads the PDFs).

**Accepted MVP risks:** JWT in `localStorage`; one shared JWT secret from `.env`; local-disk PDFs;
no login rate limiting or account lockout (argon2 cost is the only brake on password guessing —
put the API behind a rate-limiting proxy before any exposure).
