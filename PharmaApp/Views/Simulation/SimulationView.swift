import SwiftUI

struct SimulationView: View {
    @Binding var navigationPath: NavigationPath
    @Environment(AppState.self) private var appState
    @State private var vm: SimulationViewModel?
    @State private var activeTab: SimTab = .graph

    enum SimTab: String, CaseIterable {
        case graph = "Graph"
        case compartments = "Compartments"
    }

    var body: some View {
        Group {
            if let vm {
                simulationContent(vm: vm)
            } else {
                Color.black.ignoresSafeArea()
                    .overlay(ProgressView().tint(.white))
            }
        }
        .preferredColorScheme(.dark)
        .onAppear {
            if vm == nil {
                vm = SimulationViewModel(appState: appState)
            }
        }
        .task {
            guard let vm else { return }
            if appState.simulationOutput == nil {
                // Auto-set a default target so the chart isn't empty
                let defaultConc: Double = appState.selectedDrug.concentrationUnit == .ngPerMl ? 0.5 : 3.0
                let defaultTarget = TargetEvent(time: 0, concentration: defaultConc, targetType: .plasma)
                await appState.runSimulation(with: [defaultTarget])
            }
            vm.autoScaleAxes()
        }
    }

    @ViewBuilder
    private func simulationContent(vm: SimulationViewModel) -> some View {
        ZStack {
            Color.black.ignoresSafeArea()

            VStack(spacing: 0) {
                // Top bar with back + segmented control
                topBar(vm: vm)

                // Segmented control: Graph ↔ Compartments
                segmentedControl

                if activeTab == .graph {
                    graphContent(vm: vm)
                } else {
                    CompartmentalView()
                        .environment(appState)
                }
            }
        }
        .navigationBarBackButtonHidden()
        .toolbar(.hidden, for: .navigationBar)
    }

    // MARK: - Top Bar

