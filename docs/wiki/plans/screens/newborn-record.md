---
type: plan
updated: 2026-07-10
tags: [plan, screen, build-spec]
---

# N9 — Newborn Record (build spec)
> A conditional, add-per-birth sheet that captures 0..n newborn records (sex, weight, height, Apgar) for obstetric cases only.

## Entities & data
- **Entity captured:** `NewbornRecord` — **0..n per case**, obstetric cases only (role: **collect**). One instance per birth; a multiple gestation adds more.
- **Field load** — schema-grounded core is tiny. [[field-inventory]] §2 ("NewbornRecord ≈3 fields") exposes only three, all typed `text`:

  | Control | Count |
  |---|---:|
  | Short-text (`RN Sexo`, `RN Peso`, `RN Talla`) | 3 |

  The **DTO** ([[rest-contract]] §3) carries more than the `imss_p2` schema prints — `apgar{min1,min5,min10}`, `expulsion_placenta`, `estado_general_al_salir`. Rendered as UI-reclassified controls (peso/talla → `StepperRow`; sexo → single-select), the working per-newborn surface is ≈8 controls. Only the 3 schema-backed ids have a bbox and export to `imss_p2` (see Open questions).
- **Schema section:** `imss_p2` `obstetricos` (`rn_sexo`, `rn_peso`, `rn_talla`, Apgar). Source form `imss_registro_anestesia`.
- **Derived / read-only shown here:** **none.** `NewbornRecord` has no computed fields ([[field-inventory]] §3 lists none for this entity) — no derive-service round-trip, no read-only stamping.

## Components

| Component | reuse / build | Renders here |
|---|---|---|
| `StepperRow` | **reuse-existing** | `RN Peso` (kg) and `RN Talla` (cm) number+unit steppers; the three Apgar scores (0–10 integer) |
| `CheckboxGroupRow` | **build-new** ([[ux-components]] §1) | `RN Sexo` single-select chips (M \| F) |
| `NewbornRecordSheet` | **build-new** | The single-newborn form body (card + section headers), presented as the sheet |
| `NewbornListView` | **build-new** | The collection host: list of saved newborns + "＋ Add newborn", swipe-to-delete; launches the sheet |
| add-row footer (`＋ Target` idiom) | **reuse-existing** | The "＋ Add newborn" affordance, mirroring `SimulationView`'s add-row |
| `DateTimePicker` | **build-new** ([[ux-components]] §7) | `expulsion_placenta` time chip (if modelled as a timestamp — see Open questions) |
| `DesignSystem` tokens | **reuse-existing** | `AppColors`/`Font`/`Spacing`/`Haptics`; `PatientInputView` card + section-header chrome |

## Backend binding
Collection CRUD sub-resource ([[rest-contract]] §2.3, NewbornRecord = **0..n per case**). All calls route through `CaseStore` (ADR-2), never `URLSession` directly.

- **On list/sheet open:** `GET /api/v1/cases/{id}/newborns` → `[NewbornRecord]` populates the list.
- **On "＋ Add newborn" save:** `POST /api/v1/cases/{id}/newborns` → returns the record with its server `id`.
- **On field edit within the sheet:** `PATCH /api/v1/cases/{id}/newborns/{nb_id}`.
- **On delete (swipe / ⊖):** `DELETE /api/v1/cases/{id}/newborns/{nb_id}`.
- **DTO bound:** `NewbornRecord` ([[rest-contract]] §3) — `id, expulsion_placenta, sexo, peso: Quantity{value,unit}, talla: Quantity{value,unit}, apgar{min1,min5,min10}, estado_general_al_salir`. No `readOnly` attributes.

**Crosswalk mode** ([[field-crosswalk]]): plain **`attribute`** for every field — `rn_sexo → newborn_record.sexo`, `rn_peso → newborn_record.peso`, `rn_talla → newborn_record.talla`. `NewbornRecord` is one of the curated structured entities (crosswalk build step 3); no `values_blob`, `table_cell`, `score_cell`, or `derived` modes apply.

Primary endpoint payload example:

```json
POST /api/v1/cases/6f2a3d.../newborns
Content-Type: application/json

{
  "sexo": "M",
  "peso": { "value": 3.25, "unit": "kg" },
  "talla": { "value": 50, "unit": "cm" },
  "apgar": { "min1": 8, "min5": 9, "min10": 10 },
  "expulsion_placenta": "espontánea",
  "estado_general_al_salir": "vigoroso"
}
```
Response (200/201) echoes the stored record with a server `id`. No derived fields to stamp.

