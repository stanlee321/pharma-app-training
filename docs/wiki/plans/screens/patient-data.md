---
type: plan
updated: 2026-07-10
tags: [plan, screen, build-spec]
---

# 3′ — Patient Data (extend existing) (build spec)

> Extend the existing global `PatientInputView` into a **case-scoped** Patient capture screen that also collects somatometría / Hb-Hto-Rh / grupo, and shows live-derived IMC · peso ideal · VSC — while `weight/height/age/sex` stays the PK engine's `PatientProfile`.

## Entities & data

- **Entity captured:** `Patient` — cardinality **1 per case**, role **collect** ([[rest-contract]] §2.3 singleton `GET`/`PUT /cases/{id}/patient`).
- **Field load (from [[field-inventory]] §2 "Patient — ≈32 fields"):**
  - Short-text ≈ **23** (`registro`, `nombre`, `edad`, `sexo`, `grupo_sanguineo`, `rh`, `sala`, `servicio`, `cama`, …)
  - Number + unit ≈ **9** (`peso` [kg], `talla` [cm/mt], `hb`, `hto`, …)
  - **Schema sources:** `imss_p1` `datos` (`notebooks/forms/schema/imss_p1.schema.json`) + `nota21` somatometría (`notebooks/forms/schema/nota21.schema.json`).
- **Derived / read-only shown here (never collected — [[field-inventory]] §3):** `IMC` (kg/m²), `Peso ideal` (kg), `VSC` (ml) + `25% del VSC`, `15% del VSC`, all computed from `peso`/`talla`(+`edad`/`sexo`). Rendered read-only (`surfaceDerived` token, lock glyph). Client-computes for live feedback; server also stamps them on the `PUT` response (`imc`, `peso_ideal`, `vsc` — [[rest-contract]] §5).
- **The seam:** `weight/height/age/sex` **is** `PatientProfile` — capturing Patient once parameterises every downstream TCI recommendation ([[field-inventory]] §3, ADR-5).

## Components

| Component | reuse / build | Renders here |
|---|---|---|
| `PatientInputView` scaffold (card + section-header) | **reuse-existing** | screen host; existing weight/height/age steppers + gender segmented stay |
| `StepperRow` (number+unit accelerating stepper) | **reuse-existing** | `peso` [kg], `talla` [cm], `edad` [yr], plus new numeric `hb`, `hto` |
| `genderButton` segmented | **reuse-existing** | `sexo` M/F single-select |
| `AcceleratingRepeatButton` | **build-new** | extracted from `StepperRow` ([[ux-components]] §0.1) so peso/talla/edad finally get hold-to-accel + per-step haptics (audit: today accel is wired only to dilution) |
| `CheckboxGroupRow` (single-select) | **build-new** | `grupo_sanguineo` (A/B/AB/O) and `rh` (+/−) chip groups ([[ux-components]] §1, [[proposed-screens]] §5) |
| `TextFieldRow` | **build-new** | short-text write-ins `registro`, `nombre`, `sala`, `servicio`, `cama` |
| `DerivedBiometricsCard` (read-only) | **build-new** | IMC · peso ideal · VSC · 25%/15% VSC, live-recomputed on any peso/talla edit; `surfaceDerived` + lock glyph |

## Backend binding

Access goes through the `CaseStore` port (ADR-2), never `URLSession` directly.

- **Load — `GET /api/v1/cases/{id}/patient`** on `onAppear`; binds `PatientDTO` (incl. server-stamped read-only `imc`/`peso_ideal`/`vsc`) into the view model.
- **Save — `PUT /api/v1/cases/{id}/patient`** — idempotent full upsert; fires on **edit auto-save** (online-first, ADR-2) and on **Done**. Response re-stamps the derived biometrics.
- **Crosswalk modes ([[field-crosswalk]]):** almost all fields are `attribute` (`patient.edad`, `patient.sexo`, `patient.peso`, `patient.grupo_sanguineo`, …); `imc`/`peso_ideal`/`vsc` are `derived` + `readonly: true` (rejected if sent by client).

Primary endpoint payload (adapted from [[rest-contract]] §5):

```json
PUT /api/v1/cases/6f2a.../patient
{
  "registro": "TU-2026-0481",
  "nombre":   "N. Pérez",
  "edad":     54,
  "sexo":     "F",
  "peso":     72.0,
  "talla":    161.0,
  "hb": 13.2, "hto": 39.6, "rh": "+", "grupo_sanguineo": "O",
  "sala": "Q3", "servicio": "Cirugía General", "cama": "204"
}
```

Response adds the server-derived read-only block: `"imc": 27.8, "peso_ideal": 56.4, "vsc": 5040`.

## Reuses (existing app)

