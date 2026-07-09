# P1: Simulation Chart Polish

## Current Issues (from recording frames 21-23)

### What works
- Dual Y-axes are visible and labeled
- Curves render correctly (cyan Cp, green Ce)
- Grid lines present
- Tooltip shows all three values (Cp, Ce, Rate)
- TCI readouts appear during target drag
- Play/pause and speed controls work

### What needs improvement

**1. Infusion Rate Curve Barely Visible**

The orange infusion rate curve is very thin and nearly invisible against the dark background. In the reference, infusion rate is shown as a **filled area** or a much thicker line.

Fix: Draw infusion rate as a semi-transparent filled area under the curve:
```
context.fill(infusionAreaPath, with: .color(.orange.opacity(0.15)))
context.stroke(infusionLinePath, with: .color(.orange), lineWidth: 2)
```

**2. Right Y-Axis Labels Hard to Read**

The orange text for infusion rate axis is very subtle. Needs more contrast.

Fix: Use `.orange.opacity(0.8)` instead of `0.6`, and slightly larger font.

**3. Grid Lines Too Subtle**

The 0.1 opacity grid lines vanish on the OLED black background.

Fix: Use `0.15` opacity and consider adding slightly brighter lines at major intervals (e.g., every 1.0 mcg/ml gets `0.2` opacity, subdivisions get `0.1`).

**4. No Curve Legend**

There's no inline legend on the chart itself. The reference app shows curve labels directly on the curves or in a compact legend. Our tooltip is at the bottom but there's nothing on the chart itself.

Fix: Add small inline labels at the right edge of each curve:
```
"Cp" label at the right end of the cyan curve
"Ce" label at the right end of the green curve
```

**5. Tooltip Position**

The tooltip is fixed at the bottom-left. The reference app has a floating tooltip that follows the cursor horizontally.

Fix: Position the tooltip near the cursor X position, offset slightly to avoid finger occlusion. When cursor is on the right half, tooltip goes left of cursor, and vice versa.

**6. X-Axis Time Format**

Currently shows minutes as "10, 20, 30..." which is correct, but the reference also shows minor gridlines at 5-minute intervals.

Fix: Add minor gridlines at half the major interval.

**7. Concentration Value Format in Status Dashboard**

Currently shows `0.0060 ng/ml` — too many decimal places for clinical use. Should adapt to the drug's typical range.

Fix: For mcg/ml drugs: `"%.2f"`, for ng/ml drugs: `"%.3f"` when > 0.1, `"%.4f"` when < 0.1.

## Visual Reference (from our recording)

Frame 21 — empty chart:
- Y-axis: 0.20, 0.40, 0.60, 0.80, 1.0 (good spacing)
- Right Y-axis: 0.50, 1.0 (only two labels — needs more)
- Grid: visible but faint

Frame 23 — with curves:
- Cyan (Cp) and green (Ce) clearly distinguishable
- Step-up / step-down targets visible
- Infusion rate barely visible (orange on black)

## Implementation Priority

1. Infusion rate as filled area (biggest visual impact)
2. Floating tooltip that follows cursor
3. Inline curve labels (Cp, Ce)
4. Grid line contrast improvement
5. Adaptive concentration formatting
