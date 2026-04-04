import SwiftUI

struct SimulationView: View {
    @Binding var navigationPath: NavigationPath
    @Environment(AppState.self) private var appState
    @State private var vm: SimulationViewModel?

    var body: some View {
        Group {
            if let vm {
                simulationContent(vm: vm)
            } else {
                Color.black.ignoresSafeArea()
                    .overlay(ProgressView().tint(.white))
            }
        }
        .onAppear {
            if vm == nil {
                vm = SimulationViewModel(appState: appState)
            }
        }
        .task {
            if appState.simulationOutput == nil {
                await appState.runInitialSimulation()
                vm?.autoScaleAxes()
            } else {
                vm?.autoScaleAxes()
            }
        }
    }

    @ViewBuilder
    private func simulationContent(vm: SimulationViewModel) -> some View {
        ZStack {
            Color.black.ignoresSafeArea()

            VStack(spacing: 0) {
                // Top toolbar
                topToolbar(vm: vm)

                // Status dashboard
                statusDashboard(vm: vm)

                // TCI Readouts (visible during target drag)
                if vm.isDraggingTarget {
                    tciReadouts(vm: vm)
                }

                // Chart area with gestures
                chartArea(vm: vm)
                    .frame(maxHeight: .infinity)

                // Tooltip
                if let point = vm.valuesAtCursor {
                    DataTooltip(
                        point: point,
                        concentrationUnit: vm.concentrationUnit,
                        timeString: vm.formatTime(vm.cursorTimeSeconds)
                    )
                    .padding(.horizontal, 12)
                    .frame(maxWidth: .infinity, alignment: .leading)
                }

                // Bottom toolbar
                bottomToolbar(vm: vm)
            }
        }
        .navigationBarBackButtonHidden()
        .toolbar {
            ToolbarItem(placement: .topBarLeading) {
                Button {
                    navigationPath.removeLast()
                } label: {
                    Text("< Patient")
                        .foregroundStyle(.white)
                }
            }
        }
        .toolbarBackground(.hidden, for: .navigationBar)
    }

    // MARK: - Top Toolbar

