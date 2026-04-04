# P0: Target Node Interaction Redesign

## Problem

The target node is the most important interaction in the entire app — it's how the doctor sets the drug concentration target. Currently:

1. **Undiscoverable.** There's no visual hint that you can tap the chart. A first-time user sees an empty black chart and has no idea what to do.
2. **No initial target.** The chart starts completely empty (all zeros). The reference app starts with curves already visible.
3. **Tap-then-drag confusion.** You must tap to place the node, then drag vertically. But tapping also moves the cursor horizontally, so the node appears at an unexpected position.
4. **Hard to grab.** The 20px blue circle is small for a finger target (Apple HIG says 44pt minimum). On the dark chart, it's easy to miss.
5. **No persistent target line.** After confirming a target, there's no horizontal dashed line showing where the target IS. You lose context.

## Solution

### A. Onboarding State (Empty Chart)

When the simulation view loads with no targets:

```
┌─────────────────────────────────────┐
│                                     │
│          Tap chart to set           │
│          target concentration       │
│                ↕                    │
│          [Drag up/down]             │
│                                     │
└─────────────────────────────────────┘
```

- Show a pulsing ghost node at the center of the chart with instructional text
- OR auto-set a default target (e.g., 4 mcg/ml for Propofol) so curves appear immediately
- The reference app seems to always start with a default target

### B. Target Node Improvements

- **Larger touch target:** 44pt invisible hit area around the 20pt visible circle
- **Glow effect:** Animated outer glow ring when the node is active/draggable
- **Horizontal target line:** Dashed line extending from the node across the full chart width, showing the exact target level
- **Snap feedback:** Haptic tap when crossing round-number thresholds (0.5, 1.0, 2.0, etc.)
- **Value label pinned to node:** Small text label directly attached to the node showing the current concentration value as you drag

### C. Two-Phase Interaction

**Phase 1: Place cursor** — horizontal drag/tap positions the TIME cursor (where in the timeline you're adding the target)

**Phase 2: Set target** — tap the node handle (or a dedicated "Set Target" button) to enter vertical drag mode

This separates the two gestures so they don't conflict.

### D. Persistent Target Markers

After a target is confirmed, show:
- Small triangle/diamond marker on the X-axis at the target time
- Horizontal dashed line at the target concentration level (fades after a few seconds or toggleable)
- The reference app clearly shows where each target was set

### E. "Set Target" Button Alternative

Add a prominent floating button: `[ + Set Target ]` that appears when no target interaction is active. Tapping it enters target mode with the node centered at a sensible default.

## Implementation Priority

1. Default initial target so chart isn't empty (quick win)
2. Larger touch target + glow effect
3. Horizontal target line
4. Value label on node
5. Haptic feedback
6. Onboarding hint animation
