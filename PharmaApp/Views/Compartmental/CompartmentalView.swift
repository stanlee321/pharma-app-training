import SwiftUI

struct CompartmentalView: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(AppState.self) private var appState
    @State private var vm: CompartmentalViewModel?

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
        ZStack {
            Color.black.ignoresSafeArea()

            VStack(spacing: 0) {
                // Top toolbar
                toolbar(vm: vm)

                // 3D compartment canvas (top ~55%)
                compartmentSection(vm: vm)
                    .frame(maxHeight: .infinity)

                // Status bar
                statusBar(vm: vm)

                // Mini chart (bottom ~35%)
                miniChart(vm: vm)
                    .frame(height: 160)

                // Bottom bar
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
        }
        .navigationBarBackButtonHidden()
        .toolbar(.hidden, for: .navigationBar)
    }

    // MARK: - Toolbar

    private func toolbar(vm: CompartmentalViewModel) -> some View {
        HStack(spacing: 0) {
            toolbarButton("Data", isActive: vm.showData) {
                vm.showData.toggle()
            }
            toolbarButton("Sizes", isActive: vm.showSizes) {
                vm.showSizes.toggle()
            }
            toolbarButton("Labels", isActive: vm.showLabels) {
                vm.showLabels.toggle()
            }
            Spacer()
            Button {
                dismiss()
            } label: {
                Image(systemName: "xmark")
                    .font(.body.bold())
                    .foregroundStyle(.white)
                    .frame(width: 36, height: 36)
            }
        }
        .padding(.horizontal, 8)
        .padding(.vertical, 4)
    }

    private func toolbarButton(_ title: String, isActive: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(title)
                .font(.subheadline.weight(isActive ? .bold : .regular))
                .foregroundStyle(isActive ? .blue : .white.opacity(0.6))
                .padding(.horizontal, 12)
                .padding(.vertical, 6)
                .background(
                    isActive ? Color.blue.opacity(0.15) : Color.clear,
                    in: Capsule()
                )
        }
    }

    // MARK: - Compartment Canvas

    private func compartmentSection(vm: CompartmentalViewModel) -> some View {
        TimelineView(.animation(minimumInterval: 1.0 / 30.0)) { timeline in
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
                    .foregroundStyle(.cyan)
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
                // Reuse ChartCanvas in compact mode
                ChartCanvas(
                    points: vm.output?.points ?? [],
                    timeRangeMinutes: vm.timeRangeMinutes,
                    maxConcentration: maxConcentration(vm: vm),
                    maxInfusionRate: maxInfusionRate(vm: vm),
                    concentrationUnit: vm.concentrationUnit,
                    cursorFraction: vm.cursorFraction,
                    compact: true
                )

                // Scrub gesture
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

    private func maxConcentration(vm: CompartmentalViewModel) -> Double {
        guard let pts = vm.output?.points, !pts.isEmpty else { return 1 }
        let m = pts.map { max($0.plasmaConcentration, $0.effectConcentration) }.max() ?? 1
        return m * 1.3
    }

    private func maxInfusionRate(vm: CompartmentalViewModel) -> Double {
        guard let pts = vm.output?.points else { return 1 }
        return (pts.map(\.infusionRate).max() ?? 1) * 60 * 1.3
    }
}
