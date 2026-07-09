---
type: plan
updated: 2026-07-09
tags: [plan, ui-ux, ux, accessibility, design, screens]
---

# Plan — UX/UI Master: Principles, Accessibility, Design System & Screen Flows

The human-factors layer for the clinical-record app mapped in [[proposed-screens]] and
inventoried in [[field-inventory]]. It answers three questions the screen map does not:
**how** a clinician enters the ~471 fields fast and safely (Part 1, principles), **how** every
control is exposed to assistive tech (Part 2, accessibility), **how** the visual system and
theming are organised (Part 3), and **how** the seven heavyweight screens actually drive
under the clinician's thumb (Part 4, flows + wireframes). The shared components these flows
depend on are specified in [[ux-components]]. This is a **proposal, not code**: it names
SwiftUI/Accessibility modifiers and patterns and grounds each in an idiom the app already
ships, so the new work is *consistent with what is built*.

**Framing — data-first, not a form viewer.** The clinician enters anaesthesia data natively
into a case-scoped record (the nine-entity model at
[model.md](../../../notebooks/docs/parsing-wiki/entities/model.md)); the **filled PDF is a
subproduct** rendered later by the planned `fill-pdf` layer
([schema-spec.md](../../../notebooks/docs/parsing-wiki/schema-spec.md),
[regen.py](../../../notebooks/forms/regen.py) / [imss_gen.py](../../../notebooks/forms/imss_gen.py))
— there is **no OCR**. Every principle below optimises the *entry* experience, not a form's
visual fidelity. The end-to-end vision is [[forms-to-app]].

**Audit alignment.** [[frontend-audit-2026-07-09]] flags three cross-cutting UX debts — *zero
accessibility surfaces*, *dead `DesignSystem` tokens while views hardcode literals*, and
*pervasive magic numbers* — that these much denser data-entry screens would amplify if copied
blindly. This master treats each as a hard requirement, and shows the same pass closes all
three: adopting the unused `Font` tokens *is* the Dynamic-Type fix; routing colours through
`AppColors` *is* the semantic-colour fix.

---

## Part 1 — UX principles for fast, safe, low-error clinical entry

Eight principles. Each cites the existing idiom it extends and the [[field-inventory]]
pressure it relieves.

### P1. Two-tempo entry: capture *during* the procedure, complete it *after*

Clinical entry happens in two very different states, and one layout cannot serve both:

- **Intra-op (hands-busy, glance-and-tap).** Live vitals, drug boluses, fluid losses.
  Optimise for *few, large, forgiving* targets and zero modal interruptions — the N5
  monitoring chart (`ChartCanvas`), the N6 Drug Ledger, and the N7 fluid grid.
- **Post-op (seated, completing the record).** The flat, text-dense sections —
  Preanesthetic Assessment (N3), signatures, diagnoses, Recovery/Aldrete (N8). Optimise for
  *throughput and keyboard flow*, field-to-field advance, WNL fast-paths.

**Consequence.** Route intra-op surfaces to be reachable in ≤1 tap from the Encounter Hub
(N2), give them the largest hit targets and least chrome, and never block intra-op capture
behind a validation modal (P4).

### P2. One-tap selection at scale — build the toggle components once

**225 of 471 fields (48%) are toggle-based** — 181 `checkbox` + 44 `checkbox_value`
([[field-inventory]] §1). The highest-leverage ergonomic investment is two shared
components, siblings of the existing `StepperRow`: **`CheckboxGroupRow`** (radio-like single
or multi) and **`CheckboxValueRow`** (toggle + inline `StepperRow` value). Full specs in
[[ux-components]]. Target: **1 tap per option, 0 taps to confirm** — a group of 4 monitoring
toggles costs 4 taps, not 4 taps + a sheet.

### P3. Smart, model-driven defaults — and clamp on entry, not on submit

The app already has the right primitive: `AppState.onDrugSelected()` **clamps**
`weight/height/age` into the active model's `validationRules` before the patient screen
renders ([[input-screens]]). Generalise clamp-on-entry to every numeric field:

- **Prefill from what's known.** `PatientProfile` (weight/height/age/sex) is captured once
  and *parameterises everything downstream* — IMC, ideal weight, VSC, every TCI dose. Never
  re-ask (P8).
- **Pre-select the common case.** Single-select groups default to the modal value (ASA,
  position), so the frequent path is *zero taps*.
- **Carry forward.** Vitals and fluid columns pre-fill from the previous time-point; the
  clinician edits deltas, not absolutes.
- **Ranges come from the model, per field.** Reuse `ValidationRules` (and the
  `requirementBadge` range-hint idiom from `modelInfoFooter`) so each numeric field
  advertises its bounds inline.