    private func topToolbar(vm: SimulationViewModel) -> some View {
        HStack {
            Text("Manual")
                .font(.caption)
                .foregroundStyle(.white.opacity(0.5))
                .padding(.horizontal, 8)
                .padding(.vertical, 4)
                .background(.white.opacity(0.1), in: Capsule())

            Spacer()

            Text(vm.drug.drug)
                .font(.subheadline.bold())
                .foregroundStyle(.white)

            Spacer()

            // Playback controls
            HStack(spacing: 12) {
                Button {
                    vm.togglePlayback()
                } label: {
                    Image(systemName: vm.isPlaying ? "pause.fill" : "play.fill")
                        .foregroundStyle(.white)
                }

                Button {
                    vm.cycleSpeed()
                } label: {
                    Text("\(Int(vm.playbackSpeed))x")
                        .font(.caption.bold())
                        .foregroundStyle(.white.opacity(0.7))
                }

                Button {
                    navigationPath.append(Route.compartmental)
                } label: {
                    Image(systemName: "cube.transparent")
                        .foregroundStyle(.white)
                }
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
    }

    // MARK: - Status Dashboard

    private func statusDashboard(vm: SimulationViewModel) -> some View {
        HStack {
            VStack(alignment: .leading, spacing: 2) {
                Text(vm.drug.model)
                    .font(.caption.bold())
                    .foregroundStyle(.white.opacity(0.7))
                Text("\(String(format: "%.4f", vm.patient.dilution)) \(vm.concentrationUnit)")
                    .font(.caption2)
                    .foregroundStyle(.white.opacity(0.5))
            }

            Spacer()

            if let point = vm.valuesAtCursor {
                VStack(alignment: .trailing, spacing: 2) {
                    HStack(spacing: 4) {
                        Circle().fill(.cyan).frame(width: 6, height: 6)
                        Text(String(format: "%.3f", point.plasmaConcentration))
                            .monospacedDigit()
                    }
                    HStack(spacing: 4) {
                        Circle().fill(.green).frame(width: 6, height: 6)
                        Text(String(format: "%.3f", point.effectConcentration))
                            .monospacedDigit()
                    }
                }
                .font(.caption)
                .foregroundStyle(.white)
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 4)
    }

    // MARK: - TCI Readouts

    private func tciReadouts(vm: SimulationViewModel) -> some View {
        HStack(spacing: 0) {
            // Bolus
            VStack(alignment: .leading, spacing: 1) {
                Text("Bolus")
                    .font(.caption2)
                    .foregroundStyle(.white.opacity(0.5))
                if let tci = vm.pendingTCIResult {
                    Text(String(format: "%.1f ML", tci.bolusMl))
                        .font(.caption.bold().monospacedDigit())
                        .foregroundStyle(.white)
                    Text(String(format: "%.1f mcg/kg", tci.bolusMcgPerKg))
                        .font(.caption2.monospacedDigit())
                        .foregroundStyle(.white.opacity(0.6))
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)

            // Target
            VStack(spacing: 1) {
                Text("Target")
                    .font(.caption2)
                    .foregroundStyle(.white.opacity(0.5))
                Text(String(format: "%.2f", vm.dragTargetConcentration))
                    .font(.callout.bold().monospacedDigit())
                    .foregroundStyle(.blue)
                Text(vm.concentrationUnit)
                    .font(.caption2)
                    .foregroundStyle(.blue.opacity(0.7))
            }

            // Infusion
            VStack(alignment: .trailing, spacing: 1) {
                Text("Infusion")
                    .font(.caption2)
                    .foregroundStyle(.white.opacity(0.5))
                if let tci = vm.pendingTCIResult {
                    Text(String(format: "%.1f ML/hr", tci.infusionRateMlHr))
                        .font(.caption.bold().monospacedDigit())
                        .foregroundStyle(.white)
                    Text(String(format: "%.2f mcg/kg/hr", tci.infusionRateMcgKgHr))
                        .font(.caption2.monospacedDigit())
                        .foregroundStyle(.white.opacity(0.6))
                }
            }
            .frame(maxWidth: .infinity, alignment: .trailing)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 6)
        .background(Color.blue.opacity(0.15))
    }

    // MARK: - Chart Area

    private func chartArea(vm: SimulationViewModel) -> some View {
        GeometryReader { geo in
            ZStack {
                // Chart canvas
                ChartCanvas(
                    points: vm.output?.points ?? [],
                    timeRangeMinutes: vm.timeRangeMinutes,
                    maxConcentration: vm.maxConcentration,
                    maxInfusionRate: vm.maxInfusionRate,
                    concentrationUnit: vm.concentrationUnit,
                    cursorFraction: vm.cursorTimeFraction,
                    compact: false
                )

                // Target node (blue circle on cursor)
                if vm.isDraggingTarget {
                    targetNode(vm: vm, size: geo.size)
                }

                // Gesture overlay
                Color.clear.contentShape(Rectangle())
                    .gesture(chartDragGesture(vm: vm, size: geo.size))
                    .onTapGesture { location in
                        let chartLeft: CGFloat = 45
                        let chartRight: CGFloat = 45
                        let chartWidth = geo.size.width - chartLeft - chartRight
                        let fraction = (location.x - chartLeft) / chartWidth
                        vm.cursorTimeFraction = max(0, min(1, Double(fraction)))

                        // Start target drag on tap
                        let chartTop: CGFloat = 16
                        let chartBottom: CGFloat = 28
                        let chartHeight = geo.size.height - chartTop - chartBottom
                        let yFraction = 1.0 - Double((location.y - chartTop) / chartHeight)
                        let concentration = yFraction * vm.maxConcentration
                        vm.onTargetDragChanged(concentration: max(concentration, 0))
                    }
            }
        }
    }

    private func targetNode(vm: SimulationViewModel, size: CGSize) -> some View {
        let chartLeft: CGFloat = 45
        let chartRight: CGFloat = 45
        let chartTop: CGFloat = 16
        let chartBottom: CGFloat = 28
        let chartWidth = size.width - chartLeft - chartRight
        let chartHeight = size.height - chartTop - chartBottom

        let x = chartLeft + CGFloat(vm.cursorTimeFraction) * chartWidth
        let yFraction = vm.dragTargetConcentration / vm.maxConcentration
        let y = chartTop + chartHeight * CGFloat(1 - yFraction)

        return Circle()
            .fill(.blue)
            .frame(width: 20, height: 20)
            .shadow(color: .blue.opacity(0.6), radius: 6)
            .position(x: x, y: y)
    }

    private func chartDragGesture(vm: SimulationViewModel, size: CGSize) -> some Gesture {
        DragGesture(minimumDistance: 5)
            .onChanged { value in
                let chartLeft: CGFloat = 45
                let chartRight: CGFloat = 45
                let chartTop: CGFloat = 16
                let chartBottom: CGFloat = 28
                let chartWidth = size.width - chartLeft - chartRight
                let chartHeight = size.height - chartTop - chartBottom

                if vm.isDraggingTarget {
                    // Vertical drag → change target concentration
                    let yFraction = 1.0 - Double((value.location.y - chartTop) / chartHeight)
                    let concentration = yFraction * vm.maxConcentration
                    vm.onTargetDragChanged(concentration: concentration)
                } else {
                    // Horizontal drag → scrub timeline
                    let fraction = (value.location.x - chartLeft) / chartWidth
                    vm.cursorTimeFraction = max(0, min(1, Double(fraction)))
                }
            }
    }

    // MARK: - Bottom Toolbar

    private func bottomToolbar(vm: SimulationViewModel) -> some View {
        HStack {
            if vm.isDraggingTarget {
                Button("Cancel") {
                    vm.onTargetDragCancelled()
                }
                .foregroundStyle(.white)

                Spacer()

                Button {
                    vm.nudgeTarget(by: -nudgeAmount(vm: vm))
                } label: {
                    Image(systemName: "chevron.down")
                        .foregroundStyle(.white)
                        .frame(width: 44, height: 36)
                        .background(.white.opacity(0.1), in: RoundedRectangle(cornerRadius: 6))
                }

                Button {
                    vm.nudgeTarget(by: nudgeAmount(vm: vm))
                } label: {
                    Image(systemName: "chevron.up")
                        .foregroundStyle(.white)
                        .frame(width: 44, height: 36)
                        .background(.white.opacity(0.1), in: RoundedRectangle(cornerRadius: 6))
                }

                Spacer()

                Button("Done") {
                    vm.onTargetDragConfirmed()
                }
                .fontWeight(.bold)
                .foregroundStyle(.blue)
            } else {
                Button("+ Graph") { }
                    .foregroundStyle(.white.opacity(0.6))

                Spacer()

                Text(vm.formatTime(vm.cursorTimeSeconds))
                    .font(.caption.monospacedDigit())
                    .foregroundStyle(.white.opacity(0.7))

                Spacer()

                Button {
                    // info
                } label: {
                    Image(systemName: "info.circle")
                        .foregroundStyle(.white.opacity(0.6))
                }
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
        .background(Color.black)
    }

    private func nudgeAmount(vm: SimulationViewModel) -> Double {
        vm.maxConcentration * 0.02
    }
}
