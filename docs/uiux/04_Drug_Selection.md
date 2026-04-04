# P1: Drug Selection Screen Redesign

## Current Issues (from recording frames 16-20)

### What works
- Picker wheel scrolls and updates metadata
- Metadata content is correct (description, publication, comment)
- Publication URL is tappable
- Bottom toolbar present

### What needs improvement

**1. Metadata Section Looks Flat**

Currently a plain VStack with basic Text views. The reference app has a more card-like structured layout with:
- Bold section labels ("Description:", "Publication:", "Comment:")  
- Clear visual hierarchy
- Separator lines between sections

Fix: Use grouped inset list style or card sections:
```swift
VStack(alignment: .leading, spacing: 16) {
    Section("Description") { ... }
    Divider()
    Section("Publication") { ... }
    Divider()
    Section("Comment") { ... }
}
```

**2. Drug Name / Model Name Sizing**

Currently both are at the top in different font sizes but lack visual weight. The reference shows the drug name very prominently.

Fix: Drug name in `.title` bold, model name in `.title3` with `.secondary` color. Add a colored accent bar or icon per drug type.

**3. Picker Wheel Performance**

SwiftUI's `.wheel` picker works but may not be as smooth as `UIPickerView`. For rapid scrolling, consider wrapping `UIPickerView` in `UIViewRepresentable` for native performance.

**4. No Visual Drug Differentiation**

All drugs look the same in the picker. The reference app doesn't differentiate either, but it would be a nice enhancement to add:
- Color dot per drug family (blue for Propofol, green for opioids, orange for Dex)
- Or an icon

**5. "SELECT 1" Button Styling**

Currently a plain text button. The reference shows it in a more prominent rounded style.

Fix: Use `.borderedProminent` style or a custom capsule button.

**6. Empty Space**

When metadata is short (e.g., Marsh with "Comment: None"), there's a large empty area. Consider using the space for additional info or reducing the metadata area dynamically.

## Implementation Priority

1. Structured metadata with section headers and dividers
2. Drug/model name visual hierarchy
3. SELECT 1 button prominence
4. UIPickerView for smoother scrolling (if needed)