### P4. Prevent the error at the control; validate inline; never let derived values be typed

- **Constrain, don't scold.** A `StepperRow`/`CheckboxValueRow` bound to a clamped range
  *cannot* produce an out-of-range value (`value.clamped(to: range)` is already the
  `StepperRow` behaviour). Prefer this over a red-text validator firing after the fact.
- **Derived fields are read-only, computed live.** IMC, Peso ideal, VSC / 25% / 15% VSC,
  Aldrete totals, and the four fluid-balance rows are **calculated, not collected**
  ([[field-inventory]] §3). Render them as live, non-editable readouts (monospaced,
  `.numericText()` transition) so a clinician physically *cannot* enter a contradicting value.
- **Inline, proximate feedback.** Cross-field warnings (e.g. `Sangrado` crossing computed
  15%/25% VSC) surface as an inline banner *on the row*, with a warning `Haptics` cue — not
  a blocking alert that interrupts intra-op flow.

### P5. Progressive disclosure for the heavyweight sections

`AnestheticTechnique` is **~185 fields / ~40% of everything**, in three disjoint modalities
([anesthetic-technique.md](../../../notebooks/docs/parsing-wiki/entities/anesthetic-technique.md)).
Rendered as one scroll it is unusable. **Gate by top-level choice** (show only the chosen
modality — the N4 split below); **page sub-sections** with the segmented-control host already
in `SimulationView`; keep disclosure *reversible and cheap* — a mis-chosen modality must not
discard entered data (P6).

### P6. Reversible by default — undo everywhere, confirm only the irreversible

The app's screens edit `AppState` **in place** with no submit step ([[input-screens]]).
That makes a mis-tap immediately destructive unless we back it. So: **every edit is undoable**
(back the case record with an `UndoManager`; shake-to-undo + inline "Undo"); **confirm only
the truly irreversible** (deleting a drug-ledger row, clearing a section, committing the N10
export) via `Haptics.confirm()` + a `confirmationDialog`; **auto-persist** continuously (the
case store, [[proposed-screens]] §6.1) so nothing is lost to a backgrounded app.

### P7. Section-completion feedback — always show what's done and what's left

