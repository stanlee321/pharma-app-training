---
type: plan
updated: 2026-07-10
tags: [plan, screen, build-spec]
---

# N8 — Recovery (Aldrete) (build spec)
> Capture one case's post-anesthetic recovery: the Aldrete 5-criteria × 6-time-point 0/1/2 score matrix with a live auto-summed TOTAL row, plus the nota2 término scales, into the `RecoveryScore` singleton.

## Entities & data
- **Entity:** `RecoveryScore` — **collect**, **1 per case** (singleton child of `AnesthesiaCase`; evaluated at several time points).
- **Field load** (from [[field-inventory]] §2, ≈48 fields):
  - Score-grid cells — **36** (imss_p1 Aldrete: 5 scored criteria `actividad_muscular`/`respiracion`/`circulacion`/`estado_conciencia`/`coloracion` + TOTAL row × 6 time-points `AL SALIR`/`0`/`20`/`60`/`90`/`120 min`)
  - Multi-select checkbox — **≈8** (nota2 reversal + emergence toggles)
  - Short-text / number scale — **≈4** (nota2 `aldrete`, `ramsay`, `bromage`, `ena` at término)
- **Schema sections:** imss_p1 `aldrete` `score` grid (36 cells); nota2 Aldrete/Ramsay/Bromage/ENA + reversal/emergence.
- **Derived / read-only:** the **TOTAL row** — `total[t] = Σ 5 criteria`, range **0–10** (`aldrete_total_c0..c5`), server-authoritative via `derive_service` ([[field-inventory]] §3) but computed **live client-side** by the widget for display; a partial column shows `—`, never a misleading sum. Never sent to (or trusted from) the client.

## Components
| Component | Reuse / build | Renders here |
|---|---|---|
| `ScoreGridWidget` | build-new ([[ux-components]] §3) | The 6×6 Aldrete matrix: sticky criterion labels, per-cell compact 0/1/2 segmented control, horizontal scroll over the 6 time-points, auto-summed read-only TOTAL row (greens at 10 via `AppColors.effect`). |
| `CheckboxGroupRow` | build-new (shared, [[ux-components]] §1) | The ≈8 reversal / emergence multi-select toggles; single-select Ramsay/Bromage bands if rendered as chips. |
| `StepperRow` | reuse-existing | The ≈4 numeric término scales (`aldrete`, `ramsay` 1–6, `bromage` 0–3, `ena` 0–10) as number entry. |
| `SignaturePad` | build-new (shared, [[ux-components]] §6) | `medico_responsable` attestation/signature at discharge. |
| `SimulationView` segmented host | reuse-existing | Idiom for the per-cell 3-way 0/1/2 segmented control (shrunk `SimulationView`/gender segmented). |
| `DesignSystem` tokens | reuse-existing | `Font.cellValue`/`numericValue` (grid + TOTAL), `AppColors.selectionTint`/`effect`/`surfaceDerived`, `Spacing.cell`, `Haptics`. |

## Backend binding
- **Load** — `GET /api/v1/cases/{id}/recovery-score` on `.onAppear` (singleton fetch via `CaseStore`, [[rest-contract]] §2.3).
- **Save** — `PUT /api/v1/cases/{id}/recovery-score` (idempotent upsert of the whole sub-form), fired debounced on every edit: a score-cell tap, a scale/toggle change, or the discharge signature. There is no per-cell endpoint — a cell mutates the `aldrete[criterion][time_point]` map in memory and the singleton `PUT` persists it. The response re-stamps the read-only `total` row.
- **DTO:** `RecoveryScore` ([[rest-contract]] §3) — `aldrete: { criterion: { time_point: 0|1|2 } }` (5×6); **readOnly** `total: { time_point: 0..10 }`; `otras_escalas{ramsay,bromage,ena}`, `alta_a_su_piso`, `medico_responsable`.
- **Crosswalk modes** ([[field-crosswalk]]): **`score_cell`** for the 36 Aldrete cells → `recovery_score.aldrete[criterion][time_point]` (primary); **`derived`** for the TOTAL row (`aldrete_total_c*`, readonly); **`attribute`** for `otras_escalas.*`, `alta_a_su_piso`, `medico_responsable`; the ≈8 nota2 emergence/reversal toggles land as `attribute` (or `values_blob` if left keyed by field id — see Open questions).

```json
PUT /api/v1/cases/6f2a.../recovery-score
{
  "aldrete": {
    "actividad_muscular": {"al_salir": 2, "0": 2, "20": 2, "60": 2, "90": null, "120": null},
    "respiracion":        {"al_salir": 1, "0": 2, "20": 2, "60": 2, "90": null, "120": null},
    "circulacion":        {"al_salir": 2, "0": 2, "20": 2, "60": 2, "90": null, "120": null},
    "estado_conciencia":  {"al_salir": 1, "0": 1, "20": 2, "60": 2, "90": null, "120": null},
    "coloracion":         {"al_salir": 1, "0": 2, "20": 2, "60": 2, "90": null, "120": null}
  },
  "otras_escalas": {"ramsay": 2, "bromage": 0, "ena": 1},
  "alta_a_su_piso": "URPA",
  "medico_responsable": {"attestation": "Dr. R. Gómez", "signed_at": "2026-07-10T10:14:00Z"}
}
```
Response (200) adds the server-computed read-only totals: `"total": {"al_salir": 7, "0": 9, "20": 10, "60": 10, "90": null, "120": null}`.

