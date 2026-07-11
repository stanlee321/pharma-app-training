---
type: plan
updated: 2026-07-09
tags: [plan, ui-ux, ux, components, data-entry, accessibility]
---

# Plan — Shared Data-Entry Component Library (interaction specs)

Interaction specs for the seven shared components the heavyweight screens in [[ux-ui]] §4 (and
[[proposed-screens]] §5) depend on. This is the **component-library companion** to [[ux-ui]]:
that page owns the principles, accessibility strategy, design-system direction, and per-screen
flows; **this page owns each widget's states, gestures, bindings, and how it composes from the
`DesignSystem` tokens.**

This is **data-first native data entry**: each widget *owns an entity value* in the case record
(the system of record), and the filled PDF is a **later projection** drawn into the field's
`blank_bbox` / table-cell rect — there is **no OCR**, no form-viewer round-trip
([schema-spec.md](../../../notebooks/docs/parsing-wiki/schema-spec.md)). The record model is the
[nine-entity model](../../../notebooks/docs/parsing-wiki/entities/model.md), not a form layout.

Every component is grounded in the app's **existing idioms** — the accelerating stepper in
`StepperRow.swift`, the card + section-header pattern in `PatientInputView`, the segmented-control
host in `SimulationView`, and the `Haptics` / `AppColors` / `Font` / `Spacing` primitives in
`DesignSystem.swift` ([[design-system-build]]). It **fixes the three cross-cutting gaps** the
[[frontend-audit-2026-07-09]] flagged — *zero accessibility*, *dead `DesignSystem` tokens*,
*hardcoded literals* — as a build requirement, not a later pass. Propose only — no app code.

---

## 0. Shared conventions (build these once, before the seven)

The load-bearing decisions every component inherits. Getting them right once is what makes the
225 toggle-based fields (48% of all 471) cheap.

### 0.1 Extract `AcceleratingRepeatButton` from `StepperRow`

`StepperRow` today inlines its hold-to-accelerate logic (`startAccelerating`/`stopAccelerating`,
`StepperRow.swift:44-100`) and — per the audit — that acceleration is **only** wired to dilution;
weight/height/age fell back to a tap-only `compactStepperButton`. Promote the pattern to one
reusable view so `CheckboxValueRow`, `HourlyFluidGrid`, and `EditableDrugTable` get consistent
accel + haptics for free:

- **Behaviour, verbatim from the existing tiers** (`StepperRow.swift:77-95`): tap = one step;
  long-press (`minimumDuration: 0.3`) starts a `Task` that fires 5×@150 ms → 10×@80 ms → then
  @50 ms with `delta * 5`. `Haptics.tap()` on every applied step. `value.clamped(to:)` on write.
  Release cancels the `Task`.
- **One change**: fire `Haptics.tap()` on *each* accelerated step (today the accel loop mutates
  silently), so the acceleration is felt.

### 0.2 Tokens each component composes from (kills dead tokens + hardcoding)

Every component routes through the `DesignSystem` tokens — reviving the audit's **dead** tokens
by *using* them and adding the **semantic** set they were missing (the full token direction lives
in [[ux-ui]] §3):

| Token | Value | Replaces the literal | Used by |
|---|---|---|---|
| `Spacing.tapTarget` | `44` | HIG min; steppers are ad-hoc 48/40 | all controls |
| `Spacing.cell` | `8` | grid cell inset | grids |
| `AppColors.selectionTint` | `.accentColor` | the hardcoded `.blue` in `genderButton` | every selected state |
| `AppColors.invalidTint` | `Color(.systemRed)` | — (no invalid style exists today) | invalid state |
| `AppColors.fieldFill` | `Color(.systemGray6)` | hardcoded recipe/badge fills | inputs, cells |
| `AppColors.controlStroke` | `Color(.systemGray4)` | the `0.5`-width strokes in `StepperRow` | control chrome |
| `Font.cellValue` | `.system(.callout, design: .monospaced)` | ad-hoc monospaced sizes | grid/table cells |
| `AppColors.surfaceDerived` | grouped-fill tint | — | N7/N8 read-only rows |

