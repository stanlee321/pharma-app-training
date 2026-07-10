import SwiftUI
import Charts

/// N5 — Transanesthetic Monitoring.
/// Captures the monitoring toggles, basal & termination vital snapshots and the
/// intra-op complications note for one case's `TransanestheticRecord`, plus a small
/// Swift Charts trend of the entered basal → termination vitals.
struct MonitoringScreen: View {
    @Environment(MockCaseStore.self) private var store
    let caseID: UUID

    /// The monitoring multi-select surface (bridged to `transRecord.monitoring` on change).
    @State private var monitoringSel: Set<String> = []

    private static let monitoringOptions = ["ECG", "SpO2", "EtCO2", "BIS", "TNM", "Temp"]

    var body: some View {
        @Bindable var store = store
        if let idx = store.index(of: caseID) {
            Form {
                Section {
                    CheckboxGroupRow(title: "Monitorización",
                                     options: Self.monitoringOptions,
                                     multiSelect: true,
                                     selection: $monitoringSel)
                }

                Section {
                    vitalRow("FC", "lpm", idx, \.transRecord.basal.fc)
                    vitalRow("FR", "rpm", idx, \.transRecord.basal.fr)
                    vitalRow("TA sist.", "mmHg", idx, \.transRecord.basal.taSys)
                    vitalRow("TA diast.", "mmHg", idx, \.transRecord.basal.taDia)
                    vitalRow("SpO₂", "%", idx, \.transRecord.basal.spo2)
                } header: {
                    SectionHeader(title: "Signos basales", systemImage: "waveform.path.ecg")
                }

                Section {
                    vitalRow("FC", "lpm", idx, \.transRecord.termination.fc)
                    vitalRow("FR", "rpm", idx, \.transRecord.termination.fr)
                    vitalRow("TA sist.", "mmHg", idx, \.transRecord.termination.taSys)
                    vitalRow("TA diast.", "mmHg", idx, \.transRecord.termination.taDia)
                    vitalRow("SpO₂", "%", idx, \.transRecord.termination.spo2)
                } header: {
                    SectionHeader(title: "Signos de terminación", systemImage: "flag.checkered")
                }

                Section {
                    MonitoringVitalsMiniChart(basal: store.cases[idx].transRecord.basal,
                                              termination: store.cases[idx].transRecord.termination)
                        .frame(height: 180)
                        .padding(.vertical, Spacing.tight)
                } header: {
                    SectionHeader(title: "Tendencia basal → fin", systemImage: "chart.xyaxis.line")
                }

                Section {
                    TextField("Sin complicaciones",
                              text: $store.cases[idx].transRecord.complicaciones,
                              axis: .vertical)
                        .lineLimit(3...6)
                        .frame(minHeight: Spacing.tapTarget)
                } header: {
                    SectionHeader(title: "Complicaciones transanestésicas", systemImage: "exclamationmark.bubble")
                }
            }
            .navigationTitle("Monitoring")
            .navigationBarTitleDisplayMode(.inline)
            .onAppear {
                monitoringSel = Set(
                    Self.monitoringOptions.filter { store.cases[idx].transRecord.monitoring[$0] == true }
                )
            }
            .onChange(of: monitoringSel) { _, new in
                for opt in Self.monitoringOptions {
                    store.cases[idx].transRecord.monitoring[opt] = new.contains(opt)
                }
            }
        } else {
            ContentUnavailableView("Case not found", systemImage: "exclamationmark.triangle")
        }
    }

    // MARK: - Vital snapshot rows (manual Double? ↔ String bindings)

    private func vitalRow(_ label: String,
                          _ unit: String,
                          _ idx: Int,
                          _ kp: WritableKeyPath<AnesthesiaCase, Double?>) -> some View {
        LabeledTextRow(label: label,
                       text: vitalBinding(idx, kp),
                       placeholder: "—",
                       unit: unit,
                       keyboard: .decimalPad)
    }

    private func vitalBinding(_ idx: Int,
                              _ kp: WritableKeyPath<AnesthesiaCase, Double?>) -> Binding<String> {
        Binding(
            get: { store.cases[idx][keyPath: kp].map(Self.numString) ?? "" },
            set: { store.cases[idx][keyPath: kp] = Double($0.replacingOccurrences(of: ",", with: ".")) }
        )
    }

    private static func numString(_ v: Double) -> String {
        v == v.rounded() ? String(Int(v)) : String(v)
    }
}

// MARK: - Basal → termination trend (Swift Charts demo)

private struct MonitoringVitalsMiniChart: View {
    let basal: VitalSnapshot
    let termination: VitalSnapshot

    private struct Sample: Identifiable {
        let id = UUID()
        let metric: String
        let x: Double        // 0 = basal, 1 = terminación
        let value: Double
    }

    private var samples: [Sample] {
        let metrics: [(String, KeyPath<VitalSnapshot, Double?>)] = [
            ("FC", \.fc),
            ("TA sist.", \.taSys),
            ("SpO₂", \.spo2)
        ]
        var out: [Sample] = []
        for (name, kp) in metrics {
            if let b = basal[keyPath: kp] { out.append(Sample(metric: name, x: 0, value: b)) }
            if let t = termination[keyPath: kp] { out.append(Sample(metric: name, x: 1, value: t)) }
        }
        return out
    }

    var body: some View {
        if samples.isEmpty {
            VStack(spacing: Spacing.tight) {
                Image(systemName: "chart.line.uptrend.xyaxis")
                    .font(.title2)
                    .foregroundStyle(.tertiary)
                Text("Ingrese signos basales y de terminación para ver la tendencia")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else {
            Chart(samples) { s in
                LineMark(
                    x: .value("Fase", s.x),
                    y: .value("Valor", s.value)
                )
                .foregroundStyle(by: .value("Métrica", s.metric))
                .symbol(by: .value("Métrica", s.metric))

                PointMark(
                    x: .value("Fase", s.x),
                    y: .value("Valor", s.value)
                )
                .foregroundStyle(by: .value("Métrica", s.metric))
            }
            .chartXScale(domain: -0.2...1.2)
            .chartXAxis {
                AxisMarks(values: [0.0, 1.0]) { value in
                    AxisGridLine()
                    AxisValueLabel {
                        if let d = value.as(Double.self) {
                            Text(d == 0 ? "Basal" : "Fin")
                        }
                    }
                }
            }
            .chartLegend(position: .bottom)
        }
    }
}