## Reuses (existing app)
- `StepperRow` (`PharmaApp/Utilities/StepperRow.swift`) — accelerating number entry for the término scales; its right-cluster monospaced `numericText` value is the model the `ScoreGridWidget` TOTAL cell mirrors.
- `SimulationView` segmented-control idiom ([[simulation-screen]]) — the per-cell 3-way 0/1/2 picker.
- `SimulationViewModel` `@MainActor @Observable` shape — template for `RecoveryScoreViewModel` (owns the auto-sum).
- `DesignSystem` tokens (`AppColors`, `Font`, `Spacing`, `Haptics`) — cell/TOTAL styling, `effect` = recovered-at-10 cue, tap feedback.
- `Route` + `RootView` `.navigationDestination(for: Route.self)` wiring ([[screens]] checklist); pushed from the Encounter Hub (N2).

## To build (the gap)
| Item | Kind | Proposed path |
|---|---|---|
| `Route.recoveryScore` case | route | `PharmaApp/App/Route.swift` |
| `.recoveryScore` destination branch | other | `PharmaApp/App/RootView.swift` |
| `RecoveryScoreView` | view | `PharmaApp/Views/Recovery/RecoveryScoreView.swift` |
| `RecoveryScoreViewModel` (auto-sum TOTAL, partial-column `—`) | viewmodel | `PharmaApp/Views/Recovery/RecoveryScoreViewModel.swift` |
| `ScoreGridWidget` (6×6 0/1/2 grid + auto-sum row) | component | `PharmaApp/Views/Components/ScoreGridWidget.swift` |
| `CheckboxGroupRow` (shared) | component | `PharmaApp/Views/Components/CheckboxGroupRow.swift` |
| `SignaturePad` (shared) | component | `PharmaApp/Views/Components/SignaturePad.swift` |
| `aldreteTotal(column:)` client derivation hook | derivation | `PharmaApp/Utilities/Derivations.swift` |
| `RecoveryScore` model (`Sendable`, `Codable`; nested aldrete map) | model | `PharmaApp/Models/RecoveryScore.swift` |
| `CaseStore.get/putRecoveryScore(caseID:)` | casestore | `PharmaApp/Engine/CaseStore.swift` |

## Dependencies
- **Persistence / `CaseStore`** (ADR-2) — no persistence exists today; the screen edits a case-scoped singleton and auto-saves through the `CaseStore` port.
- **Upstream Encounter/Case root** — N1 Encounter List + N2 Encounter Hub must create the `AnesthesiaCase` this record hangs off; N8 is pushed from the hub, not a stack root.
- **Backend** — `GET`/`PUT /cases/{id}/recovery-score` + `RecoveryScore` DTO ([[rest-contract]] §2.3/§3), and `derive_service` for the authoritative TOTAL row.
- **Derived-value hook** ([[proposed-screens]] §6.4) — the client-side Aldrete auto-sum for live feedback (mirrors the server's `aldrete_total`).
- **Shared components** — `ScoreGridWidget`, `CheckboxGroupRow`, `SignaturePad` ([[ux-components]] §3/§1/§6) built once.
- **Crosswalk** — `score_cell` + `derived` + `attribute` mappings ([[field-crosswalk]]); needed for export, not for capture.
- Not blocking: `fill-pdf` / PDFKit export layer is only needed by N10.

## Readiness
**blocked: persistence/CaseStore (ADR-2) + upstream Encounter root.** The `ScoreGridWidget` is fully specified ([[ux-components]] §3) and the segmented / stepper idioms are reusable, so the view + auto-sum are near-buildable — but a 1-per-case `RecoveryScore` has nothing to load, save, or scope to until the `CaseStore` port and an existing `AnesthesiaCase` (N1/N2) exist; the `RecoveryScore` model + backend endpoint are also net-new.

## Open questions
- **5 vs 6 grid rows:** imss_p1 lists 6 rows including `TOTAL`; confirm the 5 scored criteria are the editable set and TOTAL is the derived 6th (not entered).
- **Two-form reconciliation:** nota2 carries a **single** `aldrete` scalar (at término) while imss_p1 is the full 6×6 grid — same entity, two forms. Does the DTO's `otras_escalas`/`aldrete` scalar coexist with the `aldrete` matrix, and how is the nota2 single value derived from (or independent of) the grid?
- **Emergence/reversal toggles (≈8):** the `RecoveryScore` DTO ([[rest-contract]] §3) names only `ramsay`/`bromage`/`ena`/`alta_a_su_piso`/`medico_responsable` — where do the ≈8 nota2 toggles bind (new attributes vs `values_blob` keyed by field id)?
- **Time-point gating:** are all 6 columns always editable, or dimmed/progressively enabled as each recovery time is reached ([[ux-components]] §3 "future time-points dimmed")?
- **`medico_responsable`:** drawn signature (`SignaturePad`) vs typed name — the schema types it `text`; UI reclassification is proposed but not locked.
