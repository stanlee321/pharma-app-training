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
        HStack {
            Text(label)
                .frame(width: 80, alignment: .leading)

            Text(String(format: format, value))
                .frame(width: 80)
                .monospacedDigit()

            Text(unit)
                .foregroundStyle(.secondary)
                .frame(width: 50, alignment: .leading)

            Spacer()

            // Minus button
            stepButton(systemName: "minus", delta: -step)

            // Plus button
            stepButton(systemName: "plus", delta: step)
        }
        .padding(.horizontal, 16)
    }

    private func stepButton(systemName: String, delta: Double) -> some View {
        Button {
            adjust(by: delta)
        } label: {
            Image(systemName: systemName)
                .frame(width: 44, height: 44)
                .background(Color(.systemGray5))
                .clipShape(RoundedRectangle(cornerRadius: 8))
        }
        .buttonStyle(.plain)
        .simultaneousGesture(
            LongPressGesture(minimumDuration: 0.3)
                .onEnded { _ in
                    startAccelerating(delta: delta)
                }
        )
        .onLongPressGesture(minimumDuration: .infinity, pressing: { pressing in
            if !pressing {
                stopAccelerating()
            }
        }, perform: {})
    }

    private func adjust(by delta: Double) {
        let newValue = value + delta
        value = newValue.clamped(to: range)
    }

    private func startAccelerating(delta: Double) {
        stopAccelerating()
        timerTask = Task {
            // Phase 1: slow (every 150ms, step x1)
            for _ in 0..<5 {
                guard !Task.isCancelled else { return }
                try? await Task.sleep(for: .milliseconds(150))
                await MainActor.run { adjust(by: delta) }
            }
            // Phase 2: medium (every 80ms, step x1)
            for _ in 0..<10 {
                guard !Task.isCancelled else { return }
                try? await Task.sleep(for: .milliseconds(80))
                await MainActor.run { adjust(by: delta) }
            }
            // Phase 3: fast (every 50ms, step x5)
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
