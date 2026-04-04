# P1: Navigation & Discoverability

## Current Issues

**1. Compartmental View is Hidden**

The only way to access the compartmental view is via a small `cube.transparent` SF Symbol icon in the simulation toolbar. No label, no tooltip. A first-time user won't know:
- That the icon exists
- What it does
- Why they'd want to go there

In the reference app, the compartmental view seems to be accessed more prominently (possibly a dedicated tab or a larger button).

### Fix Options

**Option A: Segmented Control at the top**
```
[ Graph ]  [ Compartments ]
```
A segmented picker at the top of the simulation screen that switches between the chart view and compartmental view. Both views stay within the same screen context.

**Option B: Floating Action Button**
A more prominent button labeled with an icon + text:
```
[🧊 3D View]
```
Positioned at a corner of the chart area.

**Option C: Swipe gesture**
Swipe left on the simulation screen to reveal the compartmental view (like a page). Swipe right to go back. Add a page indicator.

**Recommendation:** Option A (segmented control) is the most discoverable and matches iOS conventions.

**2. "< Patient" Button on Dark Background**

The back button on the simulation screen uses white text on black, which looks fine, but it says "< Patient" which is unclear. Should say "< Back" or use the system back button style.

Fix: Use the system navigation back button or style it as:
```swift
Button {
    navigationPath.removeLast()
} label: {
    HStack(spacing: 4) {
        Image(systemName: "chevron.left")
        Text("Back")
    }
    .foregroundStyle(.blue)
}
```

**3. No Way to Return to Drug Selection from Simulation**

Once in the simulation view, the only back button goes to Patient Input. To change the drug, you need to go back twice. Consider a long-press on the drug name in the toolbar to jump directly to drug selection.

**4. Launch Modal Doesn't Appear**

The launch modal has `@AppStorage` persistence. Once dismissed, it never shows again for the same announcement version. This is correct behavior, but during development you may want a way to reset it (Settings or debug menu).

**5. Dark/Light Theme Transition**

The transition from light screens (drug selection, patient input) to dark (simulation) is abrupt. Consider:
- Animating the transition with a fade
- Or using `.preferredColorScheme(.dark)` on the simulation/compartmental screens so the status bar matches

Fix:
```swift
SimulationView(...)
    .preferredColorScheme(.dark)
```

**6. No Tab Bar / Mode Selector**

The reference app has a "Manual" mode label visible in the simulation view, suggesting there could be other modes. Consider planning for:
- Manual mode (current)
- TCI Auto mode (future)
- Review mode (view saved simulations)

Even if only Manual is available now, the UI should hint at the possibility.

## Implementation Priority

1. Segmented control for Graph ↔ Compartments (biggest discoverability win)
2. `.preferredColorScheme(.dark)` for simulation screens
3. System-style back button
4. Drug name tap → jump to drug selection