## Reuses (existing app)
- **`StepperRow`** (`PharmaApp/Utilities/StepperRow.swift`) — number+unit accelerating steppers for peso/talla and the Apgar integers.
- **`PatientInputView`** card + section-header idiom (`PharmaApp/Views/PatientInput/PatientInputView.swift`) — the sheet's visual chrome and the `genderButton` single-select treatment `CheckboxGroupRow` generalises.
- **`SimulationView`** "＋ Target" add-row idiom for the "＋ Add newborn" footer.
- **`DesignSystem`** tokens (`AppColors`, `Font`, `Spacing`, `Haptics`) — no ad-hoc colors/fonts.
- **`CaseStore`** protocol seam (ADR-2) — same port the other collect screens depend on (does not yet exist; see Dependencies).

## To build (the gap)

| Item | Kind | Proposed path |
|---|---|---|
| `.newbornRecord` case (keep `Hashable`) | route | `PharmaApp/App/Route.swift` |
| `NewbornListView` (collection host + add / swipe-delete; presents the sheet) | view | `PharmaApp/Views/Newborn/NewbornListView.swift` |
| `NewbornRecordSheet` (single-newborn form) | view | `PharmaApp/Views/Newborn/NewbornRecordSheet.swift` |
| `NewbornRecordViewModel` (`@MainActor @Observable`; owns the 0..n CRUD list state) | viewmodel | `PharmaApp/Views/Newborn/NewbornRecordViewModel.swift` |
| `CheckboxGroupRow` (shared single-select; also serves N2–N8) | component | `PharmaApp/Views/Components/CheckboxGroupRow.swift` |
| `DateTimePicker` (shared; if `expulsion_placenta` is a timestamp) | component | `PharmaApp/Views/Components/DateTimePicker.swift` |
| `NewbornRecord` (`Codable`, `Sendable`) DTO | model | `PharmaApp/Models/NewbornRecord.swift` |
| `CaseStore.fetchNewborns / addNewborn / updateNewborn / deleteNewborn` | casestore | `PharmaApp/Services/CaseStore.swift` |
| `RootView` navigation / sheet presentation branch for `.newbornRecord` | other | `PharmaApp/App/RootView.swift` |

## Dependencies
- **Persistence / `CaseStore`** (ADR-2, prereq layer §6.1) — the collection CRUD (`POST`/`PATCH`/`DELETE` many-per-case) needs a persisted, case-scoped store; none exists today.
- **A Case must exist** — upstream N1 Encounter List → N2 Encounter Hub create the `AnesthesiaCase` this record hangs off, and the Hub is where the newborn sub-form is conditionally revealed.
- **Obstetric gate** — the sheet is shown only for obstetric cases; needs a flag/branch on `AnesthesiaCase` to decide visibility (see Open questions).
- **Shared `CheckboxGroupRow`** (and optionally `DateTimePicker`) from the [[ux-components]] library — small, but net-new.
- **No PK engine, no derived-value hooks, no crosswalk/fill-pdf** are required for *capture*; crosswalk/fill-pdf matter only for the N10 export path.

## Readiness
**Blocked: persistence / `CaseStore` (ADR-2).** This is one of the simplest screens — ≈8 controls, peso/talla/Apgar reuse the existing `StepperRow`, and only `CheckboxGroupRow` is net-new UI. But it is a *0..n collection* that cannot save without the `CaseStore` layer, and it has nowhere to launch from until N1/N2 (Encounter root) exist. Once those land, only the view + sheet wiring + `CheckboxGroupRow` remain.

## Open questions
- **Schema vs DTO gap:** `apgar`, `expulsion_placenta`, `estado_general_al_salir` appear in the [[rest-contract]] §3 DTO but **not** in the `imss_p2` `obstetricos` schema ([[field-inventory]] §2 exposes only `rn_sexo`/`rn_peso`/`rn_talla`). Do we capture them (persisted but with no bbox → they will **not** export to `imss_p2`), or trim the screen to the 3 schema-backed fields?
- **Obstetric flag:** what marks a case "obstetric" so the sub-form is conditionally shown — an explicit `AnesthesiaCase` toggle, a diagnosis/procedure inference, or a manual "Add newborn" the clinician opts into?
- **Presentation idiom:** true SwiftUI `.sheet` vs the app's only-existing `.overlay` pattern (Launch Modal); `[[proposed-screens]]` §3 says "sheet / overlay" without committing.
- **Units:** `peso` (kg vs g) and `talla` (cm vs mt) — the schema leaves units unspecified; `StepperRow` needs a concrete unit + step.
