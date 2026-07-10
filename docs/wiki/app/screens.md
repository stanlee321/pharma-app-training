---
type: page
updated: 2026-07-09
tags: [app, screens, navigation]
---

# Screens

> **Updated 2026-07-10 — the app now has a clinical-record spine.** It is re-rooted at a mock
> login → **Encounter List → Encounter Hub → clinical section screens** (built Phase A+B; see
> [[clinical-record]] and [[screens-index]]). The **5 screens below are the original pharmacology
> app**, now **recyclable tools** rather than the app's spine. This page still maps them; the new
> spine is documented in [[clinical-record]].

The original pharmacology app has **5 screens**. Navigation is a single `NavigationStack` in
`RootView` driven by the `Route` enum (`PharmaApp/App/Route.swift`), plus one modal overlay. This
page is the map; the deep detail lives in the per-area pages and [[state-navigation]].

## Inventory

| # | Screen | `Route` case | View / ViewModel | Presentation | Status (see [[frontend-audit-2026-07-09|audit]]) |
|---|---|---|---|---|---|
| 1 | **Launch Modal** | — (no route) | `LaunchModalView` / none | `.overlay` on `RootView`, gated on `@AppStorage("hasSeenAnnouncement_v1")` | STUB — external links point at `example.com` |
| 2 | **Drug & Model Selection** | `.drugSelection` (also the stack **root**) | `DrugSelectionView` / none — reads `@Environment(AppState.self)` directly | pushed / root | DONE — "Edit Drug List" & "Saved Simulations" buttons are empty closures |
| 3 | **Patient Data Input** | `.patientInput` | `PatientInputView` / none — writes `AppState.patient` | pushed | DONE — hold-to-accelerate stepper wired only to dilution |
| 4 | **Simulation Graph** | `.simulation` | `SimulationView` / `SimulationViewModel` | pushed; **hosts a `[Graph] [Compartments]` segmented control** | DONE — playback Task leak; Ce targeting not simulated; racing re-runs |
| 5 | **Compartmental Animation** | `.compartmental` | `CompartmentalView` / `CompartmentalViewModel` | **two ways**: pushed full-screen (`embedded: false`) **and** embedded as the Compartments tab inside `SimulationView` (`CompartmentalView()`) | 3D DONE (per-frame SceneKit churn); 2D PARTIAL (particles frozen outside scrubbing) |

Only **two** view-models exist (`SimulationViewModel`, `CompartmentalViewModel`);
screens 1–3 have none. **Drift vs docs:** the README/TODO planning docs list a
`DrugSelectionViewModel`, but no such file exists — `DrugSelectionView` uses `AppState`
directly (`DrugSelectionView.swift:5`).

## Navigation flow

```
 RootView (NavigationStack, root = DrugSelectionView)
   └─ overlay: Launch Modal ── first run only (AppStorage gate)

 Drug Selection ──▶ Patient Input ──▶ Simulation ──┐
   (.drugSelection)   (.patientInput)   (.simulation) │ segmented control
                                                      ├─ Graph  (ChartCanvas)
                                                      └─ Compartments (embedded CompartmentalView)

 Compartmental can ALSO be pushed full-screen via the .compartmental route (embedded:false).
```

## Presentation models (3 kinds — mind the difference)

- **Pushed destination** — screens 2–4 are `Route` cases resolved by
  `RootView`'s single `.navigationDestination(for: Route.self)`. They receive the
  `$navigationPath` binding and push the next route themselves.
- **Overlay** — the Launch Modal is *not* a route; it's a `.overlay` toggled by
  `@State showLaunchModal`, persisted via `@AppStorage`. See [[state-navigation]].
- **Embedded** — `CompartmentalView` has an `embedded` flag: `embedded: false` is the
  pushed full screen (no `navigationPath`), while the default `CompartmentalView()` is
  the inline tab inside `SimulationView`. See [[compartmental-screen]].

## Adding / evolving a screen (checklist)

When the upcoming tasks add or restructure screens, touch these in order:

1. **`Route.swift`** — add a `case` (must stay `Hashable`).
2. **`RootView.swift`** — add a branch in the `.navigationDestination(for: Route.self)`
   switch; thread `$navigationPath` if the screen pushes onward.
3. **The view file** under `PharmaApp/Views/<Area>/` — read shared state via
   `@Environment(AppState.self)`; add a `ViewModel` only if it owns non-trivial
   screen-local logic (follow `SimulationViewModel`'s `@MainActor @Observable` shape).
4. **Push from the parent** with `navigationPath.append(.newCase)`.
5. **Styling** via [[design-system-build|DesignSystem]] tokens, not literals.
6. Update this page + the relevant screen page + [[index]] + [[log]] (the wiki ingest
   workflow in [[SCHEMA]]).

## Where each screen is documented in depth

- Screens 1–3 (Launch Modal, Drug Selection, Patient Input) → [[input-screens]]
- Screen 4 (Simulation Graph) → [[simulation-screen]]
- Screen 5 (Compartmental) → [[compartmental-screen]]
- Boot, `AppState`, `Route`, the launch gate → [[state-navigation]]
- The whole system → [[architecture]]