With ~471 fields across ~11 screens, a clinician needs a persistent sense of progress. The
**Hub is a checklist**: each Encounter Hub (N2) section row shows a completion state ("Patient ·
complete", "Preanesthetic · 12/18"). **Only required fields gate "complete"**; signatures/firmas
are the hard gates for export (N10). **Reward completion** by firing `Haptics.confirm()` when a
section flips to complete — reusing the existing commit haptic.

### P8. Collect once, project to many forms

The four forms overlap heavily — `Patient` in all four, `AnestheticTechnique` in both nota2
and imss_p2 ([[proposed-screens]] §1). Entry is organised **by entity, never by form**: each
entity is captured **once** into the shared record; the form is an *output projection*. N10
renders whichever form set the clinic needs from the same data with **no re-entry** — the
`fill-pdf` bind-back is designed cell-by-cell via bboxes
([schema-spec.md](../../../notebooks/docs/parsing-wiki/schema-spec.md)). Continuity is also
*within* the record: a value entered where it is authoritative is visible (read-only)
everywhere it is consumed (couples to P4).

**Principle → concern coverage:** P1 tempo · P2 toggle taps · P3 defaults · P4 inline
validation + error-prevention · P5 progressive disclosure · P6 undo/confirm · P7
section-completion · P8 collect-once continuity.

---

## Part 2 — Accessibility strategy (closing the zero-a11y gap)

The audit is blunt: *"zero accessibility modifiers anywhere; Canvas charts and icon-only
controls are invisible to VoiceOver; fixed small fonts ignore Dynamic Type."* For a medical,
App-Store-bound app this is a release-blocker. The strategy is **co-scoped with the
dead-token / hardcoded-value cleanup** — one pass closes both.

### 2.1 The VoiceOver label / value / hint contract

Every interactive element gets an explicit three-part identity; compound rows group into a
*single* accessibility element so VoiceOver reads one coherent phrase.

| Control | `.accessibilityLabel` | `.accessibilityValue` | hint / traits |
|---|---|---|---|
| `StepperRow` / biometric row | field name ("Weight") | value + unit ("72 kilograms") | `.accessibilityAdjustableAction` (swipe ↑/↓) |
| `CheckboxGroupRow` option | option name ("Electiva") | — | `.isSelected` when on; "double-tap to select" |
| `CheckboxValueRow` | drug/field name ("Propofol") | armed + value ("on, 120 milligrams") | `.isSelected` + adjustable value |
| Segmented (gender/modality) | group name | selected option | `.isSelected` on the chosen segment |
| Derived readout (IMC, Aldrete total) | field name | computed value | `.updatesFrequently`; **not** adjustable/actionable |
| Icon-only toolbar button | verb ("Select Drug", "Add drug row") | — | hint where non-obvious |
| Section row (Hub) | section name | completion state ("12 of 18 fields") | "double-tap to open" |

**Key idiom — the adjustable stepper.** Rather than expose the two tiny `+`/`−` buttons as
separate VoiceOver targets, make each numeric row a *single adjustable element*: label + value
+ unit combined, with `.accessibilityAdjustableAction { direction in … }` mapping swipe-up/down
to the existing `adjust(by:)` increment. Mirrors the native iOS stepper, halves swipe count,
reuses `StepperRow`'s clamp-and-`Haptics.tap()` logic unchanged.

### 2.2 Selection controls — traits over colour

The 225 toggles must not signal state by colour alone. Use `.accessibilityAddTraits(.isSelected)`
for the on-state; single-select groups expose the container with
`.accessibilityElement(children: .contain)` and each option as radio-like. `CheckboxValueRow`
combines toggle + inline value into one element whose value string carries both, so VoiceOver
never lands on an orphaned text field.

### 2.3 Dynamic Type (and the dead-Font-token fix, together)

All `DesignSystem` `Font` tokens are dead, and views hardcode `.caption2` etc.; the tokens are
already defined to scale (`.title2`, `.headline`, `.body` aliases — see `DesignSystem.swift`).
So: **adopt the tokens** (kills the dead-token finding *and* makes text respond to text-size
settings); **fix the fixed sizes** — `Font.axisLabel` is a hardcoded 10 pt monospaced that
*does not scale* ([[design-system-build]]); chart ticks and new grid headers move to a scalable
size or `@ScaledMetric`; **reflow, don't clip** — dense grids (Aldrete 6×6, fluid 85-cell)
switch to horizontal scroll / `ViewThatFits` at large sizes; cap only where layout truly breaks,
via `.dynamicTypeSize(...DynamicTypeSize.accessibility3)` on the specific container, never
app-wide.

### 2.4 Hit targets ≥ 44 pt — `StepperRow` is the template, two controls miss it

`StepperRow.stepButton` is a **48×48 pt** target (`.frame(width: 48, height: 48)`) — already
compliant and the reference to copy. Two existing controls fall short:

- **`PatientInputView.compactStepperButton` is 40×40 pt** — below the 44 pt minimum. Migrating
  the weight/height/age rows to `StepperRow` fixes the hit-target gap *and* the audit's
  separate "biometric steppers are tap-only, don't accelerate" finding in one change.
- **`genderButton`** sizes by text + `.vertical, 8` padding (~33 pt tall) — pad to ≥44 pt.

All new toggle/segment components inherit the 48 pt target from day one.

### 2.5 Focus order

**Logical reading order** per screen: header → each section in visual order → primary action.
Group compound rows with `.accessibilityElement(children: .combine)` so focus moves row-by-row.
Use `.accessibilitySortPriority` only where visual layout and reading order legitimately diverge
(e.g. a derived TOTAL read *after* its inputs). **Keyboard flow** for text-dense post-op
sections (P1): `.submitLabel(.next)` + focus advance and `.keyboardType(.decimalPad)` on numeric
write-ins.

### 2.6 Canvas & grid widgets — the accessible textual representation

The hand-drawn `Canvas`/grid widgets are *opaque* to VoiceOver today. **The rule: the accessible
representation is generated from the same data the widget draws — never a hand-maintained
parallel string.**

**a) Vitals time-series chart** (`ChartCanvas`, N5): provide an **`AXChartDescriptor`** (via
`AXChartDescriptorRepresentable`) with one `AXDataSeriesDescriptor` per lane and labelled X/Y
axes — this gives VoiceOver users the **Audio Graph** rotor. Add a one-line summary ("Vitals,
6 traces, 0–120 minutes") and expose surgical event markers 1–6 as labelled elements. **Fix
the colour-semantics bug while here:** the audit found tooltip legend dots are hardcoded and
*don't match the curve colours* — route both through `AppColors` so legend, curve, and summary
agree (colour must never be the sole carrier of which trace is which — pair with a labelled
series name).

**b) Aldrete 6×6 score grid** (`ScoreGridWidget`, N8): `.accessibilityElement(children: .contain)`
on the grid; **each cell** is adjustable (label = "criterion × time-point", value = 0/1/2). The
**TOTAL row is read-only**, announced as computed ("Total at 20 minutes, 8 of 10"). Provide a
grid-level summary element.

