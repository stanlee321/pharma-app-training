---
type: plan
updated: 2026-09-25
tags: [plan, web, frontend, mvp]
---

# Web port — TivaTrainer clinical form app (Vite + React + TS)

**Decision (2026-09-25):** the MVP moves to a **web app in `web/`**. Swift/iOS development is on
hold; Swift↔TS drift is accepted. Security stays a **mock login** (real auth is a later backend
task). Patient data is **mock/synthetic** only.

## Scope

Port the **clinical form spine** only: Login → Encounter List → Encounter Hub → 9 section screens
(Technique has 3 zones) → Review/Export (backend fill-pdf, 4 forms).
**Out of scope:** the legacy PK tools (drug selection, patient input, simulation chart,
2D/3D compartmental), the launch modal. The one engine touchpoint kept is the **TCI
recommendation chip** (Drug Ledger + Technique) = `computeTCI` from a zero state, so only the four
models' parameter equations + `computeTCI` are ported.

## Stack

- Vite + React + TypeScript (strict), React Router, Zustand, Vitest, ESLint.
- **Plain CSS** with iOS-grouped-list tokens (system font, `#F2F2F7` ground, white rounded
  cards, segmented control, iOS blue) — matches the current iOS build.
- Wire types generated from the backend's OpenAPI (`web/openapi.json` snapshot →
  `openapi-typescript`). The backend DTOs (snake_case) are authoritative.
- API client = TS port of the `CaseBackend` port (`RestBackend` + `InMemoryBackend`), optimistic
  store semantics as in `MockCaseStore`; `X-User-Id` = persisted mock login UUID.
- Dev: Vite proxy `/api` → `http://127.0.0.1:8000` (backend untouched; no CORS needed).

## Routes

`/login`, `/pacientes` (Historias clínicas; `/cases` redirects here), `/pacientes/nuevo`,
`/pacientes/:id`, `/cases/:id`, `/cases/:id/{patient,preanesthetic,technique/:zone,monitoring,drugs,fluids,recovery,newborn,review}`.
The encounter list was replaced by the patient list and the patient screen ([[patients-historias]],
increment 2).

## Build (via `/delegate-build`, one workflow)

| Inc | Deliverable |
|---|---|
| 1 | Scaffold, tokens, router, API client + store, shared form controls, Login + Encounter List |
| 2 | Encounter Hub, Patient Data, Preanesthetic, Technique (3 zones) |
| 3 | Monitoring, Drug Ledger, Fluid Balance, Recovery (Aldrete), Newborn |
| 4 | TS PK params + `computeTCI` + Vitest vs `04_Validation_Reference.md`; TCI chips; Review/Export |

Each increment gets a read-only phase review whose must-fixes feed the next increment; then a
parallel final audit (wire contract round-trip, Swift-screen parity, gate re-run) + synthesis.

## Done when

`tsc` + ESLint + Vitest + `vite build` green; browser e2e against the local backend: create →
fill every section → save → export all 4 forms; works at phone and desktop widths.

## Status (2026-09-25)

Built via one `/delegate-build` workflow (4 increments + per-increment review + 3-lens audit):
verdict FIX_NEEDED → 4 must-fixes applied by hand (StepperRow focus/blur no-op write; airway row
writes `cuello` — the key the forms export; export keeps the failed-save cause; Dilution min 0.001).
Gates green: typecheck, lint, Vitest 21 files / 108 tests, `vite build`. Wire round-trip + tenant
isolation + all 4 form exports verified in-process and live through the Vite proxy.

**Known gaps (accepted for MVP):** vital-series / surgical-event entry is minimal; some DTO fields
have no UI (e.g. `VitalSnapshotDTO.pvc`); patient name is on no exported form; an unknown
`form_id` returns a 200 summary PDF; 4 moderate `npm audit` advisories (react-router 6, vitest 3 dev).
**Nits left open:** `beforeunload` `returnValue`; `X-User-Id` fallback when localStorage is blocked;
delete should await an in-flight save; single `isFemale` helper; sticky fluid-total row background.

**Swift-side divergences (Swift on hold — log only):** FluidBalance writes Cristaloide/Coloide and
counts NCL as intake; Recovery writes lowercase `otras` keys; Preanesthetic binds `viaAerea` (forms
read `cuello`); Drug Ledger chip should use each drug's own dilution/unit; no 0-weight/height guard.

### Phase 5 (web, [[auth-admin]]) — increment 1: real auth (2026-09-25)

The mock login and `X-User-Id` are gone. The web client now uses the backend's `local` auth mode.
- **One HTTP layer**, `web/src/api/http.ts`. It sends a Bearer token on every call. A 401 logs out
  with a "session expired" notice, and a 403 `password change required` sends the user to
  `/change-password`. Errors carry `ErrorDTO.detail`.
- **Auth store** (zustand, persisted as `auth_session_v1`). It logs out when the token expires.
  `refreshMe()` runs on boot.
- **Login.** Username and password. The Server field moved into an Advanced disclosure and the
  role picker was removed.
- **Change password.** Forced while `must_change_password` is set, and reachable voluntarily
  from the user menu. After it succeeds the client logs in again automatically, because the
  backend revokes the token.
