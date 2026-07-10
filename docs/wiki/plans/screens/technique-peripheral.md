---
type: plan
updated: 2026-07-10
tags: [plan, screen, build-spec]
---

# N4c — Technique — Peripheral Block (build spec)
> Capture the peripheral / plexus nerve-block modality of `AnestheticTechnique` (nota2 *Bloqueo Periférico*, 21 fields) as an editable per-nerve row table, persisted into the one shared technique singleton.

## Entities & data
- **Entity:** `AnestheticTechnique` — **peripheral branch only** · cardinality **1 per case** (singleton) · role **collect**.
- **Field load (~21):** the nota2 *Bloqueo Periférico* `major_section` — all flat (`nota2` has 0 tables/0 charts). Approx control mix (subset of the ≈185-field `AnestheticTechnique` in [[field-inventory]] §2):
  - **checkbox** ≈12 — plexus/nerve selection (braquial interescalénico/supraclavicular/axilar, femoral, ciático…), guidance (ultrasonido / neuroestimulación), approach, needle family.
  - **checkbox_value** ≈6 — local anaesthetic + dose (Lidocaína / Bupivacaína / Ropivacaína ☐ __ mg), volume ☐ __ ml.
  - **short-text** ≈2 · **number+unit** ≈1.
- **Schema section:** `nota2` → *Bloqueo Periférico*. Field ids are carried as a `values_blob` — the id **is** the key (see Backend binding).
- **Derived / read-only shown:** none. Peripheral local anaesthetics are not TCI-modelled drugs, so there is **no** recommended-dose read-back on this screen (contrast N6). Nothing on this screen is server-computed.

## Components
| Component | reuse / build | Renders here |
|---|---|---|
| `CheckboxGroupRow` (single + multi) | build-new (shared, also N4a/N4b) | plexus/nerve pick (single), guidance + approach (multi), needle family |
| `CheckboxValueRow` (toggle + value + unit) | build-new (shared, also N4a/N4b) | per-row local anaesthetic ☐ + dose `mg` / volume `ml` |
| `NerveBlockTable` (add-row) | build-new (this screen) | the editable per-nerve list; "+ Add block" footer, swipe-to-delete — reuses the `EditableDrugTable` / `+ Target` add-row idiom |
| `AcceleratingRepeatButton` | build-new (extracted from `StepperRow`) | ± on dose/volume steppers inside each row |
| `DesignSystem` tokens (`AppColors`/`Font`/`Spacing`/`Haptics`) | reuse-existing | card chrome, `selectionTint`/`fieldFill` chips, `Font.cellValue`, haptics |

Pulled from [[ux-components]] §1/§2/§5/§8 and [[proposed-screens]] §5. This screen needs **no** segmented host (that is N4a); it is one flat section rendered as a growable table.

## Backend binding
- **Load** — `GET /api/v1/cases/{id}/anesthetic-technique` on screen appear; hydrate the `peripheral_block[]` branch + the `values{}` blob into the VM.
- **Save** — `PUT /api/v1/cases/{id}/anesthetic-technique` (singleton **create-or-replace**), fired on autosave-per-edit (ADR-2 online-first) and on Done. **Merge caveat:** N4a/N4b/N4c all target this **same singleton**, so the write must merge peripheral edits into the in-memory `AnestheticTechnique` (General + Neuraxial branches + their `values`) held by `CaseStore` and PUT the **whole** object — a naive PUT of only peripheral fields clobbers the other two sub-screens.
- **No drag hotpath** (no chart/target on this screen).
- **DTO:** `AnestheticTechnique` — tagged union on `modality`; this screen writes the `peripheral_block[...]` branch and merges the 21 field ids into `values: { field_id: bool | Quantity | string }`.
- **Crosswalk mode:** `values_blob` for every *Bloqueo Periférico* id (`anesthetic_technique.values["<field_id>"]`, [[field-crosswalk]]) — so no bespoke per-checkbox DTO. Validated server-side against the `nota2` field defs. See [[rest-contract]] §2.3/§3.

Primary endpoint payload (`PUT …/anesthetic-technique`):
```json
{
  "modality": "BEPD",
  "peripheral_block": [
    {
      "nerve": "Plexo braquial (interescalénico)",
      "guidance": ["ultrasonido", "neuroestimulacion"],
      "needle": "Stimuplex 22G",
      "drug": "Ropivacaína",
      "dose":   { "value": 150, "unit": "mg" },
      "volume": { "value": 20,  "unit": "ml" },
      "catheter": false
    }
  ],
  "values": {
    "bloqueo_plexo_braquial": true,
    "guia_ultrasonido": true,
    "guia_neuroestimulacion": true,
    "ropivacaina_bp": true,
    "ropivacaina_bp_dosis": 150,
    "volumen_bp": 20
  }
}
```
(The `general` / `regional_neuraxial` branches are carried unchanged from the merged in-memory singleton; elided here for brevity.)