**c) Hourly fluid grid** (`HourlyFluidGrid`, N7, 85 cells): each cell adjustable (label = "row ×
hour", value = amount + unit); the four **derived rows** are read-only, computed, announced as
such; a per-column summary speaks the running balance so a VoiceOver user gets the bottom line
without traversing 17 cells.

### 2.7 Haptics as a non-visual channel — extend the existing vocabulary

The app has a semantic three-call `Haptics` enum (`tap` / `targetSnap` / `confirm`). Extend it
rather than scatter generators, and make every haptic a *redundant* cue paired with a VoiceOver
announcement (never haptic-only): `Haptics.tap()` on toggle/stepper change; `Haptics.confirm()`
on section-completion (P7) and commit/export; **add a warning cue**
(`UINotificationFeedbackGenerator(.warning)`) for the P4 inline validation warnings, paired with
an `AccessibilityNotification.announcement`.

---

## Part 3 — Design system & theming direction

The audit found "large parts of `DesignSystem` are dead … while views hardcode colors," and
"pervasive magic numbers … despite the existing `Spacing` scale." These screens route
**everything** through tokens, and **give the dead tokens a job** by adding the semantic set they
were missing. `DesignSystem.swift` today is four namespaced enums (`AppColors` dark-first, six
`Font` aliases, three `Haptics` calls, four `Spacing` constants — [[design-system-build]]).
Proposed additions, grounded against what exists:

| Token group | Names | Replaces the literal | Used by |
|---|---|---|---|
| `CompletionStatus` | `statusComplete` / `statusPartial` / `statusEmpty` | — (no status style exists) | N2 pills, N6 variance, N8 dischargeable, N10 review |
| `Surface` | `surfaceGrouped`, `surfaceCard`, `surfaceDerived` | hardcoded `Color(.systemBackground)` / `systemGroupedBackground` in `PatientInputView` | all light screens; `surfaceDerived` = the N7/N8 read-only tint |
| Selection/validity | `selectionTint` (`.accentColor`), `invalidTint` (`systemRed`), `fieldFill` (`systemGray6`), `controlStroke` (`systemGray4`) | the hardcoded `.blue` in `genderButton`; the `0.5`-width strokes in `StepperRow` | every selected/invalid state, inputs, chrome |
| Vitals series | `vitalFC / vitalBP / vitalSpO2 / vitalTemp / vitalEtCO2 / vitalBIS` + a per-series `symbol` glyph | hardcoded legend dots that "don't match curve colors" | N5 chips, chart markers, legend, VoiceOver summary |
| Spacing/fonts | `Spacing.tapTarget` (44), `Spacing.cell` (8); revive dead `Font.numericValue / sectionHeader` and `Spacing.section/item/tight` by *using* them; add `Font.cellValue` (`.callout` monospaced) | scattered magic numbers, ad-hoc monospaced sizes | all controls, grids, tables |

Three rules bind this together:

- **Semantic Dynamic-Type only.** Every font stays a semantic style so text scales — never a
  fixed `.system(size:)` on an entry field. `Font.axisLabel`'s fixed 10 pt is the exception to
  *fix* (§2.3).
- **Colour is never the sole signal.** Every state that uses colour (selected, invalid,
  derived, vital series) pairs it with an icon, glyph, or label — the a11y "differentiate
  without color" requirement and the fix for the legend-mismatch bug.
- **Theme is a per-screen decision, made via tokens.** Data-entry screens (**N2, N4, N6, N7,
  N8, N10**) adopt the **light grouped-form idiom** already used by
  `PatientInputView`/`DrugSelectionView` (`.background(surfaceGrouped)`). **N5 Monitoring
  deliberately stays dark** because it *is* `ChartCanvas` (`.background(AppColors.darkBg)`),
  matching `SimulationView`'s `.preferredColorScheme(.dark)`. Each screen commits to one theme
  via tokens rather than leaving it to chance.

Adopting these tokens is *how* the new screens become the reference implementation for the token
discipline the rest of the app can then retrofit. The component-by-component composition of these
tokens is specified in [[ux-components]] §0.

---

## Part 4 — Interaction flows & wireframes (the seven heavyweight screens)

Companion to [[proposed-screens]] (which screens exist) — this specifies **how a clinician
drives** each heavyweight one. Every interaction is grounded in an idiom the app already ships:

| Existing idiom | File | Reused by |
|---|---|---|
| Segmented-control host (paged subsections) | `SimulationView.swift:107` | **N4** modality + subsection paging |
| `Canvas` chart w/ `xForTime`/`yForConcentration` coord map | `ChartCanvas.swift:53-61` | **N5** tap-to-plot vitals |
| Tap/drag → `(timeFraction, value)` gesture | `SimulationView.swift:319-351` | **N5** plot & nudge points |
| TCI readout block (Bolus / Target / Infusion) | `SimulationView.swift:199` | **N6** recommended-dose column |
| `MockPKEngine.computeTCI/computeBET` | `Engine/MockPKEngine.swift` | **N6** recommended dose |
| `StepperRow` number+unit, hold-to-accelerate | `Utilities/StepperRow.swift` | **N4/N6/N7/N8** numeric cells |
| Grouped-card list idiom | `PatientInputView.swift`, `DrugSelectionView.swift` | **N2/N10** section rows |
| `DesignSystem` tokens | `Utilities/DesignSystem.swift` | all (Part 3 token discipline) |

Each screen adds its `Route` case (`Hashable`, some with associated values —
`.encounterHub(UUID)`, `.technique(TechniqueZone)`), a `.navigationDestination` branch in
`RootView`, reads `@Environment(AppState.self)`, and — where it has derived logic (N5 plot, N6
TCI, N7 balances, N8 sums, N10 fill-pdf) — gets a `@MainActor @Observable` view-model shaped
like `SimulationViewModel`, persisting into the case store ([[proposed-screens]] §6.1;
[[screens]] "Adding a screen"; [[state-navigation]]).

### N2 — Encounter Hub · `.encounterHub(UUID)`

**Entity:** `AnesthesiaCase` (root) ·
[anesthesia-case](../../../notebooks/docs/parsing-wiki/entities/anesthesia-case.md).

Encounter List (N1) → tap a case → **push** `.encounterHub(id)`, the *encounter root* every
capture screen is a child of. The legacy `.drugSelection` root becomes a **PK tool** reachable
from N5/N6, not the spine. The screen is a **checklist** (P7): an identity strip (read-only
`Patient` + case admin, tap to edit), an aggregate progress bar, and **section rows** each
showing SF Symbol + title + entity subtitle + **completion pill** + progress count + chevron.
Completion is derived from the record via `CompletionStatus` tokens (`✓ complete` / `◐ partial`
+ count / `○ empty`). Drug Ledger (N6) and Fluid Balance (N7) nest indented under Monitoring
(N5); Newborn is `0..n` with inline `+ add` (N9 sheet). Primary CTA → Review & Export (N10).

```
┌─────────────────────────────────────┐
│ ‹ Cases            Encounter     ••• │  edit case = •••
├─────────────────────────────────────┤
│  GARCÍA LÓPEZ, M.     ♀ 34y  68 kg   │  identity strip → tap = edit Patient
│  Dx: Colecistitis · ASA II · Sala 3  │  case-root summary → tap = edit admin
│  Overall  ▓▓▓▓▓▓▓░░░  62%   4 forms   │  aggregate progress (derived)
├─────────────────────────────────────┤
│ ✓ Patient Data *          32/32    › │  statusComplete
│ ◐ Preanesthetic Assess.   20/35    › │  statusPartial + count
│ ◐ Anesthetic Technique *  General  › │  partial; shows chosen modality
│ ◐ Transanesthetic Monit.  plotting › │
│    └ Drug Ledger          6 drugs  › │  nested tool (N6)
│    └ Fluid Balance        empty    › │  nested tool (N7), statusEmpty
│ ○ Recovery (Aldrete)      empty    › │
│ ○ Newborn (obstetric)     ＋ add   › │  0..n sheet (N9)
├─────────────────────────────────────┤
│         [   Review & Export   ›   ]   │  primary CTA → N10
└─────────────────────────────────────┘
```
Reuses grouped list + header-card idioms. New: `SectionRow` + `CompletionStatus` tokens. A11y:
each row is one element, "Preanesthetic Assessment, 20 of 35 fields, partial", hint "double-tap
to edit".

### N4 — Anesthetic Technique · `.technique(TechniqueZone)`

**Entity:** `AnestheticTechnique` (~185 fields) ·
[anesthetic-technique](../../../notebooks/docs/parsing-wiki/entities/anesthetic-technique.md).

The screen that **must be split** (P5). Entry is a **single top-level modality single-select**;
choosing one **progressively discloses only that modality's fields** — the other two modalities'
combined fields **never render**. General's four subsections (Ventilación / Ciclado / Parámetros
/ Mantenimiento) page behind a **second, nested segmented control** (the `SimulationView` host
used twice). Fields use the shared components from [[ux-components]]: `CheckboxGroupRow`
(single/multi), standalone boolean toggles, `CheckboxValueRow` for the 44 induction
`checkbox_value` drugs (with a faint **engine hint ⟳** = the `MockPKEngine` recommended dose,
tappable to fill), and `StepperRow` for `number` fields. Switching modality with data entered is
a non-destructive confirm (hide, never discard — P6).