- **Role landing and guards.** `/cases/**` is for anesthesiologists and `/admin/**` for admins;
  the wrong role is redirected to its own landing page. Both roles get a user menu.
- **Admin shell.** `/admin` has a nav with placeholder pages.
- **Nits closed.** `beforeunload` now sets `returnValue`. Case delete waits for any in-flight or
  queued PUT. `lib/sex.ts` `isFemale` is the single sex rule.

Gates: typecheck, lint, Vitest (23 files / 135 tests, mocked fetch) and build all pass. The auth
contract was checked live with curl, both directly and through the Vite proxy. The synthetic
`wf-` accounts used for that were deleted afterwards.
**Next:** finalize/read-only/documents UI, then the admin pages.

### Phase 5 — increment 2: lifecycle, read-only, documents (2026-09-25)

- **Status badges** (Draft / Finalized) on every Encounter-list row and in every case screen's nav
  bar. A finalized row has no delete (the server would answer 409).
- **Finalize** on Review & Export (owner, draft): in-page confirmation → save pending edits →
  `POST /cases/{id}/finalize`; the 4 stored forms are then listed. 409s ("case changed during
  finalize; retry", "case is finalized") are explained and the case is reloaded.
- **Read-only via one mechanism**: a `ReadOnly` context provided by `CaseScreen` and consumed by
  the shared controls (disabled inputs, hidden add/delete, locked SaveBar, "Finalized —
  read-only" banner), plus a disabled `<fieldset>` around the form and a store-level refusal of
  edits/saves on a finalized case. No per-screen forks.
- **Documents panel** per case: grouped by form (known order), latest + older versions,
  generate & store (replaces the stream-only export in the UI), inline preview / download via
  an authenticated blob URL (revoked), delete for admin or owner-while-draft.
- **409 on save** → readable notice + reload of the locked case.
- **JSONB order audit**: only Review's Aldrete totals used key order (string-sorted); now the form
  order. All grids already iterated known constants; a reversed-keys test covers them.
- **Review must-fix (session loss)**: a 5-minute expiry warning with "Save now", and unsaved
  edits kept as a per-user draft on an involuntary sign-out (expiry / 401), restored and saved at
  the same user's next login (24 h TTL; deliberate Sign Out keeps nothing).

Gates: typecheck, lint, Vitest (27 files / 185 tests, mocked fetch) and build pass. The lifecycle
and documents endpoints were checked live (direct and through the Vite proxy) with a synthetic
`wf-` account, whose case and account were deleted afterwards.
**Next:** the admin pages (dashboard, cases with the read-only case view, users, documents).

### Phase 5 — increment 3: admin dashboard + users (2026-09-25)

- **Review must-fixes (session drafts).** A restored draft is no longer re-PUT blindly: the client
  first GETs the case. 404 → the draft is dropped and listed as "deleted on the server" (a draft
  that never reached the server is created instead). Finalized, or an `updated_at` different from
  the one the draft was based on → nothing is saved; the server copy is shown and the case screen
  offers **Re-apply my changes** / **Discard them** (only Dismiss for a finalized case). Only an
  unchanged case is saved, and the Encounter-list notice counts only drafts that actually saved.
  Server unreachable → the draft is kept for the next sign-in. Drafts now store a per-case
  `saved_at` (a merge keeps the earlier one), and `purgeExpiredDrafts()` sweeps **every** user's
  `case_drafts_v1:*` keys (expired or unparsable) at boot (`src/boot.ts`), login and logout.
- **Dashboard** (`/admin`): stat tiles (cases, drafts, finalized, documents), a hand-built SVG
  cases-per-day column chart for the 30 zero-filled UTC days (hover / keyboard tooltip, peak label,
  accessible summary, "Show as table"), and the per-anesthesiologist table linking to
  `/admin/cases?user_id=…`.
- **Users** (`/admin/users`, `/new`, `/:id`): search / role / status filters in the URL; create
  with a temporary-password generator and a show-once result; edit (only changed keys are sent);
  reset password (show-once); delete with an in-page confirm, and on 409 "owns cases" an offer to
  **Deactivate instead**. The self / last-admin guards (409) are shown inline; your own role,
  active flag, reset and delete are not offered. The `gw-` reservation is left to the server and its
  422 message is shown on the username field.
- Loading, empty and error (Retry) states on every page; a refetch keeps the previous frame dimmed.

Gates: typecheck, lint, Vitest (31 files / 240 tests, mocked fetch) and build pass. The admin users
API and stats were checked live (direct and through the Vite proxy) with synthetic `wf-` accounts,
which were deleted afterwards; the `admin` account was not modified.
**Next (done in increment 4):** admin Cases (filterable list + read-only case view, delete, reopen) and Documents.

### Phase 5 — increment 4: admin cases + documents, docs (2026-09-25)

- **Review must-fix (chart tooltip).** On the tallest bars (the peak day) the cases-per-day
  tooltip used to go above the card, which clips overflow, and covered the peak label. It now flips
  below the bar cap when there is no room above it (`chart__tooltip--below`, `data-placement`).
- **Cases** (`/admin/cases`): `GET /admin/cases`, 25 per page with Previous / Next. Status,
  anesthesiologist, created-date range (inclusive UTC days) and text filters all live in the URL
  (`?status=&user_id=&q=&date_from=&date_to=&page=`), so the dashboard's per-anesthesiologist links
  work. Changing a filter resets the page. A reversed date range is explained locally and not sent.
- **Read-only case view** (`/admin/cases/:id/**`): the existing section screens are reused through
  two scopes instead of per-screen forks:
  - a case scope (`state/caseScope.ts`) that points the links under `/admin/cases/{id}` and loads
    with `GET /admin/cases/{id}` (the store keeps that copy view-only);
  - the increment-2 `ReadOnlyProvider` (reason "viewer").

  The Hub adds case facts, **Reopen** (finalized only), the documents panel (the admin can
  generate, view and delete) and **Delete case**. Reopen and Delete each have an in-page confirm.
  After a delete the admin returns to the same filtered list with a notice.
- **Documents** (`/admin/documents`): `GET /admin/documents`, paginated, with form and case
  filters in the URL. The case view links here with `?case_id=`. A malformed case id is flagged on
  the field and not sent. **Open** downloads through the authenticated layer into a blob URL shown
  inline with Download, and the blob URL is revoked. This preview logic is now shared with the
  per-case panel (`usePdfPreview`, `PdfPreview`).
- The Users search box now re-syncs when the URL changes (shared `useUrlText`). The web README
  documents login, roles, the admin area, the proxy/env settings and the `create-admin` CLI.

Gates: typecheck, lint, Vitest (33 files / 270 tests, mocked fetch) and build pass. The admin
cases, documents, reopen and delete API behaviour was checked live, directly and through the Vite
proxy, with synthetic `wf-` accounts and cases, all deleted afterwards. The `admin` account was not
modified. The UI was not checked in a real browser.

### Phase 5 — final-review fixes (2026-09-25)

The final audit returned FIX_NEEDED. These fixes were applied in `web/` only, each with a test that
fails without it:
- **Cross-account leak (high).** `createCaseStore` keeps a session epoch that `reset()` bumps.
  Refresh, load, save (and its queued follow-up), delete, restoreDrafts, finalize,
  generateDocument and exportForm capture the epoch before their first await and drop late results.
  The store-level actions throw `SessionChangedError`. Sign-out, or a different account signing in,
  also aborts the old session's authenticated requests (`abortSessionRequests()` in `api/http.ts`).
  Tests: `state/caseStore.test.ts` "reset() drops responses…" and `state/sessionIsolation.test.tsx`.
- **Admin pieces.** The case owner filter lists only anesthesiologists, and an unknown `?user_id=`
  keeps its "Account …" option. The admin case Hub shows the owning **Account** (resolved with
  `GET /admin/users/{id}` and linked) apart from **Anesthesiologist (form)**. The new-user
  username and password fields and the reset-password field use `autoComplete="off"` with
  `data-1p-ignore` and `data-lpignore`. Only Change password keeps `new-password`. Saving your own
  account updates `authStore.user` through `setUser`.
- **Store actions take access.** `generateDocument`, `exportForm` and `finalize` accept
  `{access}`, which defaults to the access of the cached copy. The documents panel passes the
  scope's access, so an admin never caches an editable copy. The admin export skips the save.
- **Login server URL.** It is tried through a temporary client (`HttpClient.withBaseUrl`) and saved
  to `backend_base_url` only after the login succeeds.
- **Demoted admin.** A 403 `admin only` calls `refreshMe()`, and the role guard then redirects.
- **Nits.**
  - The login redirect keeps pathname plus search, and only the pathname is role-checked.
  - Logout clears the remembered admin case filters.
  - Other tabs follow `auth_session_v1` through the `storage` event. A sign-out there signs this
    tab out, and another account signing in there replaces this tab's session and drops its cases.
  - The admin documents index shows "Local file · name.pdf", with the full path in a tooltip, or
    "Stored in the database" for `storage_backend: "db"`.
- `openapi.json` and `schema.d.ts` were regenerated from the backend on disk and did not change
  (`storage_backend` and the nullable `storage_path` were already in).

Gates: typecheck, lint, Vitest (34 files / 303 tests) and build pass. Nothing was checked live.

### Historias clínicas + Spanish-only UI (2026-09-25)

See [[patients-historias]]. The UI is Spanish only (no i18n framework): shared wording in
`src/lib/wording.ts`, server `detail` translation in `src/api/serverMessages.ts`, es-MX dates and
numbers, and a guard test (`src/test/spanishUi.test.tsx`) that fails on English UI strings in the
source or on rendered screens.

**Still open:**
- Run `alembic upgrade head` and restart the backend, then check that `GET /admin/documents`
  returns `storage_backend`.
- The remaining review nits:
  - UserMenu on the Hub and clinical screens
  - `key={id}` on AdminUserPage
  - the document 404 wording
  - a finalize-in-flight lock
  - explicit `disabled` on the raw inputs
  - boot-path tests
- Click through the app in a real browser.
