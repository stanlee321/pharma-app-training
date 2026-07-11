import SwiftUI

// MARK: - SectionHeader (uppercase caption + optional icon), from PatientInputView idiom

struct SectionHeader: View {
    let title: String
    var systemImage: String? = nil

    var body: some View {
        HStack(spacing: Spacing.tight) {
            if let systemImage {
                Image(systemName: systemImage)
                    .font(.caption)
                    .foregroundStyle(AppColors.selectionTint)
            }
            Text(title.uppercased())
                .font(.caption2.bold())
                .tracking(0.5)
                .foregroundStyle(.secondary)
            Spacer()
        }
    }
}

// MARK: - CardStyle

struct CardStyle: ViewModifier {
    func body(content: Content) -> some View {
        content
            .padding(Spacing.item)
            .background(Color(.secondarySystemBackground), in: RoundedRectangle(cornerRadius: 14))
    }
}

extension View {
    func cardStyle() -> some View { modifier(CardStyle()) }
}

// MARK: - LabeledTextRow (label + trailing text field + optional unit)

/// Editable label + value row. IMPORTANT: do NOT wrap this in
/// `.accessibilityElement(children: .combine)` — combine flattens the row into one element and
/// **swallows the TextField's keyboard input** (the field focuses but won't accept text). Combine is
/// only safe on read-only rows.
struct LabeledTextRow: View {
    let label: String
    @Binding var text: String
    var placeholder: String = ""
    var unit: String? = nil
    var keyboard: UIKeyboardType = .default

    var body: some View {
        HStack {
            Text(label).foregroundStyle(.secondary)
            Spacer()
            TextField(placeholder, text: $text)
                .multilineTextAlignment(.trailing)
                .keyboardType(keyboard)
            if let unit {
                Text(unit).font(.caption).foregroundStyle(.tertiary)
            }
        }
        .frame(minHeight: Spacing.tapTarget)
    }
}

// MARK: - CheckboxGroupRow (single/multi-select chips), generalized from genderButton

struct CheckboxGroupRow: View {
    let title: String
    let options: [String]
    var multiSelect: Bool = false
    @Binding var selection: Set<String>

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.tight) {
            SectionHeader(title: title)
            LazyVGrid(
                columns: [GridItem(.adaptive(minimum: 72), spacing: Spacing.tight)],
                alignment: .leading,
                spacing: Spacing.tight
            ) {
                ForEach(options, id: \.self) { opt in
                    chip(opt)
                }
            }
        }
    }

    private func chip(_ opt: String) -> some View {
        let on = selection.contains(opt)
        return Button {
            toggle(opt)
            Haptics.tap()
        } label: {
            Text(opt)
                .font(.subheadline)
                .padding(.horizontal, Spacing.item)
                .frame(maxWidth: .infinity, minHeight: Spacing.tapTarget)
                .background(on ? AppColors.selectionTint : AppColors.fieldFill, in: Capsule())
                .foregroundStyle(on ? Color.white : Color.primary)
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(on ? [.isButton, .isSelected] : .isButton)
    }

    private func toggle(_ opt: String) {
        if multiSelect {
            if selection.contains(opt) { selection.remove(opt) } else { selection.insert(opt) }
        } else {
            if selection.contains(opt) { selection.removeAll() } else { selection = [opt] }
        }
    }
}