Revive the already-dead `Font.numericValue`, `Font.sectionHeader`, and
`Spacing.section/item/tight` by using them. All fonts stay **semantic Dynamic-Type** styles so
text scales — never a fixed `.system(size:)` on an entry field.

### 0.3 Accessibility baseline (the audit's "MISSING" → "MET")

Every component adopts, without exception (contract detailed in [[ux-ui]] §2):

- **Combined element**: `.accessibilityElement(children: .combine)` per row/cell so VoiceOver
  reads "Propofol, 120 milligrams, checked" as one swipe, not five fragments. **⚠️ NEVER on a row
  containing an editable `TextField`** — `combine` flattens the row and swallows keyboard input (the
  field focuses but won't accept text; fixed 2026-07-10, see [[log]]). Use it only on **read-only**
  rows; for editable rows leave children individually accessible (default) or use per-field
  `.accessibilityLabel`.
- **Label / value / hint split**: `label` = the field's schema `label`; `value` = current value +
  spoken unit; `hint` = the gesture ("Double-tap to toggle", "Swipe up or down to adjust").
- **Adjustable trait for anything numeric**: `.accessibilityAdjustableAction` maps VoiceOver
  swipe-up/down onto the same `AcceleratingRepeatButton` step, so the ± buttons are not the only
  path.
- **Dynamic Type**: semantic fonts (§0.2); rows use `ViewThatFits`/wrapping so labels don't clip.
- **Reduce Motion**: gate `withAnimation(.snappy)` and `.numericText()` transitions behind
  `@Environment(\.accessibilityReduceMotion)`.
- **Differentiate Without Color**: invalid state is **icon + text**, never red alone.

### 0.4 Binding model (read/write, DATA-FIRST)

Every component is generic over a SwiftUI `Binding` into the case record plus a **stable schema
`id`** for the later PDF pass — mirroring how `PatientInputView` binds `$state.patient.weight`:

```
Record (persisted, case-scoped)          Component                 PDF projection (later)
  entity.field: Value        ── Binding ──▶  edits in place   ── id ──▶  draw into blank_bbox /
  (nine-entity model)        ◀── write ──                               cell rect over 1:1 clone
```

The component **never reads the PDF**; it reads/writes the entity and carries the `id` only so
`fill-pdf` finds the `blank_bbox`. This is "collect once, export to many" (P8 in [[ux-ui]]).

---

## 1. `CheckboxGroupRow` — single/multi-select

**Purpose.** The workhorse: the **181 `checkbox` fields** (~45–55 option groups). One group = one
entity attribute; renders as a labelled row of chips behaving as a **radio group** (single) or a
**checkbox set** (multi).

**Layout.** Section-header row (icon-in-rounded-square + uppercase `.caption2.bold()` label,
`PatientInputView`'s card header) over a wrapping flow of selectable chips. Chip =
`.padding(.horizontal, Spacing.item)` capsule, `selectionTint` fill when on (white text),
`fieldFill` when off — the `genderButton` treatment generalised to N chips and multi-select.

```
┌────────────────────────────────────────────────┐
│ ▣ ASA CLASSIFICATION            (single-select) │
│  ( I )  (•II•)  ( III )  ( IV )  ( V )  ( E )    │   ← II filled = selected
├────────────────────────────────────────────────┤
│ ▣ MONITORING                     (multi-select) │
│  [✓ EKG] [✓ SpO₂] [ Capno ] [✓ NIBP] [ Temp ]   │
└────────────────────────────────────────────────┘
```

**States.** *Empty* — no chip filled; single never auto-picks (clinical). *Filled* — selected
chip(s) `selectionTint`; multi shows a leading `✓`. *Focused* — `.accessibilityFocused` ring, 2 pt
`selectionTint` outline. *Invalid* — only when `required` + empty at Review: header gains
`exclamationmark.triangle` + `invalidTint` (icon, not colour alone). *Disabled* — chips
`.opacity(0.4)`, e.g. a group gated off by a parent modality single-select (N4 disclosure).

**Gestures.** Tap a chip → toggle. Single: tapping a new chip deselects the old in the same
`withAnimation(.easeInOut(0.2))`; tapping the selected chip in a non-required single group clears
it. `Haptics.tap()` on every change; `Haptics.confirm()` reserved for screen-level Done. No
keyboard (selection only).

**Binding.** Single → `Binding<Option?>`; multi → `Binding<Set<Option>>`. Writes straight into the
entity (e.g. `AnestheticTechnique.ventilationMode`). Each chip carries its schema `id`
(`type:"checkbox"`, `checkbox_bbox`); on export the selected chip's box is ticked. Group→field is
many-checkbox-ids → one attribute.

**Accessibility.** Container `.accessibilityElement(children: .contain)` with the group label; each
chip `.isButton` + `.isSelected`; single-select container advertises radio semantics via hint.

---

## 2. `CheckboxValueRow` — toggle + inline number/text + unit

**Purpose.** The **44 `checkbox_value` fields** — nota2 induction drugs like `Propofol ___ mg`
([schema](../../../notebooks/forms/schema/nota2.schema.json)). A toggle that, when on, **reveals an
inline value** (number+unit or short text) — the literal `StepperRow` + toggle.

**Layout.** `[toggle] Label ……… [value] unit [– +]`. The value + unit + stepper reuse the
`StepperRow` right-cluster (monospaced `Font.numericValue`, `.contentTransition(.numericText())`,
`AcceleratingRepeatButton` ±). The value cluster is **hidden until the toggle is on**.

```
  OFF:  ( ) Propofol
  ON:   (●) Propofol …………………   120  mg   [ – ] [ + ]
  ON (text variant, no unit):
        (●) Guedel …………………  [  #4  ]        ← short text field, no stepper
```

**States.** *Empty* — off; entity `nil`. *Filled* — on, value present (defaults to typical/last
dose, editable). *Focused* — inline field first responder; `selectionTint` caret. *Invalid* — on
but blank/out-of-range → value box `invalidTint` stroke + `exclamationmark` glyph; row stays
editable. *Disabled* — `.opacity(0.4)` (drug not applicable to chosen technique).

**Gestures.** Toggle anywhere on label/switch → `Haptics.tap()`, reveal/collapse with
`withAnimation(.snappy(0.15))` (Reduce-Motion-gated). Turning off keeps the value greyed
(undo-friendly). Number: ± via `AcceleratingRepeatButton` **and** direct entry (tap value → decimal
keypad with `Done` toolbar item); clamp on commit; `Haptics.targetSnap()` if clamped. Text:
`.keyboardType(.default)`, `.submitLabel(.done)`.

**Binding.** `Binding<Bool>` (on/off) + `Binding<Double?>`/`Binding<String?>` (value). Maps to a
[DrugAdministration](../../../notebooks/docs/parsing-wiki/entities/drug-administration.md) inline
dose (`label`, `dosis`, `unit`). On export: tick `checkbox_bbox`, draw value into `blank_bbox`
(unit is pre-printed).

**Accessibility.** One combined element: label = field label; value = "on, 120 milligrams" / "off";
adjustable action drives the stepper; hint = "Double-tap to toggle; adjust with swipe up or down."
Spoken unit expands `mg`→"milligrams," `mcg`→"micrograms."

---

## 3. `ScoreGridWidget` — Aldrete 0/1/2

**Purpose.** The **Aldrete recovery matrix** (N8): **5 criteria × 6 time-points** of 0/1/2 cells +
an **auto-summed TOTAL row** (0–10 per column), from `imss_p1.aldrete` (36 `score` cells,
[recovery-score.md](../../../notebooks/docs/parsing-wiki/entities/recovery-score.md)). A
purpose-built grid, **not 36 loose numbers**.

**Layout.** Sticky left criterion labels; columns = time points. Each cell is a **compact 3-way
0/1/2 segmented control** (the `SimulationView`/gender segmented idiom, shrunk). Bottom TOTAL row is
read-only monospaced (`Font.numericValue`), recomputed live.

```
              AL SAL   0    20    60    90   120
 Actividad   [0|1|2] [·|·|2] ...
 Respiración [0|1|2] ...
 ─────────────────────────────────────────────
 TOTAL          7     9    10    10    —     —    ← auto-sum, tinted at 10
```

**States.** *Empty* — no segment chosen (distinct from a chosen 0); a partial column's TOTAL shows
`—`, not a misleading sum. *Filled* — chosen segment `selectionTint`; TOTAL bold, greens at 10
(`AppColors.effect`, the "recovered" cue). *Focused* — 2 pt outline; column header highlights.
*Invalid* — n/a per-cell (0/1/2 always valid); a partial column surfaced at Review, not blocking.
*Disabled* — future time-points dimmed until reached.

**Gestures.** Tap a segment → set 0/1/2, `Haptics.tap()`; TOTAL animates via `.numericText()`
(Reduce-Motion-gated). A full column of 10 fires `Haptics.confirm()`. Horizontal scroll for the 6
columns; criterion column pinned. VoiceOver only.

**Binding.** `Binding<[Criterion: [Int?]]>` (or flat `[cellID: Int]`), one per
`aldrete_<criterion>_c<n>`. TOTAL is **derived, never stored** (`total[c] = Σ criteria[c]`). Export
draws each cell's digit into its bbox and the six totals into `aldrete_total_c*`.

**Accessibility.** **Table semantics**: each cell "row criterion, column time, score N of 2,"
adjustable (swipe cycles 0/1/2). TOTAL row is a static per-column summary. This is the exact
"Canvas/grid opaque to VoiceOver" failure the audit named.

---

## 4. `HourlyFluidGrid` — 85-cell spreadsheet + running auto-balance

**Purpose.** The **`control_fluidos` spreadsheet** (N7): **17 rows × 5 hour-columns = 85 numeric
cells**, with **derived rows** computed live — Balance parcial, Balance total, Gasto urinario, Tasa
Fentanilo ([fluid-balance.md](../../../notebooks/docs/parsing-wiki/entities/fluid-balance.md)). The
most complex component.

**Layout.** Frozen left row-labels; 5 hour columns; horizontal scroll. Editable cells are ml volumes
(`Font.cellValue`). **Derived rows** are visually distinct (`surfaceDerived` background, lock glyph)
and **read-only**. Running Balance total accumulates left-to-right.

```
                    1hr    2hr    3hr    4hr    5hr
 NCL               [ 250 ][ 250 ][    ][    ][    ]   ← editable, decimal keypad
 Diuresis          [  80 ][ 120 ][    ][    ][    ]
 ══════════════════════════════════════════════════
 Balance total     ▹ +70  ▹   0                        ← running Σ, red if |x|>threshold
 Gasto urinario    ▹ 1.1  ▹ 1.7   (ml/kg/h)            ← derived, locked
```

**States.** *Empty* — faint `0`/placeholder; derived rows blank until inputs. *Filled* — value
monospaced; derived rows update every commit; **imbalance flag**: `Balance total` turns `invalidTint`
(▲ glyph) when |balance| exceeds a per-kg threshold. *Focused* — active cell `selectionTint` outline;
row + column headers highlight. *Invalid* — nonsensical negative or non-numeric → `invalidTint` stroke.
*Disabled* — derived rows permanently non-editable; future hours dimmed.

**Gestures.** Tap a cell → decimal keypad; toolbar `‹ ›` moves prev/next cell, `Next` advances down
the column (fast hourly entry). `Haptics.tap()` on focus, `Haptics.targetSnap()` when a commit flips
`Balance total` across zero. Optional ± via `AcceleratingRepeatButton` in an expanded single-cell
editor. `.numericText()` on derived rows (Reduce-Motion-gated).

**Binding.** `Binding<[FluidRow: [Double?]]>` keyed by `control_fluidos` row×col ids. The four derived
rows are **computed, never stored**; `Tasa Fentanilo` reads across into
[DrugAdministration](../../../notebooks/docs/parsing-wiki/entities/drug-administration.md), per-kg
rates read [Patient](../../../notebooks/docs/parsing-wiki/entities/patient.md) weight. A tiny
`@MainActor @Observable` grid view-model owns the auto-balance. Export fills each `row_cut × col_cut`
cell rect.

**Accessibility.** Full table semantics: cell "row label, hour N, value ml"; derived cells add
"computed," non-adjustable. A per-column summary speaks the running balance so a VoiceOver user hears
the tally without scanning. The marquee fix for "Canvas/grids invisible to assistive tech."

---

## 5. `EditableDrugTable` — add-row + TCI recommended dose

**Purpose.** The **`farmaco` / `medicamentos` ledgers** (N6): a growable list of
[DrugAdministration](../../../notebooks/docs/parsing-wiki/entities/drug-administration.md) rows. Its
differentiator: for a Propofol/Remifentanil row it shows the **TCI-recommended dose** from
`DrugModel` + `MockPKEngine.computeTCI` beside the *given* dose — planning and documentation unified.

**Layout.** A list of rows `[drug ▾] [dose+unit] [route ▾] [time] [⊖]`, an **"+ Add drug"** footer
(reusing `SimulationView`'s `+ Target` add-row). When the drug is a modelled TCI agent, a
**recommendation chip** ("TCI: 2.1 ml bolus · 8 ml/h") appears under the dose, tappable to
accept-into the given field.

```
 A  [Propofol ▾]   [ 120 mg ]  [ IV ▾]  09:14  ⊖
        └ TCI rec: 2.1 ml bolus · 8.4 ml/h   ▸ tap to use
 B  [Fentanilo ▾]  [ 250 mcg] [ IV ▾]  09:15  ⊖
 C  [ + Add drug ]
```

**States.** *Empty* — only "+ Add drug". *Filled* — rows populated; TCI chip on modelled drugs;
free-text names show no chip. *Focused* — active field (keypad / open menu) highlighted. *Invalid* —
missing name or dose → row `invalidTint` left-edge bar; can't export but doesn't block others.
*Disabled* — a row committed to the transanesthetic timeline locks its `time`.

**Gestures.** "+ Add drug" → append blank row, `Haptics.tap()`, autofocus the drug picker. Drug/route
are `Menu` pickers (list from `DrugDatabase`); dose is a decimal keypad. `Haptics.confirm()` when a TCI
chip is accepted. **Swipe-to-delete** + explicit `⊖`. Time defaults to now, editable via `DateTimePicker`
(§7).

**Binding.** `Binding<[DrugAdministration]>` — an ordered collection appended per case. Each row maps
to a table row id (A–O / A–M); name→`Fármaco` cell, dose+route→`Dosis y Vía` cell. The **recommended**
dose is computed on the fly from `MockPKEngine.computeTCI`/`computeBET` (see [[simulation-screen]],
[[pk-engine-math]]) and stored alongside the **given** dose in the same object. Export writes name +
dose/route into the row's two cells.

**Accessibility.** Each row is one combined element: "Row A, Propofol, 120 milligrams, IV, 9:14 AM;
recommended 2.1 milliliters." The TCI chip is a button ("Use recommended dose"); add/delete are
labelled actions; the row exposes delete via `.accessibilityAction(named:)` so VoiceOver users don't
need the swipe.

---

## 6. `SignaturePad`

**Purpose.** The **~4 signature fields** (`firmas`, `medico_responsable`, `alta_a_su_piso`) —
schema-typed `text`/`open_field` but **reclassified in the UI** to a drawn signature, no schema
change. Belongs to
[anesthesia-case](../../../notebooks/docs/parsing-wiki/entities/anesthesia-case.md) /
[recovery-score.md](../../../notebooks/docs/parsing-wiki/entities/recovery-score.md).

**Layout.** A bordered draw area with a baseline + "✕ ────" guide and the signer's role caption
(`Font.sectionHeader`), a `Clear` button, and — filled — a small "signed at HH:MM" stamp. Card chrome
matches `PatientInputView` (14 pt radius, `systemBackground`).

```
 ┌───────────────────────────────────────┐
 │      ╭────╮  ╰──╮  (ink strokes)        │
 │   ✕ ─────────────────────────────      │   ← baseline guide
 └───────────────────────────────────────┘
   Anestesiólogo responsable      [ Clear ]
   signed 09:42
```

**States.** *Empty* — guide + "Sign here"; entity `nil`. *Filled* — captured ink; `Clear` enabled;
timestamp stamped on first stroke. *Focused* — active drawing; border `selectionTint`. *Invalid* —
required-but-empty at Review → `invalidTint` border + "Signature required" (icon+text). *Disabled* —
once the case is finalized/exported the pad locks (signatures are legal artifacts); lock glyph, `Clear`
hidden.

**Gestures.** Draw with finger or Apple Pencil (PencilKit-backed, or a `Canvas` stroke recorder). First
stroke → `Haptics.tap()` + timestamp. `Clear` → confirm via a short warning double-check for a non-empty
pad, then wipe. No keyboard. Palm-rejection via PencilKit.

**Binding.** `Binding<SignatureData?>` — stores **vector strokes + a rasterized PNG + timestamp** on
the entity (not free text). Export **draws the raster into the field's `blank_bbox`** over the 1:1 clone
(reclassification is UI-only; the field id/bbox is unchanged).

**Accessibility.** One element labelled by role: "Signature, Anestesiólogo responsable, signed at 9:42
AM" or "not signed." A VoiceOver user cannot draw, so provide an
`.accessibilityAction(named: "Attest & sign")` that records a **typed-name attestation** fallback (name
+ timestamp) into the same field — an accessible equivalent, not a dead end. `Clear` is a labelled
destructive action.

---

## 7. `DateTimePicker`

**Purpose.** The **~6 date/time fields** (`Fecha`, `Sala/Turno` timestamps, drug/recovery times) —
schema `text`/`open_field`, **reclassified in-UI** to a proper date/time control, no schema change.
Feeds [anesthesia-case](../../../notebooks/docs/parsing-wiki/entities/anesthesia-case.md) header and
drug `time`.

**Layout.** A tappable `[ 09 Jul 2026 · 09:14 ]` chip (monospaced `Font.numericValue` so digits don't
jitter), expanding into the system wheel/graphical `DatePicker`. A `Now` shortcut sits beside it.

```
 Fecha / hora   [ 09 Jul 2026 · 09:14 ]  ( Now )
                  └ tap → system date+time picker
```

**States.** *Empty* — "Set date/time"; `nil`. *Filled* — formatted chip; `Now` still available.
*Focused* — picker open; chip `selectionTint` outline. *Invalid* — out-of-window (e.g. recovery before
induction) → `invalidTint` chip + inline "after induction only"; the picker `in:` range pre-constrains
where possible. *Disabled* — dimmed when the parent row is locked.

**Gestures.** Tap chip → present `DatePicker` (`.graphical` for date, wheel for time). `Now` → current
time, `Haptics.confirm()`. Committing → `Haptics.tap()`. Locale-aware formatting; no custom keyboard.

**Binding.** `Binding<Date?>` on the entity. Export **splits the `Date`** into whatever sub-blanks the
form prints (`dd`/`mm`/`aa` boxes, or one `Fecha` line) and draws each into its `blank_bbox` — one entity
`Date` → N field ids at fill time. Drug-row times plot as marks on the
[transanesthetic-record](../../../notebooks/docs/parsing-wiki/entities/transanesthetic-record.md)
timeline.

**Accessibility.** The chip is labelled "Date and time, 9 July 2026, 9:14 AM" and uses the system
`DatePicker`, already VoiceOver-adjustable. The win is *using the native control* instead of a free-text
`open_field`.

---

## 8. Coverage & consistency check

| Component | Fields served | Idiom mirrored | Key tokens |
|---|---|---|---|
| `CheckboxGroupRow` | 181 `checkbox` (~50 groups) | `genderButton` segmented | `selectionTint`, `fieldFill` |
| `CheckboxValueRow` | 44 `checkbox_value` | `StepperRow` + toggle | `AcceleratingRepeatButton`, `invalidTint` |
| `ScoreGridWidget` | 36 Aldrete `score` cells | `SimulationView` segmented ×N | `Font.cellValue`, `effect` (=10 cue) |
| `HourlyFluidGrid` | 85 `control_fluidos` cells | new grid + `numericText` | `Spacing.cell`, `Font.cellValue`, `surfaceDerived`, `invalidTint` |
| `EditableDrugTable` | `farmaco`/`medicamentos` rows | `+ Target` add-row + `Menu` | `invalidTint` |
| `SignaturePad` | ~4 signatures | card chrome | `selectionTint`, `invalidTint` |
| `DateTimePicker` | ~6 date/time | native `DatePicker` | `selectionTint`, `Font.numericValue` |

All seven share the §0 baseline: extracted `AcceleratingRepeatButton`, semantic tokens (no literals),
and the accessibility contract. That is what turns the audit's three "MISSING/dead/hardcoded" findings
into the default for all new data-entry work — the screen-level wiring is in [[ux-ui]] §4.

---

## Sources & cross-links

- **App idioms:** `PharmaApp/Utilities/StepperRow.swift` (accel + `Haptics`),
  `PharmaApp/Utilities/DesignSystem.swift` (`AppColors`/`Font`/`Spacing`/`Haptics`),
  `PharmaApp/Views/PatientInput/PatientInputView.swift` (card + segmented + section-header),
  `PharmaApp/Views/Simulation/SimulationView.swift` (segmented host + add-row).
- **Wiki:** [[ux-ui]] (principles, a11y, design-system, screen flows), [[proposed-screens]] (§5 the
  component list, §4 splits, §6 prerequisites), [[design-system-build]], [[input-screens]],
  [[simulation-screen]], [[pk-engine-math]], [[frontend-audit-2026-07-09]] (the three gaps fixed here).
- **Notebooks:** [model.md](../../../notebooks/docs/parsing-wiki/entities/model.md),
  [schema-spec.md](../../../notebooks/docs/parsing-wiki/schema-spec.md),
  [recovery-score.md](../../../notebooks/docs/parsing-wiki/entities/recovery-score.md),
  [fluid-balance.md](../../../notebooks/docs/parsing-wiki/entities/fluid-balance.md),
  [drug-administration.md](../../../notebooks/docs/parsing-wiki/entities/drug-administration.md),
  [anesthetic-technique.md](../../../notebooks/docs/parsing-wiki/entities/anesthetic-technique.md);
  schemas [nota2](../../../notebooks/forms/schema/nota2.schema.json),
  [nota21](../../../notebooks/forms/schema/nota21.schema.json),
  [imss_p1](../../../notebooks/forms/schema/imss_p1.schema.json),
  [imss_p2](../../../notebooks/forms/schema/imss_p2.schema.json).
</content>
</invoke>