    private func topBar(vm: SimulationViewModel) -> some View {
        HStack {
            Button {
                navigationPath.removeLast()
            } label: {
                HStack(spacing: 4) {
                    Image(systemName: "chevron.left")
                    Text("Back")
                }
                .font(.subheadline)
                .foregroundStyle(.blue)
            }

            Spacer()

            Text(vm.drug.drug)
                .font(.subheadline.bold())
                .foregroundStyle(.white)

            Spacer()

            // Playback controls
            HStack(spacing: 12) {
                Button { vm.togglePlayback() } label: {
                    Image(systemName: vm.isPlaying ? "pause.fill" : "play.fill")
                        .foregroundStyle(.white)
                }
                Button { vm.cycleSpeed() } label: {
                    Text("\(Int(vm.playbackSpeed))x")
                        .font(.caption.bold())
                        .foregroundStyle(.white.opacity(0.7))
                }
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
    }

    // MARK: - Segmented Control

    private var segmentedControl: some View {
        HStack(spacing: 0) {
            ForEach(SimTab.allCases, id: \.self) { tab in
                Button {
                    withAnimation(.easeInOut(duration: 0.2)) { activeTab = tab }
                } label: {
                    Text(tab.rawValue)
                        .font(.subheadline.weight(activeTab == tab ? .semibold : .regular))
                        .foregroundStyle(activeTab == tab ? .white : .white.opacity(0.4))
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 8)
                        .background(
                            activeTab == tab ? AppColors.darkCard : Color.clear,
                            in: RoundedRectangle(cornerRadius: 8)
                        )
                }
            }
        }
        .padding(3)
        .background(Color.white.opacity(0.06), in: RoundedRectangle(cornerRadius: 10))
        .padding(.horizontal, 12)
        .padding(.bottom, 4)
    }

    // MARK: - Graph Content

    @ViewBuilder
    private func graphContent(vm: SimulationViewModel) -> some View {
        // Status dashboard
        statusDashboard(vm: vm)

        // TCI Readouts
        if vm.isDraggingTarget {
            tciReadouts(vm: vm)
        }

        // Chart + target + tooltip
        chartSection(vm: vm)
            .frame(maxHeight: .infinity)

        // Bottom toolbar
        bottomToolbar(vm: vm)
    }

    // MARK: - Status Dashboard

    private func statusDashboard(vm: SimulationViewModel) -> some View {
        HStack {
            HStack(spacing: 4) {
                Text("Manual")
                    .font(.caption2)
                    .foregroundStyle(.white.opacity(0.4))
                    .padding(.horizontal, 6)
                    .padding(.vertical, 3)
                    .background(Color.white.opacity(0.08), in: Capsule())

                VStack(alignment: .leading, spacing: 1) {
                    Text(vm.drug.model)
                        .font(.caption.bold())
                        .foregroundStyle(.white.opacity(0.7))
                    Text("\(formatDilution(vm.patient.dilution, unit: vm.concentrationUnit)) \(vm.concentrationUnit)")
                        .font(.caption2)
                        .foregroundStyle(.white.opacity(0.4))
                }
            }

            Spacer()

            if let point = vm.valuesAtCursor {
                VStack(alignment: .trailing, spacing: 2) {
                    HStack(spacing: 4) {
                        Circle().fill(AppColors.plasma).frame(width: 7, height: 7)
                        Text(formatConc(point.plasmaConcentration))
                            .monospacedDigit()
                            .foregroundStyle(AppColors.plasma)
                    }
                    HStack(spacing: 4) {
                        Circle().fill(AppColors.effect).frame(width: 7, height: 7)
                        Text(formatConc(point.effectConcentration))
                            .monospacedDigit()
                            .foregroundStyle(AppColors.effect)
                    }
                }
                .font(.caption)
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 4)
    }

    // MARK: - TCI Readouts

    private func tciReadouts(vm: SimulationViewModel) -> some View {
        HStack(spacing: 0) {
            VStack(alignment: .leading, spacing: 1) {
                Text("Bolus").font(.caption2).foregroundStyle(.white.opacity(0.4))
                if let tci = vm.pendingTCIResult {
                    Text(String(format: "%.1f ML", tci.bolusMl))
                        .font(.caption.bold().monospacedDigit()).foregroundStyle(.white)
                    Text(String(format: "%.1f mcg/kg", tci.bolusMcgPerKg))
                        .font(.caption2.monospacedDigit()).foregroundStyle(.white.opacity(0.5))
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)

            VStack(spacing: 1) {
                Text("Target").font(.caption2).foregroundStyle(.white.opacity(0.4))
                Text(formatConc(vm.dragTargetConcentration))
                    .font(.callout.bold().monospacedDigit()).foregroundStyle(AppColors.target)
                Text(vm.concentrationUnit)
                    .font(.caption2).foregroundStyle(AppColors.target.opacity(0.6))
            }

            VStack(alignment: .trailing, spacing: 1) {
                Text("Infusion").font(.caption2).foregroundStyle(.white.opacity(0.4))
                if let tci = vm.pendingTCIResult {
                    Text(String(format: "%.1f ML/hr", tci.infusionRateMlHr))
                        .font(.caption.bold().monospacedDigit()).foregroundStyle(.white)
                    Text(String(format: "%.2f mcg/kg/hr", tci.infusionRateMcgKgHr))
                        .font(.caption2.monospacedDigit()).foregroundStyle(.white.opacity(0.5))
                }
            }
            .frame(maxWidth: .infinity, alignment: .trailing)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 6)
        .background(AppColors.target.opacity(0.1))
    }

    // MARK: - Chart Section (chart + target node + floating tooltip)

    private func chartSection(vm: SimulationViewModel) -> some View {
        GeometryReader { geo in
            let chartLeft: CGFloat = 45
            let chartRight: CGFloat = 45
            let chartTop: CGFloat = 16
            let chartBottom: CGFloat = 28
            let chartWidth = geo.size.width - chartLeft - chartRight
            let chartHeight = geo.size.height - chartTop - chartBottom

            ZStack(alignment: .topLeading) {
                // Chart canvas
                ChartCanvas(
                    points: vm.output?.points ?? [],
                    timeRangeMinutes: vm.timeRangeMinutes,
                    maxConcentration: vm.maxConcentration,
                    maxInfusionRate: vm.maxInfusionRate,
                    concentrationUnit: vm.concentrationUnit,
                    cursorFraction: vm.cursorTimeFraction,
                    compact: false,
                    targetConcentration: vm.isDraggingTarget ? vm.dragTargetConcentration : vm.activeTargetAtCursor?.concentration,
                    targetMarkers: vm.targets
                )

                // Target node
                if vm.isDraggingTarget {
                    let x = chartLeft + CGFloat(vm.cursorTimeFraction) * chartWidth
                    let yFrac = vm.dragTargetConcentration / vm.maxConcentration
                    let y = chartTop + chartHeight * CGFloat(1 - yFrac)

                    // Glow ring
                    Circle()
                        .fill(AppColors.target.opacity(0.2))
                        .frame(width: 44, height: 44)
                        .position(x: x, y: y)

                    // Node
                    Circle()
                        .fill(AppColors.target)
                        .frame(width: 18, height: 18)
                        .shadow(color: AppColors.target.opacity(0.6), radius: 8)
                        .position(x: x, y: y)

                    // Value label pinned to node
                    Text(formatConc(vm.dragTargetConcentration))
                        .font(.system(size: 11, weight: .bold, design: .monospaced))
                        .foregroundStyle(.white)
                        .padding(.horizontal, 6)
                        .padding(.vertical, 2)
                        .background(AppColors.target, in: Capsule())
                        .position(x: x + 40, y: y)
                }

                // Onboarding hint (when no targets and no curves)
                if !vm.isDraggingTarget && (vm.output?.points.isEmpty ?? true) {
                    VStack(spacing: 8) {
                        Image(systemName: "hand.tap")
                            .font(.title)
                            .foregroundStyle(.white.opacity(0.3))
                        Text("Tap chart to set target")
                            .font(.subheadline)
                            .foregroundStyle(.white.opacity(0.3))
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                }

                // Floating tooltip (follows cursor)
                if !vm.isDraggingTarget, let point = vm.valuesAtCursor, !(vm.output?.points.isEmpty ?? true) {
                    let cursorX = chartLeft + CGFloat(vm.cursorTimeFraction) * chartWidth
                    let tooltipOnLeft = vm.cursorTimeFraction > 0.5

                    DataTooltip(
                        point: point,
                        concentrationUnit: vm.concentrationUnit,
                        timeString: vm.formatTime(vm.cursorTimeSeconds)
                    )
                    .position(
                        x: tooltipOnLeft ? cursorX - 80 : cursorX + 80,
                        y: chartTop + 50
                    )
                }

                // Gesture overlay
                Color.clear.contentShape(Rectangle())
                    .gesture(chartGesture(vm: vm, chartLeft: chartLeft, chartWidth: chartWidth, chartTop: chartTop, chartHeight: chartHeight))
                    .onTapGesture { location in
                        Haptics.tap()
                        let fraction = (location.x - chartLeft) / chartWidth
                        vm.cursorTimeFraction = max(0, min(1, Double(fraction)))

                        let yFrac = 1.0 - Double((location.y - chartTop) / chartHeight)
                        let conc = yFrac * vm.maxConcentration
                        vm.onTargetDragChanged(concentration: max(conc, 0))
                    }
            }
        }
    }

    private func chartGesture(vm: SimulationViewModel, chartLeft: CGFloat, chartWidth: CGFloat, chartTop: CGFloat, chartHeight: CGFloat) -> some Gesture {
        DragGesture(minimumDistance: 5)
            .onChanged { value in
                if vm.isDraggingTarget {
                    let yFrac = 1.0 - Double((value.location.y - chartTop) / chartHeight)
                    let conc = yFrac * vm.maxConcentration
                    // Snap haptic at round numbers
                    let snapped = (conc * 10).rounded() / 10
                    let prevSnapped = (vm.dragTargetConcentration * 10).rounded() / 10
                    if snapped != prevSnapped { Haptics.targetSnap() }
                    vm.onTargetDragChanged(concentration: max(conc, 0))
                } else {
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
                .foregroundStyle(.white.opacity(0.7))

                Spacer()

                HStack(spacing: 12) {
                    Button { vm.nudgeTarget(by: -nudgeAmount(vm: vm)); Haptics.tap() } label: {
                        Image(systemName: "chevron.down")
                            .frame(width: 44, height: 36)
                            .background(Color.white.opacity(0.08), in: RoundedRectangle(cornerRadius: 8))
                            .foregroundStyle(.white)
                    }
                    Button { vm.nudgeTarget(by: nudgeAmount(vm: vm)); Haptics.tap() } label: {
                        Image(systemName: "chevron.up")
                            .frame(width: 44, height: 36)
                            .background(Color.white.opacity(0.08), in: RoundedRectangle(cornerRadius: 8))
                            .foregroundStyle(.white)
                    }
                }

                Spacer()

                Button("Done") {
                    Haptics.confirm()
                    vm.onTargetDragConfirmed()
                }
                .fontWeight(.bold)
                .foregroundStyle(AppColors.target)
            } else {
                // + Target button
                Button {
                    Haptics.tap()
                    vm.beginAddTarget()
                } label: {
                    HStack(spacing: 4) {
                        Image(systemName: "plus")
                        Text("Target")
                    }
                    .font(.subheadline.weight(.medium))
                    .foregroundStyle(AppColors.target)
                }

                Spacer()

                // Target count + time
                VStack(spacing: 1) {
                    Text(vm.formatTime(vm.cursorTimeSeconds))
                        .font(.caption.monospacedDigit())
                        .foregroundStyle(.white.opacity(0.6))
                    if !vm.targets.isEmpty {
                        Text("\(vm.targets.count) target\(vm.targets.count == 1 ? "" : "s")")
                            .font(.system(size: 9))
                            .foregroundStyle(.white.opacity(0.3))
                    }
                }

                Spacer()

                // Remove target at cursor (if near one)
                if vm.targets.count > 1, vm.activeTargetAtCursor != nil {
                    Button {
                        Haptics.tap()
                        vm.removeTargetAtCursor()
                    } label: {
                        Image(systemName: "minus.circle")
                            .foregroundStyle(.red.opacity(0.6))
                    }
                } else {
                    Button { } label: {
                        Image(systemName: "info.circle")
                            .foregroundStyle(.white.opacity(0.4))
                    }
                }
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
    }

    // MARK: - Helpers

    private func nudgeAmount(vm: SimulationViewModel) -> Double {
        vm.maxConcentration * 0.02
    }

    private func formatConc(_ v: Double) -> String {
        if v >= 10 { return String(format: "%.1f", v) }
        if v >= 1 { return String(format: "%.2f", v) }
        if v >= 0.1 { return String(format: "%.3f", v) }
        return String(format: "%.4f", v)
    }

    private func formatDilution(_ v: Double, unit: String) -> String {
        if v >= 1 { return String(format: "%.1f", v) }
        return String(format: "%.4f", v)
    }
}
