---
type: plan
updated: 2026-07-10
tags: [plan, screen, build-spec]
---

# N10 — Review & Export (build spec)

> The terminal screen of an encounter: read the whole persisted case back, pick a target form, and get a **filled, print-faithful PDF** rendered server-side from the same data — "collect once, export to many".

## Entities & data

- **Reads ALL nine entities of the case** (read-only; captures nothing): `anesthesia_case` (root) + `patient`, `preanesthetic_assessment`, `anesthetic_technique`, `transanesthetic_record`, `drug_administration[]`, `fluid_balance`, `recovery_score`, `newborn_record[]`. Cardinality here is **read-all of one case aggregate**.
- **Field load: 0 input fields.** This is the only screen in the set that binds no capture controls. It instead **binds onto any of the 4 schemas** and drives `fill-pdf` server-side, so its "load" is the *export surface* over the full ~471-field union across all four forms (see [[field-inventory]] §1) — never re-rendered as controls, only projected into the PDF.
- **Schema sections:** all `major_sections` + `subsections` of all four forms (`nota_postanestesica`, `registro_transanestesico`, `imss_valoracion_preanestesica`, `imss_registro_anestesia`).
- **Derived / read-only values it surfaces** (server-computed via `derive_service`, never collected): patient biometrics `imc` / `peso_ideal` / `vsc` / `25%VSC` / `15%VSC`, Aldrete column totals (0–10), fluid `Balance parcial/total` / `Gasto urinario` / `Tasa Fentanilo`, and the client-side TCI `recommended` dose ([[field-inventory]] §3, [[decisions]] ADR-5). A brief per-entity **completeness summary** (filled / required-but-empty) is shown before export.

## Components

| Component | reuse / new | What it renders here |
|---|---|---|
| `PDFPreviewView` (PDFKit `PDFView`) | **build-new** | the returned `application/pdf` bytes, scrollable/zoomable |
| Form selector (which of 4 forms) | **build-new** (may reuse `CheckboxGroupRow` single-select from [[ux-components]] §1) | radio-style pick of the forms this case participates in |
| `CaseCompletenessSummary` rows | **build-new** | per-entity filled/missing status + required-but-empty warnings |
| `ShareLink` (save / print / AirDrop) | reuse-existing (SwiftUI native) | exports/shares the rendered PDF |
| `ProgressView` spinner | reuse-existing (SwiftUI native) | sync export wait ([[decisions]] ADR-4) |
| Section-row list idiom (`DrugSelectionView`) | reuse-existing | the review summary list chrome |
| `DesignSystem` tokens (`AppColors`/`Font`/`Spacing`/`Haptics`) | reuse-existing | styling; `invalidTint` for missing-required warnings |

No capture widgets from [[ux-components]] §8 apply — N10 is read-only; it consumes the *result* of those widgets' collection.

## Backend binding

Two calls, both through the `CaseStore` port ([[decisions]] ADR-2) — never `URLSession` directly:

- **On appear** — `GET /api/v1/cases/{id}` → full aggregate (root envelope + every populated child + server-computed read-only fields). Binds the read-only **`CaseAggregate`** DTO ([[rest-contract]] §3) to drive the completeness summary.
- **On Export / form pick** — `POST /api/v1/cases/{id}/export/{form_id}` with `Accept: application/pdf` → `200 application/pdf` (synchronous, [[decisions]] ADR-4). Optional small JSON body selects derived cells + time-points. The response is **binary PDF**, not a DTO.

Primary endpoint (export), `form_id` ∈ the 4 emitted ids:

```
POST /api/v1/cases/6f2a.../export/nota_postanestesica
Accept: application/pdf
Content-Type: application/json

{ "include_derived": true, "time_points": ["0", "20", "60"] }
→ 200 OK
  Content-Type: application/pdf
  Content-Disposition: attachment; filename="nota_postanestesica_6f2a.pdf"
  <binary: 1:1 clone + fill-pdf value pass drawn into each field bbox>
```

