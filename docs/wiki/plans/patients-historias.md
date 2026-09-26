---
type: plan
updated: 2026-09-25
tags: [plan, patients, historias-clinicas, i18n, backend, web]
---

# Historias clínicas — Patient → Cases, Spanish UI

Follows [[web-port]] and [[auth-admin]]. Source: the user's annotated sketch (2026-09-25):
list of patients → **missing intermediate screen** (patient + their cases, "+" = new case for that
patient) → the existing case Hub, all in Spanish.

## Status (2026-09-25, after increment 4)

**Shipped (uncommitted in the working tree; not deployed):** all four increments.

- **Backend:** the patients table and migration 0009, which groups existing cases into patients.
  - Endpoints `/patients` and `/admin/patients`, plus the `/admin/cases?patient_id=` filter and
    `patients_total` in the stats.
  - Shared-read authorization, with writes restricted to the owner and to drafts.
  - Patient-owned identity: draft snapshots are kept in sync, finalized cases are never changed.
- **Web, anesthesiologist:** Historias clínicas (`/pacientes`), the new-patient form with
  duplicate-registro handling, and the patient screen. It shows the cases numbered, opens
  colleagues' cases read-only, and "+" creates a case for the patient.
- **Web, everywhere:** the UI is Spanish only (anesthesiologist, admin, login, errors).
- **Web, admin:**
  - A **Pacientes** page: search, `cases_count`, paging.
  - A read-only patient page listing the patient's cases. **Delete** is offered only while the
    patient has no cases, with an in-page confirmation; the server 409 is shown in Spanish.
  - The case table shows each case's patient (nombre + registro) and filters by `?patient_id=`.
  - The dashboard **Pacientes** tile.
- **Tests:** backend pytest (SQLite + Postgres), the web Vitest suite, and `scripts/e2e.py`, which
  now also covers the admin patient read and the delete guard.

**Known gaps / open items**

- **iOS on hold (accepted known gap, not a release blocker).** Swift/iOS development is on hold
  and the web app is the MVP (decision of the user, 2026-09-25); iOS already cannot sign in since
  `TIVA_AUTH_MODE=local`. `PharmaApp/` still creates cases without `patient_id` (the backend
  answers 422), so its create path needs `patient_id` (a patient picker + `POST /patients` with
  the 409-reuse path) when development resumes. No backend fallback is planned. This does not
  block deploying the web stack. iOS is also still English.
- Migration 0009 has only run on synthetic data (SQLite and Postgres scratch schemas), never on
  the real `tiva` data. Run it on a copy first.
- Legacy patients with `sexo ''` compute as male in the PK models until someone edits them. The
  UI warns but does not block. Legacy patients without a name are called "Sin nombre", and their
  drafts' PDFs print it.
- There is a residual race between a `PATCH /patients` and a concurrent draft write: the next
  write re-syncs the identity. It is documented in [[backend-api]] but not tested under real
  concurrency.
- The admin UI has no edit form for a patient's identity (anesthesiologists maintain it from the
  historia clínica); the API does allow admins to `PATCH /patients/{id}`. Nobody can merge
  duplicate patients.
- The admin "Pacientes" list does not remember its search when you return from a patient page
  (the crumb opens the unfiltered list).
- The Spanish guard (`web/src/test/spanishUi.test.tsx`) is heuristic. A new backend `detail`
  appears as "El servidor respondió: …" until it is added to `web/src/api/serverMessages.ts`.
- Nothing has been checked in a real browser against a live backend. Web tests mock fetch, and
  `e2e.py` ran in-process (Starlette TestClient on a scratch SQLite DB).

## Decisions (2026-09-25)

| Decision | Choice |
|---|---|
| Visibility | **Shared across the hospital**: every anesthesiologist sees every patient and all their cases; cases written by others are **read-only**; you edit only your own drafts. Admin sees everything. |
| Patient identity | **Registro / expediente is unique** (trimmed, case-insensitive). Creating a patient with an existing registro returns/opens the existing one. |
| Language | **Spanish only** (every screen, message, admin area). |
| Existing cases | **Grouped into patients** by the migration. |

## Data model

- New `patients`: `id` uuid · `registro` (unique normalized, nullable only for legacy rows without
  one) · `nombre` · `sexo` · `fecha_nacimiento` (nullable) · `grupo_sanguineo` · `rh` ·
  `created_by` / `updated_by` (FK users) · `created_at` · `updated_at`.