```
┌─────────────────────────────────────┐
│ ‹ Encounter     Technique      Save  │
├─────────────────────────────────────┤
│  MODALITY — choose one                │
│  ┌──────────┬───────────┬──────────┐  │
│  │ General ▲│ Neuraxial │ Periph.  │  │  single-select (segmented host)
│  └──────────┴───────────┴──────────┘  │  ▲ selected → discloses ↓ only
├─────────────────────────────────────┤
│  ┌ Ventil ▪┬ Ciclado ┬ Parám ┬ Mant ┐│  SUBSECTION pager (nested segment)
│  └─────────┴─────────┴───────┴──────┘ │
│   Técnica     ◉ AGIB  ○ AGEV  ○ TIVA │  CheckboxGroupRow (single)
│   ☑ Preoxigenación                    │  boolean toggle
│   ── Fármacos de inducción ──         │
│   ☑ Propofol      [ 120 ] mg    ⟳116 │  CheckboxValueRow + engine hint
│   ☑ Fentanilo     [ 150 ] mcg   ⟳140 │  ⟳ tap = fill recommended
│   TET Calibre     [ 7.5 ] mmDI   −  + │  StepperRow (number+unit)
└─────────────────────────────────────┘
   (Neuraxial & Peripheral field sets never mount)
```
A11y: modality control is one element with `.isSelected` per option; `CheckboxValueRow`
announces "Propofol, on, 120 milligrams, recommended 116".

