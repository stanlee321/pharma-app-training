# P2: Patient Input Screen Polish

## Current State (from recording frames 14-15)

### What works well
- Clean layout matching the reference
- Drug name and preparation recipe displayed
- Stepper buttons functional
- Gender toggle works (Male/Female tap to switch)
- Validation clamping works

### What needs improvement

**1. Stepper Button Styling**

Currently plain system gray rectangles with SF Symbol minus/plus. The reference app has more distinctive bordered stepper buttons.

Fix: Add a subtle border, slightly larger touch target, and consider using the system `Stepper` look:
```swift
Image(systemName: "minus")
    .frame(width: 48, height: 48)
    .background(Color(.systemGray6))
    .clipShape(RoundedRectangle(cornerRadius: 10))
    .overlay(RoundedRectangle(cornerRadius: 10).stroke(Color(.systemGray4), lineWidth: 0.5))
```

**2. Value Display Alignment**

The values (71, 170, 40) and units (Kg, cm, yr) are not perfectly aligned. The numbers should be right-aligned in a fixed-width column.

Fix: Use `.frame(width: 60, alignment: .trailing)` for value text with `.monospacedDigit()`.

**3. Dilution Row Formatting**

For Dexmedetomidine, the dilution shows "0.0060" which has too many decimal places. The format should adapt per drug.

Fix: Already handled in the code but verify the display format matches the drug's typical range.

**4. Section Headers**

"Patient data" header could be more visually distinct — consider using a `.listSectionHeader` style or a colored accent.

**5. Gender Row Inconsistency**

Gender shows as tappable blue text but doesn't have the same row structure as other fields (no stepper buttons, just a tappable word). This is correct per the reference but could benefit from a subtle background highlight or a toggle control to make it clearer it's interactive.

**6. Long-Press Acceleration Feedback**

When holding a stepper button, there's no visual feedback that acceleration has kicked in. Consider:
- Haptic feedback at each speed-up threshold
- The value text briefly highlighting or pulsing when rapid-incrementing

## Implementation Priority

1. Value alignment with monospaced digits
2. Stepper button border styling
3. Haptic feedback during acceleration
4. Adaptive dilution format