- `cases.patient_id` → FK `patients.id` (NOT NULL after migration, ON DELETE RESTRICT).
- **Identity lives on the patient; per-encounter values stay on the case** (peso, talla, edad at
  the encounter, Hb/Hto, cama, dilución). A new case copies the identity + the last case's
  biometrics as defaults. The case keeps a **snapshot** of name/registro for the PDFs; editing a
  patient updates the snapshot of that patient's **draft** cases only — finalized cases never change.
- Migration: group existing cases by normalized registro (global); cases without registro by
  (owner, lowercased nombre); otherwise one patient per case. Then `patient_id` NOT NULL.

## API (additions)

- `GET /patients?q=&limit=&offset=` (name/registro search) · `POST /patients` (409 + existing id on a
  duplicate registro) · `GET /patients/{id}` (+ case summaries: number, date, diagnosis, status,
  author) · `PATCH /patients/{id}` (any anesthesiologist; `updated_by` recorded) ·
  `DELETE /patients/{id}` (admin, only without cases).
- Case create requires `patient_id`. Authorization matrix change: anesthesiologists may **read** any
  case; writes stay owner + draft only.
- Admin: case list filter by patient, patients page, `patients_total` in stats.

## Web

1. **Historias clínicas** (replaces "Encounters"): patient list with search; "+" = new patient
   (nombre, registro, sexo, fecha de nacimiento, grupo, Rh) with duplicate-registro handling.
2. **Paciente** (new screen): header nombre + registro (+ edad, sexo), datos del paciente (editable),
   list of cases (Caso N · fecha · diagnóstico · estado · autor; others' cases open read-only),
   "+" = new case for this patient → Hub.
3. **Hub**: back goes to the patient; "Datos del paciente" shows identity read-only with a link to
   edit the patient, and per-encounter values editable.
4. **Spanish everywhere**, incl. the admin area, errors, empty states, dates (`es-MX`).
5. Admin: patients page (search, case counts, delete empty), case list filter/column by patient.

## Build

One `/delegate-build` workflow: (1) backend patients + migration + authz + tests + docs, (2) web
patient list + patient screen + new-case flow + Hub/patient-data changes, (3) Spanish translation of
the whole UI, (4) admin patients + e2e script. Per-increment review + final audit (live run against
a **scratch** backend on a scratch DB — the shared Docker stack testers use is never touched).

## As built — increment 1 (backend)

See [[backend-api]] for the full reference. Choices made inside the fixed decisions:

- **Writes on another user's case → 403** `{"detail":"case belongs to another anesthesiologist"}`
  (checked before the finalized 409). Reads of any case, its sub-forms, the streaming export and
  the stored-document list/download are open to every authenticated user; **storing** a document
  (`POST /cases/{id}/documents`) stays owner-or-admin, like finalize.
- `sexo` uses the case's `profile.gender` values (`male` / `female` / `""`); the UI translates.
- Identity copied into a case: `nombre` always, `registro` when the patient has one;
  `profile.gender`, `grupo_sanguineo`, `rh` when the patient has them. Done on create, on
  `PATCH /patients/{id}` (drafts only) and — review fix — on **every draft write, finalize and
  reopen** (`CaseService.sync_identity` inside `_persist`): the snapshot of a draft always equals
  its patient whatever the client sends, so a stale full-aggregate PUT cannot revert a patient
  edit and the PDFs stored at finalize carry the patient's current identity.
- `patients.registro` is `varchar(255)` (review fix: 64 made 0009 abort on Postgres for a longer
  legacy registro); `PatientCreate`/`PatientUpdate` accept 1–255. 0009 bounds every copied value
  (a registro > 255 is not a grouping key; `nombre` cut to 255).
- New case defaults: profile values left at the DTO defaults come from the patient's most recent
  case; `age` from `fecha_nacimiento` when known.
- `DELETE /patients/{id}` exists both at `/patients/{id}` (admin) and `/admin/patients/{id}`.
- The functional unique index is excluded from alembic autogenerate (Postgres rewrites
  `trim()` on reflection); tests assert it instead.
- **iOS — accepted known gap (on hold).** The iOS app's create path (`PUT /cases/{id}` without
  `patient_id`) gets 422. iOS development is on hold (the web app is the MVP; iOS cannot sign in
  under `TIVA_AUTH_MODE=local` anyway), so this no longer blocks deploying the web stack; its
  create path needs `patient_id` when development resumes. No backend fallback. The web client
  sends it from increment 2.
