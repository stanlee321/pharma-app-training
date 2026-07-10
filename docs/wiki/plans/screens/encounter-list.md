---
type: plan
updated: 2026-07-10
tags: [plan, screen, build-spec]
---

# N1 — Encounter List (build spec)
> The new app spine root: a scrollable list of saved `AnesthesiaCase` encounters, with a "New Encounter" action; drug selection stops being the root and becomes a tool *inside* an encounter.

## Entities & data
- **Entity read:** `AnesthesiaCase` (root aggregate) — **read-only**, **read-all / paged summary projection**. This screen **captures zero fields**; it only renders a summary row per case and creates empty ones.
- **Field load:** essentially **nil for capture**. It surfaces a handful of `AnesthesiaCase` root **`attribute`-mode** values per row — `fecha`, `diagnostico_preop`, `asa`, plus the joined `Patient.nombre` / `registro` — out of the ≈49-field root envelope ([[field-inventory]] §2 *AnesthesiaCase root*). No toggle/number/score/table controls render here.
- **Schema sections touched:** none captured; the summary attributes originate in the root envelope (`nota21` header + `imss_p2` diagnostico) — see `notebooks/forms/schema/nota21.schema.json`, `notebooks/forms/schema/imss_p2.schema.json`. The app never sees schema/bbox ([[decisions]] ADR-1); it binds a summary DTO only.
- **Derived / read-only shown:** none are schema-derived here. Row may show a client-side `updated_at` and an optional completeness hint (out of scope for MVP). All row content is read-only on this screen.

## Components
| Component | Reuse / build | Renders here |
|---|---|---|
| `NavigationStack` root + `.navigationDestination(for: Route.self)` | reuse-existing (`RootView`) | hosts the list as the new stack root |
| List/card + section-header idiom from `DrugSelectionView` | reuse-existing (pattern) | vertical scroll of encounter cards |
| `EncounterRow` (summary card) | **build-new** | one case: patient name/registro, dx, `ASA` badge, date, chevron |
| Empty-state view | **build-new** | "No encounters yet" + primary "New Encounter" CTA |
| "New Encounter" button | **build-new** | toolbar/footer action → creates a case, pushes N2 |
| Loading / error state | **build-new** | spinner on first load; retry on fetch error (online-first, ADR-2) |
| `DesignSystem` tokens (`AppColors`, `Font`, `Spacing`, `Haptics`) | reuse-existing | all chrome/typography |

Note: N1 uses **none** of the seven [[ux-components]] data-entry widgets (§8) — those serve the capture screens (N2–N9). It is a read/navigate list, so it reuses the `DrugSelectionView` list idiom rather than a shared widget.

## Backend binding
Crosswalk mode in play: **`attribute`** only (root envelope summary), read-only on this screen — no `values_blob` / `table_cell` / `score_cell` / `series_point`.

- **On appear / pull-to-refresh:** `GET /api/v1/cases?limit=20&offset=0` ([[rest-contract]] §2.2, paged summary projection) → binds each item to a new **`CaseSummaryDTO`** (a subset of the root DTO).
- **"New Encounter" tap:** `POST /api/v1/cases` → `{ "id": "…" }` → `navigationPath.append(.encounterHub(id))` (into N2).
- **Swipe-to-delete (optional):** `DELETE /api/v1/cases/{id}` → drop the row on 200.

Primary endpoint example (list load):
```jsonc
GET /api/v1/cases?limit=20&offset=0
→ 200 OK
{
  "items": [
    {
      "id": "6f2a8c14-…",
      "fecha": "2026-07-05",
      "diagnostico_preop": "Colecistitis aguda",
      "asa": "II",
      "patient": { "nombre": "N. Pérez", "registro": "TU-2026-0481" },
      "updated_at": "2026-07-05T09:14:00Z"
    }
  ],
  "total": 37, "limit": 20, "offset": 0
}
```
`CaseSummaryDTO` binds `.convertFromSnakeCase` like the rest of the contract ([[rest-contract]] §3). Create returns just `{id}`; the full aggregate (`GET /cases/{id}`) is fetched by N2, not here.

## Reuses (existing app)
- **`DrugSelectionView`** list/card + section-header idiom ([[screens]] row 2); the empty **"Saved Simulations"** closure is the repurposed hook that this screen realizes.
- **`RootView`** `NavigationStack` + single `.navigationDestination(for: Route.self)` switch + the `Route` enum (`Hashable`) machinery ([[screens]] §"Adding a screen").
- **`AppState`** (`@MainActor @Observable`) single source of truth, `.environment(appState)` injection.
- **`DesignSystem`** tokens (`AppColors` / `Font` / `Spacing` / `Haptics`).

## To build (the gap)
| Item | Kind | Proposed path |
|---|---|---|
| `.encounterList` (new stack **root**) | route | `PharmaApp/App/Route.swift` |
| Re-root `RootView` (`.drugSelection` → `.encounterList`) + destination branch | other | `PharmaApp/App/RootView.swift` |
| `EncounterListView` | view | `PharmaApp/Views/Encounter/EncounterListView.swift` |
| `EncounterListViewModel` (`@MainActor @Observable`: fetch, list/empty/loading/error, create, delete) | viewmodel | `PharmaApp/Views/Encounter/EncounterListViewModel.swift` |
| `EncounterRow` summary card | component | `PharmaApp/Views/Encounter/EncounterRow.swift` |
| `AnesthesiaCase` + `CaseSummaryDTO` models (`Codable, Sendable`) | model | `PharmaApp/Models/AnesthesiaCase.swift` |
| `CaseStore` protocol + REST impl (ADR-2) — methods `listCases(limit:offset:) -> [CaseSummary]`, `createCase() -> CaseID`, `deleteCase(id:)` | casestore | `PharmaApp/Services/CaseStore.swift` |

## Dependencies
- **Prerequisite layer — persistence / `CaseStore` (ADR-2)** and its backend `GET /cases`, `POST /cases`, `DELETE /cases/{id}` ([[rest-contract]] §2.2). Today `AppState` holds a single in-memory live simulation and there is no case list to show ([[proposed-screens]] §6.1).
- **No upstream screen** — N1 *is* the new root. It **feeds** N2 (`.encounterHub(UUID)`), which must exist to receive the pushed id (the create/navigate target).
- Not dependent on schema bridge, fill-pdf, or derived-value hooks (those gate the capture/export screens, not this read list).

## Readiness
**blocked: persistence / CaseStore + `GET/POST /cases`.** The view, row, empty-state, and re-root are near-trivial and use known idioms, but there is literally nothing to list or create until the ADR-2 `CaseStore` port and the cases endpoints exist — the app has no persisted case model today.

## Open questions
- Once re-rooted, is `.drugSelection` reachable standalone at all, or only as a PK tool launched from inside an encounter (N5/N6)? The plan implies the latter — confirm the demotion.
- Does the `GET /cases` summary projection include the joined `patient` block (name/registro), or must the row show only root fields (dx/date/ASA)? Drives whether the list join happens server- or client-side.
- Online-first (ADR-2) with no network: show cached rows, an empty error state, or block? MVP behavior for the list needs a call.
- Sort/filter/search affordances for a long case list — deferred, or MVP?
