---
type: plan
updated: 2026-07-10
tags: [plan, screen, build-spec]
---

# N2 — Encounter Hub (build spec)

> The `AnesthesiaCase` root screen: collects the case envelope (Dx, ASA, RAQ, admin, firmas) and is the section-row hub that pushes into every sub-screen.

## Entities & data

- **Entity captured:** `AnesthesiaCase` (root, **cardinality 1** — one per case), role **collect**. Field load **≈49** (from [[field-inventory]] §2 *AnesthesiaCase*):

  | Control | Count | Component |
  |---|---:|---|
  | Short-text (admin, Dx, R.A.Q./ASA legends) | ≈26 | `FormTextRow` |
  | Single-select checkbox | ≈11 | `CheckboxGroupRow` |
  | Date / time | ≈6 | `DateTimePicker` |
  | Signature | ≈4 | `SignaturePad` |
  | Long-text / notes | ≈2 | `FormTextRow` (textarea) |

- **Schema sections:** `imss_p2` diagnostico / firmas / clasificacion; `nota21` header; `nota2` destination (`notebooks/forms/schema/imss_p2.schema.json`, `notebooks/forms/schema/nota21.schema.json`, `notebooks/forms/schema/nota2.schema.json`).
- **Also reads the whole aggregate** (`read-all`): the hub renders a **completion indicator per section row** (Patient done? Technique started?), derived from which children are populated in `GET /cases/{id}`.
- **Derived / read-only:** none on the root envelope itself. Patient biometrics (IMC / peso ideal / VSC) are `derived` but belong to screen 3′ ([[field-inventory]] §3), not here. Section-completion glyphs are UI-derived state, not a schema-derived value.

## Components

| Component | reuse / build | Renders here |
|---|---|---|
| Section-row hub list | **build-new** | tappable rows (Patient · Preanesthetic · Technique · Monitoring · Drug Ledger · Fluid Balance · Recovery · Newborn · Review) each pushing its `Route`, with a completion glyph |
| `CheckboxGroupRow` (single-select) | **build-new** (shared, [[proposed-screens]] §5 / [[ux-components]] §1) | ASA I–V, R.A.Q. 1–5, Urgencia/Electiva, destination URPA/UCI/Habitación |
| `DateTimePicker` | **build-new** (shared, [[ux-components]] §7) | Fecha / Turno timestamps |
| `SignaturePad` | **build-new** (shared, [[ux-components]] §6) | Anestesiólogo / Cirujano / Clave firmas |
| `FormTextRow` (short-text + textarea) | **build-new** | Dx preop/postop, Sala/Servicio, operación propuesta/realizada, observaciones/complicaciones |
| DesignSystem card + section-header | **reuse-existing** | card chrome + uppercase section headers around each envelope group |
| `NavigationStack` / `Route` / `NavigationPath` | **reuse-existing** | pushes into the sub-screens |

Note: short-text/textarea are **not** one of the seven formal shared widgets in [[ux-components]] §8 — `FormTextRow` is a thin new wrapper over a styled `TextField`/`TextEditor` reusing the `PatientInputView` card + section-header idiom.

## Backend binding

Two calls, both on the case root (crosswalk mode **`attribute`** throughout — every envelope field is a scalar path into the DTO; firmas and date/time are `attribute` too, reclassified UI-only per [[field-crosswalk]]; **no** `values_blob`/`table_cell`/`score_cell`/`series_point` on this screen):

- **Load** — `GET /api/v1/cases/{id}` on `.onAppear`: populates the envelope fields **and** the per-section completion glyphs (the full aggregate returns each populated child under its key).
- **Save** — `PATCH /api/v1/cases/{id}` on envelope edit / auto-save (ADR-2 online-first, auto-save on edit): partial root-envelope update (fecha, dx, ASA, RAQ, firmas, …). This is the "PATCH root envelope" from the assignment.

Binds the **AnesthesiaCase root DTO** ([[rest-contract]] §3). Primary endpoint example (adapted from [[rest-contract]] §5):

```jsonc
PATCH /api/v1/cases/6f2a.../
Content-Type: application/json
{
  "fecha": "2026-07-10T09:00:00",
  "tipo_admision": "electiva",
  "tipo": "II",
  "diagnostico_preop": "Colelitiasis",
  "diagnostico_postop": "Colelitiasis",
  "operacion_propuesta": "Colecistectomía laparoscópica",
  "asa": "II",
  "raq": 2,
  "providers": {
    "anestesiologo": { "nombre": "Dr. N. Ruiz", "cedula": "…", "clave": "A-14" },
    "cirujano":      { "nombre": "Dr. J. Soto" }
  }
}
```

