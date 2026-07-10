---
type: plan
updated: 2026-07-10
tags: [plan, screen, build-spec]
---

# Login (mock) — build spec

> A **mock** sign-in gate at launch: capture a session author identity (no real auth —
> [[decisions]] ADR-3), then re-root into the encounter list. Placeholder for a real auth
> phase later.

## Entities & data

- **No case data.** Sets a session **author/owner** used to stamp `cases.owner` (ADR-3) when
  cases are created. For the mock, a name/clave (and optional role) is enough — no password
  validation, no token.

Field load: trivial — 1 text field (name/clave), optional role picker, a Sign In button. No
schema source (it is not a clinical form).

## Components

| Component | Status | Renders here |
|---|---|---|
| Launch-modal overlay / card + section-header idiom (from `PatientInputView`) | reuse-existing | the sign-in card |
| Labeled text row (the unified widget) | reuse-existing (once built) | name / clave field |
| `DesignSystem` tokens | reuse-existing | colours / fonts / spacing / haptics |
| `LoginView` | build-new | the screen itself |

## Backend binding

Mock only — **no network call**. Sign In sets `AppState.author` locally and navigates.

- Future (real auth phase, deferred — ADR-3): `POST /api/v1/auth/login` → token; thread the
  author through the API seam. **Not built now.**
- Crosswalk: n/a (no clinical fields).

Mock action (no payload): tap Sign In → `AppState.author = Author(name:…, role:…)` →
`navigationPath = [.encounterList]`.

## Reuses (existing app)

- **Launch-modal overlay / `hasSeenAnnouncement_v1` gate pattern** ([[state-navigation]]) — the
  same one-time-gate idiom, repurposed as an auth gate.
- **`PatientInputView`** card chrome + **`DesignSystem`** tokens.
- **`Route` enum + `RootView`** re-root — login becomes the launch root; drug selection is no
  longer the spine ([[screens]]).

## To build (the gap)

| Item | Kind | Proposed path |
|---|---|---|
| `Route.login` case (new launch root) | route | `PharmaApp/App/Route.swift` |
| Re-root `RootView` to open at `.login` → on sign-in go to `.encounterList` | other | `PharmaApp/App/RootView.swift` |
| `LoginView` | view | `PharmaApp/Views/Login/LoginView.swift` |
| `AppState.author` + `signIn(_:)` mock action | other | `PharmaApp/App/AppState.swift` |
| `Author` value type (name, role, id) | model | `PharmaApp/Models/Author.swift` |

## Dependencies

- **None** for the mock (no `CaseStore`, no backend). It shares the **`Route` re-root** with
  [[encounter-list]] (both change the launch spine), so build them together in the foundation step.
- Real auth is a later phase (ADR-3); the mock unblocks the flow now.

## Readiness

**Near-ready.** No `CaseStore` or backend dependency — the only coupling is the `Route` re-root it
shares with [[encounter-list]]. Alongside [[preanesthetic-assessment]], one of the two most
build-ready screens; a good **pilot** to validate the codegen loop.

## Open questions

- Does the mock persist the chosen author across launches (`@AppStorage`) or ask every time?
- Should login also pick/enter a **clinic** (ADR-3 mentions a later `clinic` column)?
