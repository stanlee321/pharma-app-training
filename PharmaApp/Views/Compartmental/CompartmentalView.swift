import SwiftUI

struct CompartmentalView: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(AppState.self) private var appState
    @State private var vm: CompartmentalViewModel?
    var embedded: Bool = true

    var body: some View {
        Group {
            if let vm {
                content(vm: vm)
            } else {
                Color.black.ignoresSafeArea()
            }
        }
        .onAppear {
            if vm == nil {
                vm = CompartmentalViewModel(appState: appState)
            }
        }
    }

    private func content(vm: CompartmentalViewModel) -> some View {
        VStack(spacing: 0) {
            // Toolbar (Data / Sizes / Labels / 2D-3D toggle / X)
            toolbar(vm: vm)

            // Compartment canvas (top ~55%)
            compartmentSection(vm: vm)
                .frame(maxHeight: .infinity)

            // Status bar
            statusBar(vm: vm)

            // Mini chart (bottom ~35%)
            miniChart(vm: vm)
                .frame(height: 160)

            // Bottom time bar
            HStack {
                Text(vm.formatTime(vm.cursorTimeSeconds))
                    .font(.caption.monospacedDigit())
                    .foregroundStyle(.white.opacity(0.6))
                Spacer()
                Text("Time(min)")
                    .font(.caption)
                    .foregroundStyle(.white.opacity(0.4))
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 6)
        }
        .background(Color.black)
    }

    // MARK: - Toolbar

    private func toolbar(vm: CompartmentalViewModel) -> some View {
        HStack(spacing: 4) {
            // Mode buttons
            toolbarPill("Data", isActive: vm.showData) { vm.showData.toggle() }
            toolbarPill("Sizes", isActive: vm.showSizes) { vm.showSizes.toggle() }
            toolbarPill("Labels", isActive: vm.showLabels) { vm.showLabels.toggle() }

            Spacer()

            // 2D / 3D toggle
            renderModeToggle(vm: vm)

            // Close (only when not embedded in segmented control)
            if !embedded {
                Button { dismiss() } label: {
                    Image(systemName: "xmark")
                        .font(.body.bold())
                        .foregroundStyle(.white)
                        .frame(width: 36, height: 36)
                }
            }
        }
        .padding(.horizontal, 8)
        .padding(.vertical, 4)
    }

    private func renderModeToggle(vm: CompartmentalViewModel) -> some View {
        HStack(spacing: 0) {
            toggleSegment("2D", isActive: !vm.use3D) { vm.use3D = false }
            toggleSegment("3D", isActive: vm.use3D) { vm.use3D = true }
        }
        .background(Color.white.opacity(0.06), in: RoundedRectangle(cornerRadius: 8))
    }

    private func toggleSegment(_ label: String, isActive: Bool, action: @escaping () -> Void) -> some View {
        Button(action: { withAnimation(.easeInOut(duration: 0.2)) { action() }; Haptics.tap() }) {
            Text(label)
                .font(.caption.bold())
                .foregroundStyle(isActive ? .white : .white.opacity(0.35))
                .padding(.horizontal, 12)
                .padding(.vertical, 6)
                .background(
                    isActive ? AppColors.target.opacity(0.3) : Color.clear,
                    in: RoundedRectangle(cornerRadius: 7)
                )
        }
    }

    private func toolbarPill(_ title: String, isActive: Bool, action: @escaping () -> Void) -> some View {
        Button { action(); Haptics.tap() } label: {
            Text(title)
                .font(.subheadline.weight(isActive ? .bold : .regular))
                .foregroundStyle(isActive ? AppColors.target : .white.opacity(0.5))
                .padding(.horizontal, 12)
                .padding(.vertical, 6)
                .background(
                    isActive ? AppColors.target.opacity(0.15) : Color.clear,
                    in: Capsule()
                )
        }
    }

    // MARK: - Compartment Canvas

    private func compartmentSection(vm: CompartmentalViewModel) -> some View {
        TimelineView(.animation(minimumInterval: 1.0 / 30.0)) { _ in
            ZStack {
                if vm.use3D {
                    // 3D placeholder — will be SceneKit
                    scene3DPlaceholder(vm: vm)
                } else {
                    CompartmentCanvas(
                        fillV1: vm.fillV1,
                        fillV2: vm.fillV2,
                        fillV3: vm.fillV3,
                        fillEffect: vm.fillEffect,
                        scaleV1: vm.sizeScaleV1,
                        scaleV2: vm.sizeScaleV2,
                        scaleV3: vm.sizeScaleV3,
                        infusionRate: vm.currentPoint?.infusionRate ?? 0,
                        showLabels: vm.showLabels,
                        showData: vm.showData,
                        showSizes: vm.showSizes,
                        volumeV1: vm.v1,
                        volumeV2: vm.v2,
                        volumeV3: vm.v3,
                        k12: vm.k12,
                        k21: vm.k21,
                        k13: vm.k13,
                        k31: vm.k31,
                        k10: vm.k10,
                        ke0: vm.ke0,
                        time: vm.cursorTimeSeconds
                    )
                }
            }
        }
    }

    /// Placeholder for future SceneKit 3D view
    private func scene3DPlaceholder(vm: CompartmentalViewModel) -> some View {
        ZStack {
            Color.black

            VStack(spacing: 16) {
                Image(systemName: "cube.transparent")
                    .font(.system(size: 48))
                    .foregroundStyle(AppColors.target.opacity(0.3))

                Text("3D View")
                    .font(.title3.bold())
                    .foregroundStyle(.white.opacity(0.5))

                Text("SceneKit implementation coming soon")
                    .font(.caption)
                    .foregroundStyle(.white.opacity(0.3))

                // Preview data
                if let p = vm.currentPoint {
                    HStack(spacing: 20) {
                        compartmentBadge("V1", fill: vm.fillV1, color: AppColors.v1Fluid, vol: vm.v1)
                        compartmentBadge("V2", fill: vm.fillV2, color: AppColors.v2Fluid, vol: vm.v2)
                        compartmentBadge("V3", fill: vm.fillV3, color: AppColors.v3Fluid, vol: vm.v3)
                    }
                    .padding(.top, 8)
                }
            }
        }
    }

    private func compartmentBadge(_ label: String, fill: Double, color: Color, vol: Double) -> some View {
        VStack(spacing: 4) {
            ZStack(alignment: .bottom) {
                RoundedRectangle(cornerRadius: 6)
                    .fill(Color.white.opacity(0.06))
                    .frame(width: 44, height: 60)
                RoundedRectangle(cornerRadius: 4)
                    .fill(color.opacity(0.6))
                    .frame(width: 40, height: max(4, 56 * CGFloat(fill)))
                    .padding(.bottom, 2)
            }
            Text(label)
                .font(.caption2.bold())
                .foregroundStyle(.white.opacity(0.7))
            Text(String(format: "%.0f%%", fill * 100))
                .font(.system(size: 9, design: .monospaced))
                .foregroundStyle(color)
        }
    }

    // MARK: - Status Bar

    private func statusBar(vm: CompartmentalViewModel) -> some View {
        HStack {
            Text(vm.drug.drug)
                .font(.caption.bold())
                .foregroundStyle(.white)
            Spacer()
            Text(vm.drug.model)
                .font(.caption)
                .foregroundStyle(.white.opacity(0.6))
            if let p = vm.currentPoint {
                Text(String(format: "%.3f %@", p.plasmaConcentration, vm.concentrationUnit))
                    .font(.caption.monospacedDigit())
                    .foregroundStyle(AppColors.plasma)
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 6)
        .background(Color.white.opacity(0.05))
    }

    // MARK: - Mini Chart

    private func miniChart(vm: CompartmentalViewModel) -> some View {
        GeometryReader { geo in
            ZStack {
                ChartCanvas(
                    points: vm.output?.points ?? [],
                    timeRangeMinutes: vm.timeRangeMinutes,
                    maxConcentration: maxConc(vm: vm),
                    maxInfusionRate: maxRate(vm: vm),
                    concentrationUnit: vm.concentrationUnit,
                    cursorFraction: vm.cursorFraction,
                    compact: true
                )

                Color.clear.contentShape(Rectangle())
                    .gesture(
                        DragGesture(minimumDistance: 1)
                            .onChanged { value in
                                let chartLeft: CGFloat = 30
                                let chartRight: CGFloat = 30
                                let chartWidth = geo.size.width - chartLeft - chartRight
                                let fraction = (value.location.x - chartLeft) / chartWidth
                                vm.cursorFraction = max(0, min(1, Double(fraction)))
                            }
                    )
            }
        }
    }

    private func maxConc(vm: CompartmentalViewModel) -> Double {
        guard let pts = vm.output?.points, !pts.isEmpty else { return 1 }
        return (pts.map { max($0.plasmaConcentration, $0.effectConcentration) }.max() ?? 1) * 1.3
    }

    private func maxRate(vm: CompartmentalViewModel) -> Double {
        guard let pts = vm.output?.points else { return 1 }
        return (pts.map(\.infusionRate).max() ?? 1) * 60 * 1.3
    }
}