**Crosswalk modes in play (server-side, app never sees them — [[field-crosswalk]], ADR-1/ADR-6):** because a whole case exports to a whole form, **all six modes** participate at fill time — `attribute` (patient scalars), `values_blob` (the ~185-field technique), `table_cell` (`control_fluidos`/`farmaco`), `score_cell` (Aldrete 36), `series_point` (`vitals_grid`), and `derived` (IMC/VSC/Aldrete totals/fluid balances). The app just POSTs the case id + form id.

## Reuses (existing app)

- `DesignSystem` tokens (`AppColors`, `Font`, `Spacing`, `Haptics`) for all chrome.
- The section-row list idiom from `DrugSelectionView` for the review summary.
- SwiftUI **`ShareLink`** + `ProgressView` (native — no new dep for share/print/spinner).
- `AppState` + the `CaseStore` port (ADR-2) for the aggregate load — same seam every other new screen uses.
- Note: TCI `recommended` shown in the summary is computed client-side by the existing PK engine (`MockPKEngine.computeTCI`, ADR-5) — reused, not re-fetched.

## To build (the gap)

| Item | Kind | Proposed path |
|---|---|---|
| `.reviewExport` case (keep `Hashable`) | route | `PharmaApp/App/Route.swift` |
| `navigationDestination` branch | other | `PharmaApp/App/RootView.swift` |
| `ReviewExportView` | view | `PharmaApp/Views/Review/ReviewExportView.swift` |
| `ReviewExportViewModel` (`@MainActor @Observable`: form selection, export state, PDF `Data`, spinner) | viewmodel | `PharmaApp/Views/Review/ReviewExportViewModel.swift` |
| `PDFPreviewView` (PDFKit `UIViewRepresentable`) | component | `PharmaApp/Views/Review/PDFPreviewView.swift` |
| `FormSelectorRow` (pick 1 of 4 forms) | component | `PharmaApp/Views/Review/FormSelectorRow.swift` |
| `CaseCompletenessSummary` | component | `PharmaApp/Views/Review/CaseCompletenessSummary.swift` |
| `CaseStore.loadCase(id:) -> CaseAggregate` | casestore | `PharmaApp/Data/CaseStore.swift` |
| `CaseStore.exportForm(caseId:formId:options:) async throws -> Data` | casestore | `PharmaApp/Data/CaseStore.swift` |

## Dependencies

- **Prerequisite layers:** persistence / `CaseStore` (ADR-2); a new **in-app PDFKit layer** (none today); the server **fill-pdf value pass** ([[rest-contract]] §2.4 — *planned, not built*); the **[[field-crosswalk]]** artifact (ADR-6 — *not built*) that fill-pdf keys off; `derive_service` for the read-only cells.
- **Upstream screens:** a populated **`AnesthesiaCase`** must already exist — N1 (Encounter List) / N2 (Encounter Hub) plus at least the entity screens feeding the chosen form. N10 is the tail of the flow, not reachable cold.

## Readiness

**blocked: server fill-pdf value pass + field-crosswalk.** The in-app half (view, PDFKit preview, form picker, `ShareLink`, wiring) is near-ready and depends only on `CaseStore`; but the *payoff* — a filled PDF — cannot be produced until the crosswalk ([[field-crosswalk]], ADR-6) and the fill-pdf pass ([[rest-contract]] §2.4) exist server-side. Until then `POST …/export/…` returns only the blank 1:1 clone.

## Open questions

- Which forms are offered per case — always all 4, or gated by which entities are populated (e.g. `newborn_record` / obstetric → IMSS set only)?
- Does the completeness summary **block** export on required-but-empty fields, or only warn?
- Keep sync ([[decisions]] ADR-4) or add the `202 + poll` path if fill-pdf latency grows once the value pass is real?
- Cache the returned PDF per `form_id`, or re-`POST` on every form switch?
- Offer a **batch** "export all applicable forms" action, given "collect once, export to many"?
