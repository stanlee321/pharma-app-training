import SwiftUI

/// A ± repeat button with hold-to-accelerate, extracted from `StepperRow`.
/// Fires `onStep` on tap AND on every accelerated tick (with haptics each time — the
/// original inlined loop was silent on accel). Frame is ≥ `Spacing.tapTarget` (HIG).
struct AcceleratingRepeatButton: View {
    let systemName: String
    let onStep: () -> Void

    @State private var task: Task<Void, Never>?

    var body: some View {
        Button {
            onStep()
            Haptics.tap()
        } label: {
            Image(systemName: systemName)
                .font(.body.weight(.medium))
                .frame(width: Spacing.tapTarget, height: Spacing.tapTarget)
                .background(AppColors.fieldFill)
                .clipShape(RoundedRectangle(cornerRadius: 10))
                .overlay(
                    RoundedRectangle(cornerRadius: 10)
                        .stroke(AppColors.controlStroke, lineWidth: 0.5)
                )
        }
        .buttonStyle(.plain)
        .simultaneousGesture(
            LongPressGesture(minimumDuration: 0.3).onEnded { _ in start() }
        )
        .onLongPressGesture(minimumDuration: .infinity, pressing: { pressing in
            if !pressing { stop() }
        }, perform: {})
    }

    private func start() {
        stop()
        task = Task {
            func tick() { onStep(); Haptics.tap() }
            for _ in 0..<5 {
                guard !Task.isCancelled else { return }
                try? await Task.sleep(for: .milliseconds(150))
                await MainActor.run { tick() }
            }
            for _ in 0..<10 {
                guard !Task.isCancelled else { return }
                try? await Task.sleep(for: .milliseconds(80))
                await MainActor.run { tick() }
            }
            while !Task.isCancelled {
                try? await Task.sleep(for: .milliseconds(50))
                await MainActor.run { tick() }
            }
        }
    }

    private func stop() {
        task?.cancel()
        task = nil
    }
}