Response `200` echoes the persisted envelope (no server-derived fields on the root, so nothing is stamped read-only here). `POST /cases` (case creation) belongs to **N1**, not this screen — the hub receives an existing `UUID`.

## Reuses (existing app)

- **DesignSystem tokens** — `AppColors` / `Font` / `Spacing` / `Haptics` (`PharmaApp/Utilities/DesignSystem.swift`).
- **`PatientInputView`** card + section-header pattern for the envelope groups.
- **`DrugSelectionView`** list idiom for the section-row hub.
- **`RootView`** `NavigationStack` + `Route` enum + `$navigationPath` threading (the [[screens]] "Adding a screen" checklist).
- **`AppState`** (`@MainActor @Observable`) + `.environment(...)` injection.
- **`SimulationViewModel`** `@MainActor @Observable` shape as the template for the new hub view-model.

## To build (the gap)

| Item | Kind | Proposed path |
|---|---|---|
| `.encounterHub(UUID)` (keep `Route` `Hashable`) + `navigationDestination` branch | route | `PharmaApp/App/Route.swift` (+ `RootView.swift`) |
| `EncounterHubView` | view | `PharmaApp/Views/Encounter/EncounterHubView.swift` |
| `EncounterHubViewModel` (load, envelope edits, section-completion derivation, auto-save) | viewmodel | `PharmaApp/Views/Encounter/EncounterHubViewModel.swift` |
| `AnesthesiaCase` root model (envelope + nested `providers`) + enums (ASA, RAQ, TipoAdmision) | model | `PharmaApp/Models/AnesthesiaCase.swift` |
| `CheckboxGroupRow` (single-select) | component | `PharmaApp/Views/Components/CheckboxGroupRow.swift` |
| `DateTimePicker` | component | `PharmaApp/Views/Components/DateTimePicker.swift` |
| `SignaturePad` | component | `PharmaApp/Views/Components/SignaturePad.swift` |
| `FormTextRow` (short-text + textarea) | component | `PharmaApp/Views/Components/FormTextRow.swift` |
| `SectionRow` (hub nav row + completion glyph) | component | `PharmaApp/Views/Encounter/SectionRow.swift` |
| `CaseStore` protocol + `loadCase(id:)` / `patchCaseEnvelope(id:_:)` (ADR-2 port) | casestore | `PharmaApp/Services/CaseStore.swift` |

## Dependencies

Prerequisite layers:
- **Persistence / `CaseStore`** ([[proposed-screens]] §6.1, ADR-2) — no case store exists today; the hub can't load/save without it.
- **Backend `GET`/`PATCH /cases/{id}`** ([[rest-contract]] §2.2) — the root aggregate + envelope endpoints.
- **Shared components** `CheckboxGroupRow`, `DateTimePicker`, `SignaturePad` ([[proposed-screens]] §5) — net-new, but well-specified in [[ux-components]].
- **`AnesthesiaCase` entity model** must slot into `PharmaApp/Models` (the app has `PatientProfile`/`DrugModel` only today).

Upstream screen:
- **N1 Encounter List** must exist first — it `POST`s a case and pushes `.encounterHub(id)` here. No PDF/`fill-pdf` or crosswalk dependency on this screen (those gate **N10** export, not envelope capture).

## Readiness

**blocked: persistence/CaseStore.** The view + all its widgets are fully specified and largely mechanical, but there is nothing to hub over until the `CaseStore` port + `GET`/`PATCH /cases/{id}` and the upstream N1 case-creation flow exist — the whole screen is predicated on an already-created, loadable/patchable case aggregate.

## Open questions

- **Sala/Servicio/Turno ownership overlap:** [[field-inventory]] §2 assigns Sala/Servicio/Turno/Fecha to the `AnesthesiaCase` root, but [[rest-contract]] §3 puts `sala`/`servicio`/`cama` on the **Patient** DTO. Which entity's `PATCH` owns them — does the hub edit them, or does the Patient screen (3′)?
- **Inline vs leaf envelope:** does the hub collect the root envelope (Dx/ASA/RAQ/firmas) **inline at the top**, or push it into a dedicated "Case details" leaf so the hub stays a pure section-row list? The nav sketch shows a pure list; the assignment says the hub collects the envelope.
- **Completion-glyph rule:** what marks a section row "done" — any-field-present vs a required-field set? Purely UI-derived, no schema source.
- **`Turno` type:** shift enum (`CheckboxGroupRow`) or a timestamp (`DateTimePicker`)?