- **Registro normalisation is done by the database.** The unique index is
  `lower(trim(registro))`; Python's `lower()`/`strip()` differ (e.g. `'İ'.lower()` is `'i̇'` in
  Python, `'i'` in Postgres; `trim` strips only spaces). So `get_by_registro` compares
  `lower(trim(col)) = lower(trim(:registro))` in SQL (a lost race or a Unicode variant answers
  409, never 500), and 0009 groups registro cases by the key the DB computes
  (`_db_registro_keys`), so its inserts can never violate the index. Tests (Postgres):
  `test_registro_normalised_by_the_db_is_409_not_500`,
  `test_0009_groups_by_the_db_registro_key_postgres_schema`.

## As built — increment 2 (web)

- Routes: `/pacientes` (Historias clínicas, the anesthesiologist's landing; `/cases` redirects
  there), `/pacientes/nuevo`, `/pacientes/:id` (`?editar=1` opens the identity form). The case and
  its sections stay at `/cases/:id/**`. `routes/patients/` (list, new, patient screen, form).
- `api/patientApi.ts` (`PatientApi` port: `RestPatientApi` over the one HTTP layer,
  `InMemoryPatientApi` for the offline mode) + `state/patientStore.ts` (list / detail / create /
  update, session-epoch isolation, stale searches dropped; reset with the case store on sign-out).
- Duplicate registro (409) on create or edit → "Ya existe un paciente con el registro «…»" +
  **Abrir paciente existente**.
- Patient screen: header (registro · edad · sexo), "Datos del paciente" (read-only rows + edit
  form, PATCH with only the changed keys), cases "Caso N" with status badge, date, diagnosis,
  author, "Solo lectura" for others' cases, inline delete for own drafts, "+" = new case (the
  optimistic create PUTs with `patient_id` and the identity) → its Hub.
- Hub back → the case's patient. Patient Data section: identity read-only (with "Editar
  paciente"), per-encounter values (peso, talla, edad, dilución, cama, Hb, Hto) editable; sex is
  identity now (no chips on the case).
- **Non-owner read-only:** a case read via `GET /cases/{id}` whose `user_id` is not the signed-in
  user is `meta.foreign` in the case store: `updateCase`/`save` refuse it (no PUT can be sent), the
  one read-only mechanism shows "Caso de otro anestesiólogo — solo lectura", and Review hides
  Finalize / Generate / document delete.
- Spanish: every new screen is Spanish; the existing screens are translated in increment 3.

## As built — increment 3 (web: Spanish only + review fixes)

- **Spanish everywhere.** Clinical flow, login, change password, user menu, patient screens,
  review/export, documents, finalize, banners, empty/loading states, admin area (Panel, Casos,
  Usuarios, Documentos), aria-labels and titles. `index.html` is `lang="es"`. Section names follow
  the paper forms: Datos del paciente, Valoración preanestésica, Técnica anestésica, Registro
  transanestésico, Fármacos administrados, Balance de líquidos, Recuperación (Aldrete), Recién
  nacido, Revisión y exportación; Borrador / Finalizado.
- **One wording module:** `web/src/lib/wording.ts` — `STATUS_LABELS`, `ROLE_LABELS`,
  `SEXO_LABELS`, `TECHNIQUE_ZONE_TITLES`, `SECTION_TITLES`, common buttons/states (`UI`), and
  es-MX helpers (`formatCount`, `plural`, `edadLabel`). `api/types.ts` re-exports the label maps.
  No i18n framework.
- **Server errors:** the backend's `detail`s stay English (API contract; the client compares
  against them). `web/src/api/serverMessages.ts` translates them for display only
  (`serverMessage`, `translateDetail`); `errorMessage(e)`, the login/change-password/finalize/
  export/account-form mappers all go through it. An unknown detail shows as
  "El servidor respondió: <detail>".
- **Dates/numbers:** `formatDateTime` is es-MX ("25/09/2026, 14:03"), `formatTime` for the session
  banner, the admin chart and counters use es-MX (`toLocaleDateString('es-MX')`, `formatCount`).
- **Guard:** `web/src/test/spanishUi.test.tsx` parses every non-test source file (TypeScript AST)
  and fails on common English UI words in JSX text / string literals (allowlist = the known server
  details), and renders 7 clinical + 6 admin/account screens checking text and aria/title/
  placeholder attributes.
- **Review must-fix — seeded biometrics on a new case:** `newCaseForPatient` sets
  `profile.age` from `PatientDTO.edad`; when the create PUT answers after local edits, the case
  store adopts the server's seeded profile/identity fields the user has not touched since the
  create was sent (`adoptCreateSeeds` in `state/caseStore.ts`), so the next PUT never overwrites
  them with 70/170/40. Tests in `state/caseStore.test.ts` + the "+" flow asserts `age` = edad.
