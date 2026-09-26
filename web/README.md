# TivaTrainer — web

Vite + React 18 + TypeScript (strict) port of the TivaTrainer **clinical form spine**
(Login → Historias clínicas (patients) → Paciente → Encounter Hub → section screens →
Review/Export). See
`docs/wiki/plans/web-port.md` for scope and the increment plan.

Stack: react-router-dom v6, zustand, plain CSS (tokens in `src/styles/tokens.css`), Vitest +
Testing Library (jsdom), ESLint, openapi-typescript. Dependency versions are pinned exactly.

## Run

```bash
cd web
npm i

# backend (separate terminal, from ../backend — see its README / the repo CLAUDE.md)
#   conda activate tiva_backend && uvicorn app.main:app --port 8000 --reload

npm run dev          # http://localhost:5173 — "/api" is proxied to http://127.0.0.1:8000
```

### First admin, then everyone else

There is no self-registration. The backend must run in `local` auth mode (the default; it needs
`TIVA_JWT_SECRET`, see `docs/wiki/backend-api.md`). Create the first admin with the backend CLI
(idempotent: re-running it resets that account's password and makes it an active admin):

```bash
cd ../backend && conda activate tiva_backend
python -m app.cli create-admin --username admin --password '<8+ chars>' --full-name 'Admin'
python -m app.cli create-admin --username admin --password-stdin < secret.txt   # keeps it out of shell history
```

Sign in on the web app with that account: an admin lands on `/admin`. Create the anesthesiologist
accounts under **Users → New user** (or `POST /admin/users`); each gets a temporary password,
shown once, that must be changed at first login.

### Roles

| Role | Lands on | Can |
|---|---|---|
| `anesthesiologist` | `/pacientes` | Every patient and every case (shared hospital-wide). Create / edit patients. Own cases: create, edit, finalize (locks the case and stores the 4 forms), generate / view documents, delete documents and cases while a draft. Others' cases: read-only (view documents) |
| `admin` | `/admin` | Read every case (read-only), generate / view / delete any document, delete any case, reopen a finalized case, manage accounts. Never edits case content |

An anesthesiologist opening `/admin/**` is sent to `/pacientes`; an admin opening `/cases/**` or
`/pacientes/**` is sent to `/admin`. The role always comes from the account (the login screen has no role picker).

### Server URL, proxy and env

The **Server** field (under **Advanced** on the login screen, saved as `backend_base_url`)
defaults to `/api/v1`, which goes through the Vite proxy (`vite.config.ts`: `/api` →
`http://127.0.0.1:8000`), so the backend needs no CORS setup. Pointing it at an absolute URL
(e.g. `http://192.168.0.29:8000/api/v1`) makes the browser call the backend directly, and that
only works if the backend sends CORS headers (it does not today). For a phone on the LAN, open
the Vite dev server's network URL instead (`npm run dev -- --host`) and keep `/api/v1`.

Offline, with no backend: `VITE_USE_INMEMORY=1 npm run dev` swaps in the in-memory backend,
seeded with one synthetic demo case; any username + non-empty password signs in as a fake
anesthesiologist. Export is not available in that mode.

## Features

- Real login (see "Auth"): username + password → Bearer JWT; forced / voluntary password
  change; role-based landing (anesthesiologist → `/cases`, admin → `/admin`) and route guards;
  an account menu (name, role, Change password, Sign Out) in the top bar for both roles.
- **Admin area** at `/admin` (Dashboard · Cases · Users · Documents): stats + 30-day chart,
  account management, a filterable case list with a read-only case view (Reopen, Delete,
  documents) and the document index with authenticated downloads (see "Admin").
- **Historias clínicas** (see "Patients"): the patient list with search, new patient (duplicate
  registro → open the existing one), the patient screen (identity + edit, the patient's cases
  "Caso N" by every author, "+" new case), then the Encounter Hub with per-section completion;
  every case row and every case screen's nav bar shows a **Draft / Finalized** badge.
- **Case lifecycle** (see "Finalize, read-only and documents"): Finalize on Review & Export
  (in-page confirmation), finalized cases read-only everywhere, a per-case Documents panel.
- Clinical sections ported from the Swift views: Patient Data (with derived IMC / peso ideal /
  VSC), Preanesthetic Assessment, Anesthetic Technique (General / Regional Neuraxial / Peripheral
  Block), Transanesthetic Monitoring, Drug Ledger, Fluid Balance, Recovery (Aldrete), Newborn.
- **TCI decision aid** (client-side, ADR-5) from a TypeScript port of the mock PK engine
  (`src/engine/`):
  - Drug Ledger: every row with a PK model (`rust_model_id`) shows
    "TCI: x ml bolus · y ml/h @ 3.0" — plasma target 3.0, zero state.
  - Technique · General: a "Target Cp" stepper (1–8 mcg/ml; stored in the technique blob as
    `tci_target_cp`, default 4.0) with the live "Bolo … ml" / "… ml/h" recommendation (Marsh).
  - The recommendation is recomputed on every render and **never persisted**: no backend DTO has
    a `recommended` field. Volumes use the case's `patient.profile.dilution`.
- **Review & Export**: a read-only case summary, Finalize, and the Documents panel (generate &
  store a form, versions per form, inline preview + Download, delete when allowed).
- **Session expiry**: a warning 5 min before the token expires ("Save now"); unsaved edits are
  kept as a per-user draft on an involuntary sign-out and restored at that user's next login.

## Auth

- `src/api/http.ts` is the ONE HTTP layer (`HttpClient`, app instance `http`). Every call sends
  `Authorization: Bearer <token>` (the login call itself does not). A **401** on a call that
  carried a token logs out with a "session expired" notice; a **403** `password change
  required` flags the user. Redirects are state-driven: `RequireAuth` sends a signed-out user to
  `/login`, a pending change to `/change-password`, and the wrong role to its own landing.
  Errors are `BackendError` with `detail` = the server's `ErrorDTO.detail`. Binary downloads use
  `http.blob()` → `URL.createObjectURL` (revoke on unmount); never an `<a href>` to an API URL.
- `src/state/authStore.ts` (zustand): `{token, expiresAt, user: UserDTO}` persisted under
  `auth_session_v1` via the guarded `lib/storage.ts` (MVP risk: JWT in localStorage).
  `login()`, `logout(notice)`, `refreshMe()` (on boot, `main.tsx`), `changePassword()`, and
  `startSessionTimer()` (logs out at `expiresAt`; no refresh tokens). A late 401 for a token
  that is no longer the current one is ignored.
- `POST /auth/change-password` revokes every older token, the caller's included, so the store
  logs in again automatically with the new password (on failure it signs out with a notice).
- `src/api/authApi.ts`: `AuthApi` port — `RestAuthApi` (live) and `InMemoryAuthApi` (offline
  fake anesthesiologist). Tests use `src/test/auth.ts` (`signInAs`) and
  `src/test/fakeAuthServer.ts` (a mocked-fetch model of the backend's auth rules).
- Signing out, or signing in as another account, clears the case store's local copies.

## PK engine (`src/engine/`)

A line-for-line port of `PharmaApp/Engine/MockPKEngine.swift`: the four models'
`*Params(patient)` (`marsh`, `schnider`, `minto`, `hannivoort`), the James lean-body-mass helper
and `computeTCI(modelId, patient, [x1,x2,x3,Ce], target, 'plasma' | 'effectSite')` → `TCIResult`.
`simulate`/RK4 are not ported (the simulation screens are out of scope). Internal units are
unchanged from Swift: mg, mg/ml, ml, clearances in ml/min, rate constants per minute. Targets
come in display units and are divided by `displayFactor` (×1000 propofol → mcg/ml,
×1e6 remifentanil and dexmedetomidine → ng/ml). `drug_models.json` is a verbatim copy of
`PharmaApp/Resources/drug_models.json`; keep them in sync, and change math in Swift + the spec
first. `mockPKEngine.test.ts` checks every model against the hand-calculated values in
`docs/reference/rust-engine-spec/04_Validation_Reference.md` (0.5 % relative tolerance; see the
test header for the reference's gaps). A mutation check confirmed it catches the pre-2026-09-16
Schnider bug (V3 10× too small, no V2 age term).

## Patients (historias clínicas)

Plan: `docs/wiki/plans/patients-historias.md`. Patients are shared hospital-wide; the identity
(nombre, registro, sexo, fecha de nacimiento, grupo, Rh) lives on the patient, per-encounter values
stay on the case, and the server keeps every draft's identity snapshot equal to its patient.

- `api/patientApi.ts`: `PatientApi` port — `RestPatientApi` (`GET/POST /patients`,
  `GET/PATCH /patients/{id}` through the one HTTP layer) and `InMemoryPatientApi` (offline mode,
  reads the patient's cases from the in-memory case backend). `existingPatientId(e)` reads the
  409 `{detail: "patient exists", patient_id}`.
- `state/patientStore.ts` (zustand): the list (`search(q)`, a stale answer is dropped), per-patient
  detail (`loadPatient`), `createPatient` / `updatePatient` → `{kind: 'saved' | 'exists'}`.
  Session isolation like the case store (epoch; reset on sign-out / account change). A patient
  edit marks that patient's clean loaded case copies unloaded (`caseStore.invalidatePatient`),
  since the server re-copied their identity.
- Screens (`routes/patients/`): `/pacientes` (search kept in `?q=`, debounced), `/pacientes/nuevo`,
  `/pacientes/:id` (`?editar=1` opens the form; the form PATCHes only the changed keys).
  "+" on the patient screen = `caseStore.createCase(owner, patient)` → `newCaseForPatient`
  (`patient_id` + identity) → the Hub. The Hub's back link goes to the case's patient.
- Case Patient Data: identity read-only with **Editar paciente**; peso, talla, edad, dilución,
  cama, Hb, Hto editable. A patient whose sexo is unknown (`''`, legacy) shows "Sin especificar"
  plus a warning (the PK models would compute as male); new/edited patients must have a sexo.
- A new case copies the patient's `edad` into `profile.age`; the server's seeded biometrics are
  kept even if the user edits before the create PUT answers (`adoptCreateSeeds`).
- **Others' cases are read-only**: the case store marks a case read via `GET /cases/{id}` whose
  `user_id` is not the signed-in user (`setCaseViewer`, registered by the auth store) as
  `meta.foreign`; `updateCase` / `save` refuse it, so no PUT can be sent. `CaseScreen` feeds it to
  the one read-only mechanism (banner "Caso de otro anestesiólogo — solo lectura"); Review hides
  Finalize, Generate and document delete for it.
- Tests: `routes/patients/patients.test.tsx`, `state/patientStore.test.ts`; `restHarness` fakes
  the `/patients` routes (409 on a duplicate registro, `can_edit`, numbering, identity copied into
  drafts, `patient_id` required to create a case).

## Language (Spanish only)

The whole UI is Spanish; there is no i18n framework.
- `src/lib/wording.ts`: the shared wording — status / role / sex labels, technique zones, the case
  section titles (paper-form vocabulary), common buttons and states (`UI`), and es-MX helpers
  (`formatCount`, `plural`, `edadLabel`). Screen-specific text stays in its screen.
- `src/api/serverMessages.ts`: the backend's `ErrorDTO.detail` strings are English and part of the
  API contract (the client compares against them). They are translated only for display:
  `errorMessage(e)` → `serverMessage(detail)`; unknown ones read "El servidor respondió: …".
  Validator messages (`<field> cannot be blank`, `fields cannot be null: …`, username/password
  length, the `gw-` prefix) are translated too, raw or wrapped as pydantic's "Value error, …";
  wire field names go through `FIELD_ES`. `api/serverMessages.test.ts` pins them.
- Dates: `lib/datetime.ts` formats es-MX (`formatDateTime`, `formatTime`, `formatDateEs`).
- Guard: `src/test/spanishUi.test.tsx` scans every non-test source file (TypeScript AST) and a set
  of rendered screens for common English UI words; add new server-contract strings to its
  allowlist (via `KNOWN_SERVER_DETAILS`) rather than showing them.

## Finalize, read-only and documents

- **Finalize** (owner, draft; Review & Export): "Finalize case…" opens an in-page confirmation
  (no `window.confirm`). `caseStore.finalize(id)` saves pending edits first (stops if that
  fails), then `POST /cases/{id}/finalize`, which locks the case and stores the 4 forms. The
  Documents panel then lists them. 409s are explained ("case changed during finalize; retry" →
  nothing locked, try again; "case is finalized" → already locked) and the case is reloaded.
- **Read-only, one mechanism** (`components/readOnlyContext.ts` + `ReadOnly.tsx`): `CaseScreen`
  provides the flag (finalized case, or an outer read-only scope such as an admin view) and
  every shared control consumes it: inputs / selects / switches / chips / steppers / grid cells
  are disabled, `ConfirmDeleteButton`, `AddRowButton` and `EditOnly` content disappear, the
  SaveBar shows the lock with Save disabled, and a "Finalized — read-only" banner is shown.
  Section screens never branch on it. `CaseScreen` also wraps the form in a disabled
  `<fieldset>` (catches the few raw controls) and the store refuses `updateCase` / `save` on a
  finalized case. Content that is not case data (Finalize, Documents) goes in `CaseScreen`'s
  `aside` slot, outside the fieldset.
- **409 on a save** (finalized in another tab / by the finalize race): the screen shows a
  readable notice, and the store reloads the locked server copy (the unsaved edits cannot land).
- **Documents panel** (`routes/documents/DocumentsPanel.tsx`, reusable for the admin case view):
  `GET /cases/{id}/documents`, grouped by form in the known form order with the latest version
  shown and older versions in a `<details>`. "Generate & store" = `caseStore.generateDocument`
  (a dirty draft is saved first) → `POST /cases/{id}/documents`; the new document is then
  previewed inline. **View** fetches `GET /documents/{id}/file` through the authenticated HTTP
  layer (never a bare link: it would lack the token), checks the `%PDF-` magic bytes, and shows
  a `blob:` URL in an `<iframe>` with a **Download PDF** link; the URL is revoked when replaced,
  closed or unmounted. **Delete** (in-page confirm) is offered to an admin, or to the owner while
  the case is a draft (`state/documents.ts` `canDeleteDocuments`).
- The legacy stream-only export (`POST /cases/{id}/export/{form_id}`, `caseStore.exportForm`) is
  still in the store and backend port but no longer used by the UI. The offline in-memory store
  cannot render or store documents and says so.

Not ported: Swift's "Build summary (offline)" client-side summary PDF. Mobile Safari may show
only the first page of a PDF inside an iframe; Download opens the full file.

## Admin

Admins land on `/admin` (`routes/admin/`, shell in `AdminLayout.tsx`, content max-width
1100px, the nav wraps under the bar on a phone). All calls go through `api/adminApi.ts` (the one
authenticated HTTP layer).

- **Nav:** Panel · Pacientes · Casos · Usuarios · Documentos (Spanish, like the whole admin area).
- **Dashboard** (`AdminDashboardPage.tsx`): `GET /admin/stats` → stat tiles (Pacientes from
  `patients_total`, Casos, Borradores, Finalizados, Documentos; each tile links to its list), the 30-day
  `CasesPerDayChart` (hand-built SVG; pure helpers in `chartMath.ts`; hover / ←→ Home End
  tooltip, table view) and the per-anesthesiologist table linking to `/admin/cases?user_id=…`.
  `cases_by_status` is read by key; the day series is re-sorted and zero-filled client-side.
- **Users** (`AdminUsersPage.tsx`, `AdminNewUserPage.tsx`, `AdminUserPage.tsx`): filters live in the
  URL (`?q=&role=&active=`). Form rules mirror the backend (`lib/accounts.ts`); server 422/409
  messages are mapped onto fields (`fieldErrors`) or the guard text (`guardMessage`).
  Temporary passwords (`generateTempPassword`, CSPRNG, 3×4 unambiguous chars) are shown **once**
  by `OneTimeSecret`: only in page state, never in the URL, storage or a store.
- **Patients** (`AdminPatientsPage.tsx`, `AdminPatientPage.tsx`):
  - `/admin/patients` is `GET /admin/patients` by name, 25 per page, with `?q=` (nombre or
    registro, debounced) and `?page=` in the URL.
  - Each row shows registro, edad and sexo, and the number of cases, which links to
    `/admin/cases?patient_id=…`.
  - `/admin/patients/:id` reads `GET /patients/{id}` and is read-only. Anesthesiologists maintain
    the identity. The page lists every case, each opening the admin case view.
  - **Eliminar paciente** is offered only while the patient has no cases, with an in-page
    confirmation, then `DELETE /admin/patients/{id}`. If the server answers 409 because a case
    appeared, the error shows in Spanish and the page reloads.
- **Cases** (`AdminCasesPage.tsx`): `GET /admin/cases`, newest first, 25 per page.
  - Every filter is in the URL: `?status=&user_id=&patient_id=&q=&date_from=&date_to=&page=`.
    The dashboard's per-anesthesiologist links, Back and reload keep them; changing a filter
    resets the page.
  - Each row shows the patient (`patient_nombre` + registro) and a "Solo este paciente" link.
  - A `?patient_id=` filter shows a chip naming the patient, with **Quitar filtro de paciente**.
    A malformed id is explained locally and not sent.
  The text search is debounced (`useUrlText`, which also re-syncs the box when the URL changes
  elsewhere); a reversed date range is explained locally and not sent (the server would 422);
  a page past the end offers the first page. Dates are inclusive UTC days of creation.
- **Read-only case view** (`AdminCasePage.tsx`, `/admin/cases/:id/**`): the clinical section
  screens are reused unchanged. `CaseScopeContext` (`state/caseScope.ts`, `ADMIN_SCOPE`) points
  their links at `/admin/cases/{id}/…` and makes `useCase` load with `GET /admin/cases/{id}`;
  the store keeps that copy `viewOnly` (`updateCase` / `save` refuse it). The increment-2
  `ReadOnlyProvider` (reason "viewer") disables every control and shows a read-only banner (a
  finalized case shows the finalized banner). The case facts include **Paciente**, linking to
  the admin patient page. The Hub adds the admin's actions outside the
  disabled form: case facts, **Reopen** (finalized only, in-page confirm → `POST
  /admin/cases/{id}/reopen`, documents kept), the `DocumentsPanel` (generate / view / delete),
  and **Delete case** (in-page confirm → `DELETE /admin/cases/{id}`, then back to the same
  filtered list with a notice). Nested pages render inside the shell's `<main>`
  (`InsideMainContext`), so there is one main landmark.
- **Documents** (`AdminDocumentsPage.tsx`): `GET /admin/documents`, 25 per page, filters
  `?form_id=&case_id=&page=` in the URL (the case view links here with `?case_id=`). A malformed
  case id is flagged on the field and not sent (the server 422s non-UUIDs). **Open** fetches the
  PDF through the authenticated layer (`usePdfPreview` + `PdfPreview`, shared with the per-case
  panel) into a blob URL shown inline with Download; revoked on replace, close and unmount.
  The storage location is shown to admins (`storageLabel`: the file path, or a note that it is
  stored in the database for the `db` backend).
- Tests: `src/test/fakeAdminServer.ts` fakes `/admin/users`, `/admin/stats`, `/admin/cases`
  (filters incl. `patient_id`, paging, reopen, delete, patient fields), `/admin/patients` +
  `GET /patients/{id}` + `DELETE /admin/patients/{id}` (409 with cases), `/admin/documents`, the per-case document routes and the
  file download, with the backend's validation and guard rules (an admin's writes on `/cases`
  → 403); `statsFixture(end, counts)` builds a zero-filled 30-day fixture. Suites:
  `AdminDashboard`, `AdminUsers`, `AdminCases` (filters ↔ URL, paging, read-only view, reopen,
  delete, documents panel), `AdminPatients` (list, search ↔ URL, patient page, delete guard and
  confirm, 409 race, case filter by patient, dashboard tile) and `AdminDocuments`.

### Session drafts (restore rules)

After an involuntary sign-out the same user's drafts are restored only after a `GET /cases/{id}`:
404 → dropped (listed as deleted on the server); finalized or a different `updated_at` → not
applied, the case screen offers Re-apply / Discard; unchanged → saved. Each case keeps its own
`saved_at` (24 h TTL); `purgeExpiredDrafts()` sweeps every user's drafts at boot, login and logout.

## JSONB key order

Postgres JSONB does not keep object key order (and JS enumerates integer-like keys such as the
Aldrete minutes first). Every dict-valued field is rendered in its known form order: Aldrete
criteria / time points (`state/recovery.ts`, also the Review totals), fluid rows / hours
(`state/fluidBalance.ts`), labs (Preanesthetic `LABS`), monitoring and blood-component chips,
document groups (`FORM_OPTIONS`). `routes/jsonbOrder.test.tsx` feeds reversed keys to prove it.

## Data-contract decisions (backend wins over Swift)

- **Fluid Balance rows** are the canonical `control_fluidos` rows the backend derives from and the
  PDF draws, not Swift's rows. Intake: `Ingreso Critaloide` (the form's own spelling),
  `Ingreso Coloide`, `Ingreso hemocomponente`. Losses: `NCL`, `DCL`, `3er Espacio`, `Diuresis`,
  `Circuito respiratorio`, `Sangrado`.
  - Balance parcial = Σ intake − Σ losses, and Balance total is its running sum. This is the
    same formula as `derivations.fluid_balance`; an in-process backend check matched it hour by
    hour.
  - Swift's `Cristaloide` / `Coloide` rows are not on the form. When a case has them, a banner
    offers to move them onto the intake rows.
  - The Swift app still writes the old rows and the old formula (NCL counted as intake). That
    divergence is Swift's to fix.
- **Recovery término scales** are written as `otras.Ramsay`, `otras.Bromage` and `otras.ENA`,
  the keys the PDF crosswalk reads. Swift's lowercase keys are read as a fallback and replaced
  on the next edit. The steppers still show the Swift fallbacks (Ramsay 2, others 0) until
  touched, as in Swift; untouched scales stay blank in the PDF.
- **Review ASA** shows the root `asa`, or `pre_assessment.asa` when the root is empty. Swift
  reads only the root, which no screen writes.

## Known gaps

- No entry UI for the vital-sign series or surgical events (`trans_record.series` / `events`).
  Swift has none either, so the web app only shows a read-only summary of data written by other
  clients, and the PDF `vitals_grid` lanes can't be filled from the web app yet. This gap is
  accepted for now and scheduled as a follow-up.
- The TCI recommendation is not persisted (there is no DTO field for it).
- Patients: admins cannot edit or merge patients (the identity is maintained by anesthesiologists
  on `/pacientes/:id`); legacy patients with an unknown sex compute as male until edited (warned,
  not blocked). The iOS app cannot create cases against this backend yet (422 without
  `patient_id`) — see `docs/wiki/plans/patients-historias.md` "Status".

## Scripts

| Script | What it does |
|---|---|
| `npm run dev` | Vite dev server with the `/api` proxy |
| `npm run build` | `tsc -b` + production build into `dist/` |
| `npm run typecheck` | `tsc -b --noEmit` |
| `npm run lint` | ESLint |
| `npm test` | Vitest (watch). Use `npm test -- --run` for a single run (CI). Per-test timeout 20 s |
| `npm run gen:api` | regenerate `src/api/schema.d.ts` from `openapi.json` |

## API types (`gen:api`)

`openapi.json` is a snapshot of the backend's OpenAPI document. Refresh it **without starting
a server**, then regenerate the types:

```bash
cd ../backend && source ~/anaconda3/etc/profile.d/conda.sh && conda activate tiva_backend && \
  TIVA_AUTH_MODE=local TIVA_JWT_SECRET=openapi-dump-only-0123456789abcdef0123456789 python -c \
  "import json;from app.main import app;json.dump(app.openapi(),open('../web/openapi.json','w'),indent=1)"
cd ../web && npm run gen:api
```

Everything that goes over the wire uses the generated types. `src/api/types.ts` provides
aliases, plus the "complete" client shape `AnesthesiaCase` (every child present, nullable
scalars set to explicit `null`), which `normalizeCase()` builds from the server DTO. JSON keys are
snake_case exactly as in the backend DTOs, and the backend DTOs win over the Swift models.

## Layout

```
src/
  api/        schema.d.ts (generated) · types.ts · factory.ts (newCase/newCaseForPatient/normalizeCase)
              patientApi.ts (PatientApi port: RestPatientApi / InMemoryPatientApi)
              backend.ts (CaseBackend port + BackendError/ErrorDTO detail) · http.ts (the one
              authenticated HTTP layer) · authApi.ts · restBackend.ts · inMemoryBackend.ts
              provider.ts (CaseStoreProvider.useREST, makeBackend/makeAuthApi)
  state/      authStore.ts (session, expiry, guards' state) · authMessages.ts ·
              caseStore.ts (MockCaseStore port) · useCase.ts · caseScope.ts (owner / admin scope)
              patientStore.ts · patientForm.ts (identity form values / validation / bodies)
              useSaveOnLeave.ts · completion.ts (hasData helpers from CaseCompletion.swift)
              techniqueFields.ts (technique values-blob keys + per-zone completion, General fallback)
              monitoring.ts · drugLedger.ts · fluidBalance.ts · recovery.ts · newborns.ts ·
              review.ts (per-screen option lists, row keys and live derivations) ·
              documents.ts (grouping + delete rule)
  engine/     mockPKEngine.ts (4 models' params + computeTCI) · patient.ts (James LBM) ·
              drugDatabase.ts + drug_models.json · types.ts · mockPKEngine.test.ts
  lib/        biometrics.ts (IMC / peso ideal / VSC, Swift-exact) · sex.ts (isFemale — the
              single sex rule for engine, biometrics, chips, Review) · drugModels.ts (picker
              catalogue from engine/drug_models.json + Swift matchedModel) · datetime.ts · pdf.ts (magic-byte
              check) · number · storage (incl. per-user case drafts) · uuid
  components/ Page/NavBar · Section · TextRow/NumberRow/StepperRow · useNumberText ·
              CheckboxValueRow · SegmentedControl · ChoiceChips · ToggleRow/CheckRow ·
              SectionLinkRow · SaveBar · EmptyState · Icon · ConfirmDeleteButton · GridNumberCell ·
              readOnlyContext + ReadOnly (provider, banner, EditOnly, AddRowButton) · StatusBadge
  routes/     AppRoutes · paths · RequireAuth (+ LandingRedirect) · LoginView ·
              ChangePasswordView · UserMenu · admin/ (AdminLayout, Dashboard + chart, Users,
              Cases, Case view, Documents, Pager/paging, useQuery, useUrlText, adminUi) ·
              patients/ (PatientListView, PatientNewView, PatientView, PatientForm) ·
              RestoredDraftsBanner · CaseScreen ·
              EncounterHubView · PatientDataScreen · PreanestheticView ·
              technique/TechniqueScreen (+ TciChipSlot) · monitoring/MonitoringScreen
              (+ VitalsMiniChart) · drugs/DrugLedgerScreen (+ DrugTciChipSlot) ·
              fluids/FluidBalanceScreen · recovery/RecoveryScreen · newborn/NewbornScreen ·
              review/ReviewExportScreen (+ FinalizeSection) · documents/DocumentsPanel
              (+ usePdfPreview, PdfPreview) ·
              SessionExpiryBanner
  styles/     tokens.css · global.css
```

### Persistence semantics (port of `PharmaApp/Services/CaseStore.swift`)

- Every request goes through `http.ts` with the session's Bearer token (no `X-User-Id`).
- `refresh()` → `GET /cases` returns **shells** (summary rows). A screen must call `load(id)`
  (or use the `useCase(id)` hook) before editing. `updateCase` and `save` refuse to act on an
  unloaded shell, so a summary can never overwrite a full case.
- `createCase` and `delete` are optimistic; `delete` waits for any in-flight / queued PUT of
  that case before sending DELETE, so a late PUT cannot re-create it. `save(id)` is a
  full-aggregate `PUT /cases/{id}` (without the server-owned `status`/`updated_at`/
  `finalized_at`/`user_id`);
  the server copy (with its derivations) replaces the local one only if nothing was edited
  while the request was in flight.
- Saves are serialized per case: a `save(id)` issued while a PUT is in flight queues ONE
  follow-up PUT carrying the latest state (skipped if nothing changed), never an overlapping one.
- Editing pattern: screens edit the store's copy of the case (the shared draft; nothing is lost
  on navigation), show a SaveBar (explicit Save, like the Swift toolbar), and every case screen
  PUTs unsaved edits when it is left (the Swift Hub's `onDisappear` save). Closing the tab with
  unsaved edits asks for confirmation.
- `exportForm(id, formId)` saves first, then `POST /cases/{id}/export/{formId}` → PDF `Blob`
  (legacy; unused by the UI). `generateDocument(id, formId)` saves a dirty draft first, then
  `POST /cases/{id}/documents`. `finalize(id)` saves, then `POST /cases/{id}/finalize`.
- A finalized case is locked: `updateCase` / `save` refuse it. A PUT answered 409 sets
  `meta.notice` and reloads the server copy (`load(id, {force, discard})`). `refresh()` drops a
  clean loaded copy whose server status / `updated_at` moved on, so it is reloaded on open.
- Session drafts: `dirtyDrafts()` / `restoreDrafts()` back the auth store's "keep unsaved edits
  across an expiry / 401" (`case_drafts_v1:<user id>`, max 24 h, restored + PUT at the same
  user's next login; a deliberate Sign Out keeps nothing).

Demo and fixture data is synthetic. Never put real patient data in this app or its tests.

## Run the full stack in Docker (and share it)

From the repo root (needs `backend/.env` with a real `TIVA_JWT_SECRET`):

```bash
docker compose up -d --build        # db + backend (migrates on start) + web (nginx) → http://localhost:5174
ngrok http 5174                     # share: https://<id>.ngrok-free.app
```

- nginx serves the built SPA and proxies `/api/*` to the backend container, so the browser only ever
  talks to one origin. Leave the login "Server" field at its default `/api/v1`.
- The backend has no host port; Postgres stays on `localhost:5433` for native development.
- Every API call sends `ngrok-skip-browser-warning`, so ngrok's free-tier interstitial never
  replaces an API response. The **first page load** in a new browser still shows ngrok's
  "Visit Site" page once (a browser cannot send that header on a navigation); a paid ngrok plan
  or another tunnel (e.g. Cloudflare Tunnel) removes it.
- `npm run dev` (Vite on 5173) also accepts `*.ngrok-free.app` hosts (`server.allowedHosts`).