### N5 — Transanesthetic Monitoring · `.monitoring` · REUSES `ChartCanvas`

**Entity:** `TransanestheticRecord` ·
[transanesthetic-record](../../../notebooks/docs/parsing-wiki/entities/transanesthetic-record.md).

The core question: **how does a clinician ENTER vitals over time?** On paper the record is a
**grid you plot dots on** (∧ systolic, ∨ diastolic, ● pulse, ◇ SpO₂, temp line) with numbered
surgical-event marks. We reproduce that *as data entry* by **inverting `ChartCanvas` from a
renderer into a plotter** — reusing its coordinate math (`xForTime`/`yForConcentration`) and
`SimulationView`'s tap/drag gesture, but **appending `VitalSample(series, timeMin, value)`**
instead of reading a solved curve. Series-selector chips pick the active lane/y-scale; **tap
to plot**, **drag to correct** (reusing `Haptics.targetSnap()` snapping), long-press/⌫ to
delete, `◉ now` sets the cursor to live elapsed time, `⚑ event` drops the next numbered marker.
A **new additive `plotSeries` draw path** draws discrete symbol markers per series; grid, axes,
cursor, coordinate map are the existing `Canvas` body. This screen stays **dark**.

```
┌─────────────────────────────────────┐  dark — this IS ChartCanvas
│ ‹ Encounter    Monitoring      Done  │
│ Series [FC ●] TAsys∧ TAdia∨ SpO₂◇ T° │  chips — active = FC
├─────────────────────────────────────┤
│150┤  ∧   ●   ∧  ●    ●               │  y = active series scale
│   │● ∨  ●        ∨   ◇   ◇  ●   ●     │
│100┤∨     ◇   ◇                  ∨     │
│ 50┤· · · · · │cursor · · · · · · · · │  scrub cursor (drawCursor reused)
│  0└──┬───┬───┬───┬───┬───┬───┬───┬── │
│     0'  15  30  45  60  75  90  105' │  x = elapsed min (xForTime reused)
│      ▲1     ▲2          ▲3           │  surgical event marks 1–6
├─────────────────────────────────────┤
│  ⌫ point    ◉ now 47'    ⚑ event   ↺ │
└─────────────────────────────────────┘
```
A11y: `.accessibilityChartDescriptor` (§2.6a) — the chart is **not** allowed to stay a mute
`Canvas`; plot actions expose `.accessibilityAdjustableAction` so VoiceOver users nudge without
the drag.

### N6 — Drug Ledger · `.drugLedger` · REUSES `MockPKEngine` TCI

**Entity:** `DrugAdministration` (many per case) ·
[drug-administration](../../../notebooks/docs/parsing-wiki/entities/drug-administration.md).

An **add-row editable table** (`EditableDrugTable`, [[ux-components]] §5) of drugs given. Its
differentiator is **two dose columns side-by-side**: **Given** (what was administered — dose +
unit + route + time) and **TCI rec. ⟳** (the engine's recommendation for *this* `PatientProfile`,
from `MockPKEngine.computeTCI/computeBET` — the `SimulationView.tciReadouts` block relocated
inline per row). A **variance chip** compares them (`statusComplete` within range, `⚠
statusPartial` when >15% off) — a soft check, never a hard block.

