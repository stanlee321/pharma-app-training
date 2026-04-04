import SwiftUI

/// Floating tooltip showing exact values at the cursor time position.
struct DataTooltip: View {
    let point: CurvePoint
    let concentrationUnit: String
    let timeString: String

    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(timeString)
                .font(.caption2.bold())
                .foregroundStyle(.white.opacity(0.7))

            HStack(spacing: 6) {
                Circle().fill(.cyan).frame(width: 6, height: 6)
                Text("Cp")
                    .font(.caption2)
                    .foregroundStyle(.white.opacity(0.6))
                Text(formatConc(point.plasmaConcentration))
                    .font(.caption.monospacedDigit())
                    .foregroundStyle(.cyan)
            }

            HStack(spacing: 6) {
                Circle().fill(.green).frame(width: 6, height: 6)
                Text("Ce")
                    .font(.caption2)
                    .foregroundStyle(.white.opacity(0.6))
                Text(formatConc(point.effectConcentration))
                    .font(.caption.monospacedDigit())
                    .foregroundStyle(.green)
            }

            HStack(spacing: 6) {
                Circle().fill(.orange).frame(width: 6, height: 6)
                Text("Rate")
                    .font(.caption2)
                    .foregroundStyle(.white.opacity(0.6))
                Text(String(format: "%.1f ml/hr", point.infusionRate * 60))
                    .font(.caption.monospacedDigit())
                    .foregroundStyle(.orange)
            }
        }
        .padding(8)
        .background(.black.opacity(0.85), in: RoundedRectangle(cornerRadius: 8))
        .overlay(
            RoundedRectangle(cornerRadius: 8)
                .stroke(.white.opacity(0.2), lineWidth: 0.5)
        )
    }

    private func formatConc(_ v: Double) -> String {
        if v >= 100 { return String(format: "%.0f %@", v, concentrationUnit) }
        if v >= 1 { return String(format: "%.2f %@", v, concentrationUnit) }
        return String(format: "%.3f %@", v, concentrationUnit)
    }
}