## Reuses (existing app)
- **`DesignSystem`** tokens (`AppColors`, `Font`, `Spacing`, `Haptics`) — the only genuinely-existing dependency this screen leans on.
- **`StepperRow`** — source of the extracted `AcceleratingRepeatButton` for dose/volume ±.
- **`PatientInputView`** card + uppercase section-header idiom for row/section chrome.
- **`SimulationView`** `+ Target` add-row idiom → the `NerveBlockTable` "+ Add block" footer.
- **`RootView` NavigationStack + `Route`** push pattern ([[screens]] "Adding a screen" checklist).
- No engine reuse (`DrugModel`/`MockPKEngine` not applicable — non-TCI drugs).

## To build (the gap)
| Item | Kind | Proposed path |
|---|---|---|
| `Route.technique(TechniqueZone)` case + `TechniqueZone{.general,.neuraxial,.peripheral}` (shared w/ N4a/N4b) | route | `PharmaApp/App/Route.swift` |
| `RootView` `.navigationDestination` branch for `.technique(.peripheral)` | route | `PharmaApp/App/RootView.swift` |
| `TechniquePeripheralView` | view | `PharmaApp/Views/Technique/TechniquePeripheralView.swift` |
| `TechniquePeripheralViewModel` (owns the add-row rows + merge-into-singleton) | viewmodel | `PharmaApp/Views/Technique/TechniquePeripheralViewModel.swift` |
| `NerveBlockTable` (add-row per-nerve table) | component | `PharmaApp/Views/Components/NerveBlockTable.swift` |
| `CheckboxGroupRow` (shared) | component | `PharmaApp/Views/Components/CheckboxGroupRow.swift` |
| `CheckboxValueRow` (shared) | component | `PharmaApp/Views/Components/CheckboxValueRow.swift` |
| `AcceleratingRepeatButton` (extract from `StepperRow`) | component | `PharmaApp/Views/Components/AcceleratingRepeatButton.swift` |
| `AnestheticTechnique` model (Sendable/Codable, tagged union + `values` map + `PeripheralBlockRow`) (shared) | model | `PharmaApp/Models/AnestheticTechnique.swift` |
| `CaseStore.technique(for:)` GET + `CaseStore.saveTechnique(_:for:)` PUT (merge-safe) | casestore | `PharmaApp/Services/CaseStore.swift` |

## Dependencies
Prerequisite layers (all absent today — [[proposed-screens]] §6):
1. **Persistence / `CaseStore`** (ADR-2) — the singleton GET/PUT + merged in-memory `AnestheticTechnique`.
2. **Schema field catalogue** for the 21 *Bloqueo Periférico* ids (ADR-1 nuance) — the app iterates the section's field list rather than hand-coding ids; bundled or fetched once.
3. **`field-crosswalk`** `values_blob` mapping — needed for the PDF export (N10), **not** for capture.
Upstream screens/artifacts:
- **Encounter Hub (N2)** + a live `AnesthesiaCase` must exist to scope the case id.
- **Shared with N4a/N4b:** the `AnestheticTechnique` model, `TechniqueZone` route, and `CheckboxGroupRow`/`CheckboxValueRow` — build once across the three sub-screens.

## Readiness
**blocked: persistence/CaseStore + shared `AnestheticTechnique` model & checkbox components.** The view + wiring are small and mechanical, but there is no case store, no technique model, and the two shared checkbox widgets do not exist yet; none can be stubbed without the singleton GET/PUT.

## Open questions
- The `nota2` *Bloqueo Periférico* section is **flat (one block's worth of ids)**, but this screen is specced as a **multi-row** per-nerve table. How do N>1 nerve rows map back to a single flat id set on export — do extra rows need synthesized ids, or does the PDF only render the first/primary block?
- Singleton write coordination: full-object `PUT` merge (proposed) vs a `PATCH`-style partial — confirm the contract so N4a/N4b/N4c don't clobber each other.
- Ownership of the local-anaesthetic **dose**: [[field-inventory]] §2 allocates regional drug `checkbox_value` to `DrugAdministration`, but [[field-crosswalk]] routes these ids as `values_blob` on `AnestheticTechnique`. Which entity owns the peripheral dose value?
</content>
</invoke>
