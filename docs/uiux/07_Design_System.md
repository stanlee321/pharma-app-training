# P2: Typography & Color System

## Current State

The app uses default SwiftUI fonts and ad-hoc colors. There's no consistent design system. This leads to:
- Inconsistent font sizes across screens
- Colors chosen per-component rather than from a palette
- No dark-mode-aware semantic colors for the light screens

## Proposed Color Palette

### Curve Colors (Dark Background)
| Curve | Color | Hex | Usage |
|-------|-------|-----|-------|
| Plasma (Cp) | Cyan | `#00D4FF` | Primary concentration curve |
| Effect (Ce) | Green | `#4ADE80` | Effect-site concentration |
| Infusion Rate | Orange | `#FB923C` | Right Y-axis, filled area |
| Target Node | Blue | `#3B82F6` | Draggable node, cursor line |
| Target Line | Blue dashed | `#3B82F680` | Horizontal target level |

### Compartment Colors
| Compartment | Fluid Color | Hex |
|-------------|------------|-----|
| V1 (Central) | Red | `#EF4444` |
| V2 (Rapid peripheral) | Cyan | `#22D3EE` |
| V3 (Slow peripheral) | Teal | `#14B8A6` |
| Effect site | Green | `#4ADE80` |
| Clearance | Gray | `#6B7280` |

### UI Colors
| Element | Light Theme | Dark Theme |
|---------|------------|------------|
| Background | `.systemGroupedBackground` | Pure black `#000000` |
| Card | `.systemBackground` | `#1C1C1E` |
| Primary text | `.label` | White |
| Secondary text | `.secondaryLabel` | White 60% |
| Accent | System Blue | System Blue |
| Separator | `.separator` | White 10% |

## Typography Scale

```swift
extension Font {
    // Drug name (hero text)
    static let drugTitle = Font.title2.bold()
    // Model name
    static let modelName = Font.title3
    // Section headers
    static let sectionHeader = Font.headline
    // Body text (metadata, comments)
    static let bodyText = Font.body
    // Numeric values (concentrations, rates)
    static let numericValue = Font.system(.body, design: .monospaced).bold()
    // Small numeric (axis labels, timestamps)
    static let axisLabel = Font.system(size: 10, design: .monospaced)
    // Tiny labels (units, secondary info)
    static let unitLabel = Font.caption2
}
```

## Spacing Constants

```swift
enum Spacing {
    static let screenPadding: CGFloat = 16
    static let sectionGap: CGFloat = 20
    static let itemGap: CGFloat = 12
    static let tightGap: CGFloat = 4
    static let chartMarginLeft: CGFloat = 45
    static let chartMarginRight: CGFloat = 45
    static let chartMarginTop: CGFloat = 16
    static let chartMarginBottom: CGFloat = 28
}
```

## Haptic Feedback

Define standard haptics:
```swift
enum Haptics {
    static func tap() { UIImpactFeedbackGenerator(style: .light).impactOccurred() }
    static func targetSnap() { UIImpactFeedbackGenerator(style: .medium).impactOccurred() }
    static func confirm() { UINotificationFeedbackGenerator().notificationOccurred(.success) }
    static func error() { UINotificationFeedbackGenerator().notificationOccurred(.error) }
}
```

Use at:
- Target node crossing round thresholds → `targetSnap()`
- "Done" confirming target → `confirm()`
- Stepper button taps → `tap()`
- Validation out-of-range → `error()`

## Implementation

Create `PharmaApp/Utilities/DesignSystem.swift` containing all the above constants. Reference them consistently across all views instead of inline values.