```
┌─────────────────────────────────────┐
│ ‹ Monitoring    Drug Ledger    ＋ Add │
│ 68 kg · LBM 49 · Marsh/Minto engine   │  PatientProfile context
├───────────────┬──────────┬──────────┤
│ Drug          │  Given   │ TCI rec. ⟳│
│ Propofol      │ 120 mg   │ 116 mg   │  ✓ within range
│  Marsh · IV   │ 08:12    │ 2.4 ml   │
│ Fentanilo     │ 150 mcg  │ 140 mcg  │  ⚠ +7% (statusPartial)
├───────────────┴──────────┴──────────┤
│ ▾ Propofol: Bolus 116 mg (2.4 ml)     │
│   [ ⟳ Use recommended ]  [ ✎ Enter ]  │
└─────────────────────────────────────┘
```
**Grounding caveat:** the audit flags the engine's Schnider-V3 10× error and unsimulated Ce
targeting; N6 *surfaces* engine output, so the recommendation column carries a "training
estimate" caveat and must not be trusted for dosing until the [[frontend-audit-2026-07-09]]
engine fixes land. A11y: each row announces "Propofol, given 120 milligrams, recommended 116,
within range".

### N7 — Fluid Balance · `.fluidBalance` · spreadsheet + live derived rows

**Entity:** `FluidBalance` ·
[fluid-balance](../../../notebooks/docs/parsing-wiki/entities/fluid-balance.md) ·
`control_fluidos` (17 rows × 5 hours = **85 cells**).

The one screen that is unapologetically a **grid** (`HourlyFluidGrid`, [[ux-components]] §4).
Editable input cells (Ingresos/Egresos) tap to a decimal keypad; **derived rows compute live,
are visually distinct (`surfaceDerived`) and read-only** — Balance parcial, Balance total
(running cumulative), Gasto urinario ml/kg/h, Tasa Fentanilo (from N6). Recompute is instant on
any edit (an `@Observable` view-model owns the math — the single source of truth). Weight comes
from `Patient` (one capture parameterises Gasto urinario — P3/P8).

```
┌──────────────┬────┬────┬────┬────┬───┐
│ Row \ Hour   │ 1h │ 2h │ 3h │ 4h │ ›│  columns scroll →
│ INGRESOS                              │
│  Cristaloide │ 500│ 500│ 250│    │  │  editable (white) → keypad
│  Coloide     │  – │ 250│  – │    │  │
│ EGRESOS                               │
│  Sangrado    │  50│ 150│ 200│    │  │
│  Diuresis    │ 100│ 120│  90│    │  │
├──────────────┼────┼────┼────┼────┼───┤
│ ▒ DERIVED (auto, read-only) ▒▒▒▒▒▒▒▒▒│  surfaceDerived tint
│  Bal.total   │+450│+930│+990│  – │  │  running cumulative
│  Gasto ml/kg │ 1.5│ 1.8│ 1.3│  – │  │  diuresis ÷ kg ÷ hr
│  Tasa Fentan.│ 0.9│ 0.9│ 0.7│  – │  │  from Drug Ledger (N6)
└──────────────┴────┴────┴────┴────┴───┘
```
A11y: `.accessibilityElement(children: .contain)`, cells row-major; derived cells announce
"…, calculated, not editable"; per-column running-balance summary.

### N8 — Recovery (Aldrete) · `.recoveryScore` · score grid + auto-sum

**Entity:** `RecoveryScore` (× time points) ·
[recovery-score](../../../notebooks/docs/parsing-wiki/entities/recovery-score.md) · Aldrete 6×6
`score` grid (36 cells).

`ScoreGridWidget` ([[ux-components]] §3): **5 scored criteria × up-to-6 time-points**, each cell
a compact **0/1/2 segmented control** (the `PatientInputView` gender-segment idiom shrunk). The
**TOTAL row is derived, read-only** (`Σ` per column in `surfaceDerived`) with a **≥9 =
dischargeable** check surfaced per column (`statusComplete`) — the clinically meaningful
threshold, not a raw number. `+ time` appends a time-point column.

