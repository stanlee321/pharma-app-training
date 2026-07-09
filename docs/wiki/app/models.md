---
type: page
updated: 2026-07-09
tags: [app]
---

# Domain Models

The value types that describe *what* is being simulated (drug + PK/PD model), *who* it is simulated on (patient), and the *shape of the data* passed across the engine boundary. All three files live in `PharmaApp/Models/` and are pure `Codable` / `Sendable` structs with no UI or engine dependencies. They are the vocabulary shared by [[state-navigation]], the [[engine]], and every simulation view ([[simulation-screen]], [[compartmental-screen]]).

Sources: `PharmaApp/Models/DrugModel.swift`, `PharmaApp/Models/PatientProfile.swift`, `PharmaApp/Models/SimulationTypes.swift`.

---

## DrugModel & DrugDatabase

`DrugModel` (`PharmaApp/Models/DrugModel.swift`) is a drug + PK/PD-model pairing — e.g. Propofol paired with the Marsh model. It is `Codable, Identifiable, Sendable`.

Key fields:

- `id: String` — a *display/identity* key like `"propofol_marsh"`. This is the SwiftUI `Identifiable` id (picker rows, `ForEach`), **not** the engine key.
- `rustModelId: String` — the *engine* key like `"marsh"`, `"schnider"`, `"minto"`, `"hannivoort"`. This is what actually gets handed to the PK engine. `PharmaApp/App/AppState.swift` passes `selectedDrug.rustModelId` (not `id`) into `PKEngineProtocol.simulate(modelId:...)` and `computeTCI(modelId:...)`. Confusing the two is the classic bug here: `id` selects the row, `rustModelId` selects the math.
- `concentrationUnit: ConcentrationUnit` — mcg/ml for propofol, ng/ml for the opioids/agonists; drives display formatting.
- `targetEffects: [String]` — e.g. `["Plasma", "Effect-site"]`; which targeting modes the model supports.
- `validationRules: ValidationRules` — the per-model patient bounds (see below).
- `defaultDilutionMgMl: Double`, `preparationRecipe`, `manualDosingRules`, `comments`, `publication` — clinical/reference metadata surfaced in the [[input-screens]].
- `pickerLabel: String` — computed `"\(drug) [\(model)]"`, e.g. `"Propofol [Marsh]"`, used as the human-readable picker title.

`DrugModel.Publication` is a nested `title` + optional `url`.

### Loading: `DrugDatabase.load()`

`DrugDatabase` (an `enum` used as a namespace) has one entry point, `load() -> [DrugModel]`:

1. Locate `drug_models` `.json` in `Bundle.main`. The file ships at `PharmaApp/Resources/drug_models.json`.
2. Decode with `JSONDecoder` where `keyDecodingStrategy = .convertFromSnakeCase`. The JSON uses snake_case keys (`rust_model_id`, `concentration_unit`, `default_dilution_mg_ml`, `validation_rules`, `target_effects`, `min_weight`, …) and the strategy maps them onto the camelCase Swift properties automatically — so the structs deliberately carry **no** `CodingKeys`. See [[parsing]] for the wider JSON-decoding conventions.
3. **Fallback to `DrugDatabase.hardcoded`** if the resource is missing *or* the file is present but fails to decode. Both failure paths (`guard` on URL/`Data`, and the `try?` on `decode`) resolve to the same in-code list, so the app can never launch with zero drugs.

> Gotcha — `.convertFromSnakeCase` only rewrites *keys*, never *values*. Enum raw values such as `"mcg/ml"` (`ConcentrationUnit`) and `"Plasma"`/`"Effect-site"` strings must already match exactly; they are not transformed.

### The hardcoded fallback

`DrugDatabase.hardcoded` is a static array of four fully-populated `DrugModel`s: `propofol_marsh` (rust `marsh`), `propofol_schnider` (rust `schnider`), `remifentanil_minto` (rust `minto`), `dexmedetomidine_hannivoort` (rust `hannivoort`). It mirrors the JSON row-for-row and exists "for development before JSON is finalized."

> Gotcha — the hardcoded list is not just a fallback; it is also the *live source* for validation. `MockPKEngine.validationRules(for:)` (`PharmaApp/Engine/MockPKEngine.swift`) looks the model up in `DrugDatabase.hardcoded` and matches on `rustModelId`, **regardless of what `load()` returned**. Meanwhile `AppState.drugModels` (`PharmaApp/App/AppState.swift`) is populated by `DrugDatabase.load()`. So the drug *list* can come from JSON while validation bounds always come from the hardcoded array — if the two ever diverge, the picker and the validator disagree.

---

## PatientProfile

`PatientProfile` (`PharmaApp/Models/PatientProfile.swift`) is a mutable `Codable, Sendable` struct capturing the patient covariates the PK models need:

