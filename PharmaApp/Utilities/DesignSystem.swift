import SwiftUI

// MARK: - Color Palette

enum AppColors {
    // Curve colors (dark background)
    static let plasma = Color(red: 0, green: 0.83, blue: 1)        // #00D4FF cyan
    static let effect = Color(red: 0.29, green: 0.87, blue: 0.50)  // #4ADE80 green
    static let infusion = Color(red: 0.98, green: 0.57, blue: 0.24) // #FB923C orange
    static let target = Color(red: 0.23, green: 0.51, blue: 0.96)  // #3B82F6 blue
    static let targetDashed = Color(red: 0.23, green: 0.51, blue: 0.96).opacity(0.4)

    // Compartment fluid colors
    static let v1Fluid = Color(red: 0.94, green: 0.27, blue: 0.27)  // #EF4444 red
    static let v2Fluid = Color(red: 0.13, green: 0.83, blue: 0.93)  // #22D3EE cyan
    static let v3Fluid = Color(red: 0.08, green: 0.72, blue: 0.65)  // #14B8A6 teal
    static let effectFill = Color(red: 0.29, green: 0.87, blue: 0.50)
    static let clearance = Color(red: 0.42, green: 0.45, blue: 0.50) // #6B7280

    // UI surfaces
    static let darkBg = Color.black
    static let darkCard = Color(red: 0.11, green: 0.11, blue: 0.12) // #1C1C1E
    static let gridLine = Color.white.opacity(0.12)
    static let gridLineMajor = Color.white.opacity(0.2)
    static let axisText = Color.white.opacity(0.6)
}

// MARK: - Typography

extension Font {
    static let drugTitle = Font.title2.bold()
    static let modelName = Font.title3
    static let sectionHeader = Font.headline
    static let numericValue = Font.system(.body, design: .monospaced).bold()
    static let axisLabel = Font.system(size: 10, design: .monospaced)
    static let tinyLabel = Font.caption2
}

// MARK: - Haptics

enum Haptics {
    static func tap() {
        UIImpactFeedbackGenerator(style: .light).impactOccurred()
    }
    static func targetSnap() {
        UIImpactFeedbackGenerator(style: .medium).impactOccurred()
    }
    static func confirm() {
        UINotificationFeedbackGenerator().notificationOccurred(.success)
    }
}

// MARK: - Spacing

enum Spacing {
    static let screen: CGFloat = 16
    static let section: CGFloat = 20
    static let item: CGFloat = 12
    static let tight: CGFloat = 4
}
