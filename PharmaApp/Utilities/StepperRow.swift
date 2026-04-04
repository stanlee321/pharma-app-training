import SwiftUI

/// A labeled numeric row with [-] [+] buttons that accelerate on long press.
struct StepperRow: View {
    let label: String
    @Binding var value: Double
    let unit: String
    let step: Double
    let range: ClosedRange<Double>
    let format: String

    @State private var timerTask: Task<Void, Never>?

    var body: some View {
        HStack(spacing: 0) {
            Text(label)
                .frame(width: 70, alignment: .leading)

            Spacer()

            Text(String(format: format, value))
                .font(.system(.body, design: .monospaced).bold())
                .frame(width: 70, alignment: .trailing)
                .contentTransition(.numericText())

            Text(unit)
                .foregroundStyle(.secondary)
                .frame(width: 45, alignment: .leading)
                .padding(.leading, 4)

            Spacer()

            // Minus
            stepButton(systemName: "minus", delta: -step)

            // Plus
            stepButton(systemName: "plus", delta: step)
                .padding(.leading, 8)
        }
        .padding(.horizontal, Spacing.screen)
        .padding(.vertical, 6)
    }

    private func stepButton(systemName: String, delta: Double) -> some View {
        Button {
            adjust(by: delta)
            Haptics.tap()
        } label: {
            Image(systemName: systemName)
                .font(.body.weight(.medium))
                .frame(width: 48, height: 48)
                .background(Color(.systemGray5))
                .clipShape(RoundedRectangle(cornerRadius: 10))
                .overlay(
                    RoundedRectangle(cornerRadius: 10)
                        .stroke(Color(.systemGray4), lineWidth: 0.5)
                )
        }
        .buttonStyle(.plain)
        .simultaneousGesture(
            LongPressGesture(minimumDuration: 0.3)
                .onEnded { _ in
                    startAccelerating(delta: delta)
                }
        )
        .onLongPressGesture(minimumDuration: .infinity, pressing: { pressing in
            if !pressing { stopAccelerating() }
        }, perform: {})
    }

    private func adjust(by delta: Double) {
        withAnimation(.snappy(duration: 0.15)) {
            value = (value + delta).clamped(to: range)
        }
    }

    private func startAccelerating(delta: Double) {
        stopAccelerating()
        timerTask = Task {
            for _ in 0..<5 {
                guard !Task.isCancelled else { return }
                try? await Task.sleep(for: .milliseconds(150))
                await MainActor.run { adjust(by: delta) }
            }
            for _ in 0..<10 {
                guard !Task.isCancelled else { return }
                try? await Task.sleep(for: .milliseconds(80))
                await MainActor.run { adjust(by: delta) }
            }
            while !Task.isCancelled {
                try? await Task.sleep(for: .milliseconds(50))
                await MainActor.run { adjust(by: delta * 5) }
            }
        }
    }

    private func stopAccelerating() {
        timerTask?.cancel()
        timerTask = nil
    }
}