- `weight: Double` (kg), `height: Double` (cm), `age: Double` (years)
- `gender: Gender` — nested `enum Gender: String { case male, female }`
- `dilution: Double` (mg/ml) — the drug concentration used for volume/rate conversions, seeded from the model's `defaultDilutionMgMl`.

### Lean body mass (James formula)

The one piece of logic in this file is the computed `leanBodyMass` (in an `extension`), the **James formula**, sex-specific on the weight/height ratio:

- male: `1.1 * weight − 128 * (weight/height)²`
- female: `1.07 * weight − 148 * (weight/height)²`

Per the doc comment it is "used by Schnider and Minto models" — the two models whose `validationRules` set `requiresHeight` and `requiresGender` true. It is consumed inside `MockPKEngine` (`PharmaApp/Engine/MockPKEngine.swift`, `let lbm = patient.leanBodyMass`) when building those models' parameters; the math itself is documented in [[pk-engine-math]]. Marsh and Hannivoort don't use LBM (they don't require height/gender), though the computed property still returns a value for any profile.

Two preview/testing fixtures live here: `PatientProfile.defaultMale` (70 kg / 170 cm / 40 / male) and `.defaultFemale` (60 kg / 160 cm / 50 / female), both at 10.0 mg/ml dilution. These seed SwiftUI previews and initial [[state-navigation]] state.

---

## SimulationTypes (the FFI contract)

`PharmaApp/Models/SimulationTypes.swift` is annotated *"mirrors Rust FFI contract"* — these are the exact structs marshalled to/from the PK engine. Every type is `Codable, Sendable` so it can cross actor/async boundaries (the engine is an `async` `Sendable` protocol). Because the current engine is a mock, "FFI contract" describes the *intended* Rust boundary, not a live one — see the drift note below.

| Type | Role | Notable fields |
|------|------|----------------|
| `CurvePoint` | One sample in the time series | `time` (seconds); `plasmaConcentration` / `effectConcentration` (display units); `amountV1/V2/V3` (mg in central / rapid- / slow-peripheral compartments); `infusionRate` (mg/min) |
| `SimulationOutput` | Full result of a `simulate(...)` run | `points: [CurvePoint]`; compartment volumes `v1Volume/v2Volume/v3Volume` (ml, for [[compartmental-screen]] animation sizing); rate constants `k10, k12, k21, k13, k31, ke0` (1/min, for particle-flow speed) |
| `TCIResult` | Answer to a single TCI query | bolus as `bolusMg` / `bolusMl` / `bolusMcgPerKg`; infusion as `infusionRateMgHr` / `infusionRateMlHr` / `infusionRateMcgKgHr` |
| `TargetEvent` | A user-set target at a moment in time | `time` (seconds from start); `concentration` (display units); `targetType` |
| `TargetType` | Targeting mode | `.plasma`, `.effectSite` |
| `ValidationRules` | Per-model patient bounds | `minWeight/maxWeight`, `minHeight/maxHeight`, `minAge/maxAge`, `requiresHeight`, `requiresGender` |
| `ConcentrationUnit` | Display unit | raw values `"mcg/ml"`, `"ng/ml"` |

These types are produced/consumed by `PKEngineProtocol` (`PharmaApp/Engine/PKEngineProtocol.swift`): `simulate(...) async -> SimulationOutput?`, `computeTCI(...) -> TCIResult?` (spec'd to return in <16 ms for 60 fps drag), `validationRules(for:) -> ValidationRules?`, and `availableModelIds`. The view models (`SimulationViewModel`, `CompartmentalViewModel`) and chart views (`ChartCanvas`, `DataTooltip`) read them downstream. See [[engine]] and [[architecture]].

> Note — `computeTCI` takes `currentState: [Double]` documented as `[x1, x2, x3, Ce]` amounts in mg; `SimulationOutput`'s per-`CurvePoint` `amountV1/V2/V3` are the corresponding compartment amounts, so a curve sample can be fed back in as engine state.

---

## Drift vs docs

- **The "Rust FFI contract" is aspirational.** `SimulationTypes` is written to mirror a Rust engine, but no Rust runs. `EngineProvider.useMock == true` (`PharmaApp/Engine/EngineProvider.swift`), so `EngineProvider` always returns `MockPKEngine`. `RustPKEngine` (`PharmaApp/Engine/RustPKEngine.swift`) is a stub whose every method is `fatalError("RustPKEngine not yet implemented. Use MockPKEngine.")`. Today these structs are filled in entirely by Swift mock code, not marshalled across any FFI. See [[engine]] and [[pk-engine-math]].
- **Validation source is the hardcoded array, not `load()`.** As above, `MockPKEngine.validationRules(for:)` resolves against `DrugDatabase.hardcoded` keyed by `rustModelId`, independent of the JSON that populates the picker. Treat `drug_models.json` and `DrugDatabase.hardcoded` as needing to be kept in sync by hand.
- **`id` vs `rustModelId`.** Any doc or call site that "passes the model id to the engine" must use `rustModelId`; `id` is only an `Identifiable`/display key.