```
┌────────────────┬───┬───┬───┬───┬───┬─┐
│ Criterio\Tiempo│Sal│ 0'│20'│60'│90'│›│
│ Actividad      │ 2 │ 2 │ 2 │ 2 │ 2 │ │  cell → 0/1/2 picker
│ Conciencia     │ 1 │ 1 │ 2 │ 2 │ 2 │ │
├────────────────┼───┼───┼───┼───┼───┼─┤
│ ▒ TOTAL (auto) │ 8 │ 9 │10 │10 │10 │ │  Σ criteria, surfaceDerived
│   dischargeable │ · │ ✓ │ ✓ │ ✓ │ ✓ │ │  ≥9 check (statusComplete)
└────────────────┴───┴───┴───┴───┴───┴─┘
```
A11y: each cell "Conciencia at 0 minutes, score 1 of 2, adjustable"; TOTAL "…, 9, dischargeable".

### N10 — Review & Export · `.reviewExport` · record review → form picker → PDFKit → Share

**Reads** every entity of the case; binds onto any of the four schemas via `fill-pdf`
([schema-spec](../../../notebooks/docs/parsing-wiki/schema-spec.md)). Three stacked zones:
**review → pick form(s) → preview/share** — the PDF is the **subproduct** produced *here*, at the
end. Record review is the condensed N2 status matrix; tapping an incomplete entity **jumps back**
to fix it; a banner **warns but does not block** export. The **which-form(s) picker** is the
"collect once, export to many" payoff (P8): multi-select IMSS set (`imss_p1`+`imss_p2`) / Nota set
(`nota2`+`nota21`) / individual form. **PDFKit `PDFView`** renders the selected form(s) with
values drawn into their bboxes over the **1:1 clone** by `fill-pdf` (reusing
[regen.py](../../../notebooks/forms/regen.py) / [imss_gen.py](../../../notebooks/forms/imss_gen.py)
draw calls). Share via `UIActivityViewController`.

```
┌─────────────────────────────────────┐
│ ‹ Encounter    Review & Export       │
│  RECORD REVIEW                        │
│   ✓ Patient   ◐ Preanesth.  ○ Fluids  │  tap ◐/○ → jump back to fix
│   ⚠ 2 sections incomplete — export?   │  warn, never block
│  EXPORT WHICH FORM(S)?                │  multi-select (one record → many)
│   ☑ IMSS set (imss_p1·imss_p2)        │
│   ☑ Nota set (nota2·nota21)           │
│  ┌ PDFKit preview — filled clone ┐    │  PDFView: values in bboxes
│  │        page 1 / 4             │    │
│  └──────────────────────────────┘    │
│    ◀ 1/4 ▶     ⤴ Share    ⤓ Save PDF │  PDF = subproduct
└─────────────────────────────────────┘
```
A11y: review dots are labelled elements; `PDFView` inherits PDFKit's VoiceOver, plus a text
summary "Nota postanestésica, 4 pages, 6 of 8 sections filled".

---

## Sources & cross-links

- **App idioms:** `PharmaApp/Utilities/StepperRow.swift` (48 pt targets, hold-to-accelerate,
  `Haptics.tap()`), `PharmaApp/Utilities/DesignSystem.swift` (`AppColors`/`Font`/`Haptics`/`Spacing`),
  `PharmaApp/Views/PatientInput/PatientInputView.swift` (`compactStepperButton` 40 pt, `genderRow`
  segmented, live `AppState` binding), `PharmaApp/Views/Simulation/{SimulationView,ChartCanvas}.swift`
  (segmented host, chart coords, tap/drag, `tciReadouts`), `PharmaApp/Engine/MockPKEngine.swift`.
- **Plans & pages:** [[proposed-screens]], [[field-inventory]], [[forms-to-app]], [[ux-components]],
  [[design-system-build]], [[screens]], [[state-navigation]], [[input-screens]],
  [[simulation-screen]], [[compartmental-screen]], [[models]], [[pk-engine-math]], [[architecture]],
  [[frontend-audit-2026-07-09]].
- **Notebooks:** [model.md](../../../notebooks/docs/parsing-wiki/entities/model.md),
  [anesthetic-technique.md](../../../notebooks/docs/parsing-wiki/entities/anesthetic-technique.md),
  [transanesthetic-record.md](../../../notebooks/docs/parsing-wiki/entities/transanesthetic-record.md),
  [drug-administration.md](../../../notebooks/docs/parsing-wiki/entities/drug-administration.md),
  [fluid-balance.md](../../../notebooks/docs/parsing-wiki/entities/fluid-balance.md),
  [recovery-score.md](../../../notebooks/docs/parsing-wiki/entities/recovery-score.md),
  [schema-spec.md](../../../notebooks/docs/parsing-wiki/schema-spec.md), the four schemas under
  [`notebooks/forms/schema/`](../../../notebooks/forms/schema/nota2.schema.json), and the fill-pdf
  renderers [regen.py](../../../notebooks/forms/regen.py) / [imss_gen.py](../../../notebooks/forms/imss_gen.py).
</content>
</invoke>