- **Review must-fix — unknown sex:** `validatePatient` now requires sexo (the form no longer offers
  "Sin especificar"). Legacy patients with `sexo ''` show "Sexo sin especificar" on the patient
  header plus a warning banner with **Editar paciente**, and the case's Patient Data shows
  "Sin especificar" with a warning (it reads the patient, not the snapshot's "male" default).

## As built — increment 4 (admin patients + polish)

- **Review must-fix: validator messages.** `web/src/api/serverMessages.ts` now translates the
  backend's validator messages, both raw and wrapped as pydantic's "Value error, …":
  - `<field> cannot be blank` (patients);
  - `fields cannot be null: a, b` (patient and admin-user patches);
  - `username must be 1-64 characters`, `password must be N-M characters`;
  - the reserved `gw-` prefix.

  Field names go through `FIELD_ES` (nombre → Nombre, registro → Registro, full_name → Nombre
  completo…). `web/src/api/serverMessages.test.ts` asserts that each one translates and never
  falls through to "El servidor respondió: …".
- **Admin nav:** Panel · Pacientes · Casos · Usuarios · Documentos (all Spanish).
- **`/admin/patients`** (`AdminPatientsPage.tsx`): `GET /admin/patients`, 25 per page, with
  `?q=` (debounced, nombre or registro) and `?page=` in the URL.
  - Each row shows nombre, registro, edad and sexo, the case count and the last update.
  - The case count links to `/admin/cases?patient_id=…`; a patient with no cases shows "Sin casos".
- **`/admin/patients/:id`** (`AdminPatientPage.tsx`) reads `GET /patients/{id}`, which any user
  may read.
  - It shows the identity read-only and a case table (Caso N, diagnosis, author, status, date),
    each row opening the admin's read-only case view, plus "Ver en la lista de casos".
  - **Eliminar paciente** is offered only while the patient has no cases, with an in-page
    confirmation, then `DELETE /admin/patients/{id}`. The admin returns to the list with a notice.
  - If a case appeared in the meantime, the server's 409 shows in Spanish and the page reloads.
- **`/admin/cases`:**
  - The Paciente column shows `patient_nombre` (falling back to the snapshot) and "Registro …",
    plus a "Solo este paciente" link.
  - `?patient_id=` filters the list and shows a chip ("Paciente: nombre · Registro …", which
    links to the patient) with **Quitar filtro de paciente**.
  - A malformed id is explained locally and never sent (the server would 422).
- **Admin case view:** the facts include **Paciente**, linking to the admin patient page.
- **Dashboard:** every stat tile links to its list (Pacientes → `/admin/patients`, Borradores →
  `?status=draft`, and so on).
- **Tests:**
  - `web/src/routes/admin/AdminPatients.test.tsx` covers: the nav, the list with counts, search
    ↔ URL, the patient page, the delete guard (none offered with cases), delete with confirm and
    cancel, the 409 race, an unknown patient, the case-list filter ↔ URL (chip, clear, "Solo este
    paciente"), a malformed `patient_id` that is never requested, the patient link on the case
    view, and the dashboard tile.
  - `fakeAdminServer` fakes the admin patient routes.
  - The Spanish guard renders the three new admin screens.
- **e2e:** `backend/scripts/e2e.py` matches the final API. Step 7 now also reads
  `GET /patients/{id}` as the admin (none of the cases editable) and checks that
  `DELETE /admin/patients/{id}` answers 409 while the patient has cases.

## As built — review fixes (2026-09-25)

- **Registro normalisation** in SQL (repository lookup + 0009 grouping); see increment 1 above.
- **No English from pydantic:** `serverMessages.ts` maps `Input should be a valid UUID…` to
  "Identificador no válido." and any other `Input should be …` to "Valor no válido." (the English
  expectation is never echoed). `PatientView` and `AdminPatientPage` answer a malformed id
  locally ("Paciente no encontrado", no request).
- **Transport errors in Spanish:** a failed fetch reads "No se pudo conectar con el servidor.
  Verifique su conexión." (the browser's reason stays on `error.cause`); a non-`ErrorDTO` body
  (proxy HTML) reads "El servidor no está disponible (HTTP n). Inténtelo de nuevo." and is kept
  only in `BackendError.body`.
- **`caseStore.exportForm`** saves first only for an own, non-finalized draft that is dirty,
  not yet created or saving (the `generateDocument`/`finalize` rule), so a colleague's or a
  finalized case exports without a refused PUT.
- The drug ledger's unit placeholder reads "Unidad"; the Spanish guard now treats JSX text as prose
  (lower-case English words such as `unit` are caught there). "Datos del encuentro" → "Datos del
  caso". `CaseSummaryDTO.registro` (the case snapshot) lets the admin case list fall back to it
  when the patient has no registro.