- **`PatientInputView`** — card chrome, section-header pattern, and the working `weight/height/age` steppers + `genderButton` gender segmented ([[proposed-screens]] row 3′).
- **`StepperRow`** number+unit accelerating stepper (`$state.patient.*` binding idiom).
- **`PatientProfile`** model — already holds `weight/height/age/sex` and computes **LBM**; extend it with the new IMC/peso-ideal/VSC derivations rather than adding a parallel type ([[field-inventory]] §3, [[proposed-screens]] §6.4).
- **`.patientInput` `Route` case** + its existing `RootView` `.navigationDestination` branch (screen already exists — pushed presentation).
- **`DesignSystem` tokens** — `AppColors`, `Font`, `Spacing`, `Haptics` (plus the semantic `surfaceDerived`/`selectionTint`/`fieldFill` tokens introduced in [[ux-components]] §0.2).
- **`MockPKEngine` / `DrugModel`** — unchanged, but this screen's `PatientProfile` output is their covariate source downstream.

## To build (the gap)

| Item | Kind | Proposed path |
|---|---|---|
| `.patientInput` becomes **case-scoped** (read active case from `AppState.currentCase` / associated id) | route | `PharmaApp/App/Route.swift` |
| Extend `PatientInputView` — new fields + case-scoped binding + derived card | view | `PharmaApp/Views/PatientInput/PatientInputView.swift` |
| `PatientInputViewModel` — case-scoped patient, live derivations, `CaseStore` save | viewmodel | `PharmaApp/Views/PatientInput/PatientInputViewModel.swift` |
| `AcceleratingRepeatButton` (extract from `StepperRow`) | component | `PharmaApp/Utilities/AcceleratingRepeatButton.swift` |
| `CheckboxGroupRow` (grupo sanguíneo, Rh single-selects) | component | `PharmaApp/Views/Components/CheckboxGroupRow.swift` |
| `TextFieldRow` (registro, nombre, sala, servicio, cama) | component | `PharmaApp/Views/Components/TextFieldRow.swift` |
| `DerivedBiometricsCard` (IMC · peso ideal · VSC · 25/15% VSC read-only) | component | `PharmaApp/Views/PatientInput/DerivedBiometricsCard.swift` |
| `PatientDTO` `Codable` (snake_case, readOnly derived block) | model | `PharmaApp/Models/DTO/PatientDTO.swift` |
| Patient biometric derivations (IMC, peso ideal, VSC, 25/15%) | derivation | `PharmaApp/Models/PatientProfile.swift` (extend) |
| `CaseStore.getPatient(caseID)` / `putPatient(caseID:_)` | casestore | `PharmaApp/Persistence/CaseStore.swift` |

## Dependencies

- **Persistence / `CaseStore` (ADR-2)** — no persistence exists today; the case-scoped `getPatient`/`putPatient` port is a hard prerequisite for the defining "case-scoped not global" change.
- **Upstream Encounter** — an `AnesthesiaCase` must exist first: **N1 Encounter List** → **N2 Encounter Hub** create/select the case whose id scopes this screen ([[proposed-screens]] §2).
- **Derived-value hooks (§6.4)** — the IMC/peso-ideal/VSC math extends the existing `PatientProfile` LBM computation.
- **Backend `GET`/`PUT /cases/{id}/patient`** — needed for real save, but abstracted behind `CaseStore` (an in-memory impl can unblock the UI). Schema bridge / [[field-crosswalk]] is an **export-only** (N10) concern — **not** a blocker for capture here.

## Readiness

**blocked: persistence/CaseStore (ADR-2) + upstream Encounter (N1/N2).** The pure-UI extension (new fields, `CheckboxGroupRow`/`TextFieldRow`, `DerivedBiometricsCard`, IMC/peso-ideal/VSC derivations) is near-ready and buildable against today's global `AppState.patient`; but the screen's stated purpose — becoming **case-scoped** — cannot land until the `CaseStore` port and an existing `AnesthesiaCase` root are in place.

## Open questions

- **`sala`/`servicio`/`cama` overlap:** `PatientDTO` ([[rest-contract]] §3) and the `AnesthesiaCase` root both carry Sala/Servicio — which entity owns them so the value isn't captured twice?
- **Hb/Hto/Rh/grupo placement:** [[field-inventory]] §2 assigns them to `Patient`, but the wider lab panel lives in `PreanestheticAssessment` (N3) — collect on 3′ or defer to N3?
- **Derived authority:** compute IMC/peso-ideal/VSC **client-side** for live feedback (mirroring TCI ADR-5) vs rely on the server-stamped `PUT` response — reconcile which is authoritative.
- **`sexo` control:** keep the existing `genderButton` segmented, or migrate it to `CheckboxGroupRow` for consistency with grupo/Rh?
