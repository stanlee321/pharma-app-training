import SwiftUI
import UIKit

/// N10 — Review & Export (MVP).
///
/// Read-only projection of a whole `AnesthesiaCase`: patient biometrics, diagnosis,
/// anesthetic technique, drug count and Aldrete column totals. Offers a *simple*
/// summary PDF rendered client-side with `UIGraphicsPDFRenderer` and shared via
/// `ShareLink`. The true 1:1 print-faithful form-fill export is server-side and
/// depends on the field-crosswalk + fill-pdf value pass, which are not built yet —
/// see the caption below and `docs/wiki/plans/screens/review-export.md`.
struct ReviewExportScreen: View {
    @Environment(MockCaseStore.self) private var store
    let caseID: UUID

    /// URL of the last-generated summary PDF (temp file). Non-nil ⇒ show the ShareLink.
    @State private var exportURL: URL?

    // Server-rendered filled form
    @State private var selectedForm: FormOption = .nota21
    @State private var filledURL: URL?
    @State private var isExporting = false
    @State private var exportError: String?

    init(caseID: UUID) {
        self.caseID = caseID
    }

    var body: some View {
        Group {
            if let idx = store.index(of: caseID) {
                content(store.cases[idx])
            } else {
                ContentUnavailableView("Case not found", systemImage: "exclamationmark.triangle")
            }
        }
        .navigationTitle("Review & Export")
        .navigationBarTitleDisplayMode(.inline)
    }

    // MARK: - Summary form

    @ViewBuilder
    private func content(_ c: AnesthesiaCase) -> some View {
        Form {
            Section {
                RE_SummaryRow(label: "Nombre", value: display(c.patient.nombre))
                RE_SummaryRow(label: "Registro", value: display(c.patient.registro))
                RE_SummaryRow(label: "Edad", value: "\(Int(c.patient.profile.age)) años")
                RE_SummaryRow(label: "Sexo", value: c.patient.profile.gender == .male ? "M" : "F")
                RE_SummaryRow(label: "Peso / Talla",
                              value: String(format: "%.0f kg · %.0f cm",
                                            c.patient.profile.weight, c.patient.profile.height))
                RE_SummaryRow(label: "IMC", value: String(format: "%.1f", c.patient.imc))
            } header: {
                SectionHeader(title: "Paciente", systemImage: "person.text.rectangle")
            }

            Section {
                RE_SummaryRow(label: "Preoperatorio", value: display(c.diagnosticoPreop))
                RE_SummaryRow(label: "Postoperatorio", value: display(c.diagnosticoPostop))
                RE_SummaryRow(label: "Operación", value: display(c.operacionPropuesta))
                RE_SummaryRow(label: "ASA", value: c.asa.map(romanASA) ?? "—")
            } header: {
                SectionHeader(title: "Diagnóstico", systemImage: "stethoscope")
            }

            Section {
                RE_SummaryRow(label: "Modalidad",
                              value: c.technique.modality.isEmpty ? "—" : c.technique.modality)
                RE_SummaryRow(label: "Fármacos registrados", value: "\(c.drugs.count)")
            } header: {
                SectionHeader(title: "Técnica anestésica", systemImage: "waveform.path.ecg")
            }

            aldreteSection(c.recovery)

            Section {
                Picker("Formulario", selection: $selectedForm) {
                    ForEach(FormOption.allCases) { Text($0.title).tag($0) }
                }
                Button {
                    exportFilled()
                } label: {
                    HStack {
                        Label("Export filled form", systemImage: "doc.richtext")
                        Spacer()
                        if isExporting { ProgressView() }
                    }
                    .frame(maxWidth: .infinity, minHeight: Spacing.tapTarget)
                }
                .disabled(isExporting)

                if let url = filledURL {
                    ShareLink(item: url) {
                        Label("Share filled PDF", systemImage: "square.and.arrow.up")
                            .frame(maxWidth: .infinity, minHeight: Spacing.tapTarget)
                    }
                    .tint(AppColors.effect)
                }
                if let err = exportError {
                    Text(err).font(.caption).foregroundStyle(AppColors.invalidTint)
                }
            } header: {
                SectionHeader(title: "Export · filled form", systemImage: "doc.richtext")
            } footer: {
                Text("Renders the real 1:1 anaesthesia form with your data drawn into each field, "
                     + "server-side. Needs the backend running + CaseStoreProvider.useREST.")
                    .font(.caption)
            }

            Section {
                Button {
                    Haptics.confirm()
                    exportURL = buildPDF(for: c)
                } label: {
                    Label("Build summary (offline)", systemImage: "doc.plaintext")
                        .frame(maxWidth: .infinity, minHeight: Spacing.tapTarget)
                }
                if let url = exportURL {
                    ShareLink(item: url) {
                        Label("Share summary PDF", systemImage: "square.and.arrow.up")
                            .frame(maxWidth: .infinity, minHeight: Spacing.tapTarget)
                    }
                }
            } header: {
                SectionHeader(title: "Offline summary", systemImage: "doc.plaintext")
            }
        }
    }

    @ViewBuilder
    private func aldreteSection(_ r: RecoveryScore) -> some View {
        let totals = aldreteTotals(r)
        Section {
            if totals.isEmpty {
                Text("No Aldrete score recorded")
                    .font(.callout)
                    .foregroundStyle(.secondary)
                    .frame(minHeight: Spacing.tapTarget)
            } else {
                ForEach(totals, id: \.point) { col in
                    RE_SummaryRow(label: col.point, value: "\(col.total) / 10")
                }
            }
        } header: {
            SectionHeader(title: "Aldrete (recovery)", systemImage: "heart.text.square")
        }
    }

    // MARK: - Derivations

    /// Column totals: for each recorded time-point, sum the criterion scores (0–10).
    private func aldreteTotals(_ r: RecoveryScore) -> [(point: String, total: Int)] {
        var points = Set<String>()
        for (_, byTime) in r.aldrete { points.formUnion(byTime.keys) }
        return points.sorted().map { pt in
            let total = r.aldrete.values.reduce(0) { $0 + ($1[pt] ?? 0) }
            return (point: pt, total: total)
        }
    }

    private func display(_ s: String) -> String { s.isEmpty ? "—" : s }

    private func romanASA(_ n: Int) -> String {
        ["I", "II", "III", "IV", "V"][max(0, min(4, n - 1))]
    }

    // MARK: - Server-rendered filled form

    /// Save the case, then ask the backend to render the real filled form PDF.
    private func exportFilled() {
        Task {
            isExporting = true
            exportError = nil
            filledURL = nil
            Haptics.tap()
            do {
                let data = try await store.exportForm(caseID: caseID, formID: selectedForm.rawValue)
                let url = FileManager.default.temporaryDirectory
                    .appendingPathComponent("\(selectedForm.rawValue).pdf")
                try data.write(to: url, options: .atomic)
                filledURL = url
                Haptics.confirm()
            } catch {
                exportError = "Export failed: \(error.localizedDescription)"
            }
            isExporting = false
        }
    }

    // MARK: - PDF (client-side MVP summary)

    /// Render a simple one-page summary PDF to a temp file and return its URL.
    /// This is NOT the print-faithful form fill — that is a server responsibility.
    private func buildPDF(for c: AnesthesiaCase) -> URL {
        let pageRect = CGRect(x: 0, y: 0, width: 612, height: 792) // US Letter @72dpi
        let margin: CGFloat = 48
        let contentWidth = pageRect.width - margin * 2

        let renderer = UIGraphicsPDFRenderer(bounds: pageRect)
        let data = renderer.pdfData { ctx in
            ctx.beginPage()
            var y: CGFloat = margin

            func draw(_ text: String, font: UIFont, color: UIColor = .label, gap: CGFloat = 6) {
                let attrs: [NSAttributedString.Key: Any] = [.font: font, .foregroundColor: color]
                let s = text as NSString
                let bound = s.boundingRect(
                    with: CGSize(width: contentWidth, height: .greatestFiniteMagnitude),
                    options: [.usesLineFragmentOrigin], attributes: attrs, context: nil)
                s.draw(with: CGRect(x: margin, y: y, width: contentWidth, height: bound.height),
                       options: [.usesLineFragmentOrigin], attributes: attrs, context: nil)
                y += bound.height + gap
            }

            let title = UIFont.boldSystemFont(ofSize: 22)
            let heading = UIFont.boldSystemFont(ofSize: 13)
            let bodyFont = UIFont.systemFont(ofSize: 12)
            let caption = UIFont.systemFont(ofSize: 9)

            draw("TivaTrainer — Case Summary", font: title, gap: 4)
            draw("Generated \(Date().formatted(date: .abbreviated, time: .shortened))",
                 font: caption, color: .secondaryLabel, gap: 16)

            draw("Paciente", font: heading)
            draw("Nombre: \(display(c.patient.nombre))", font: bodyFont)
            draw("Registro: \(display(c.patient.registro))", font: bodyFont)
            draw(String(format: "Edad: %d años   Sexo: %@   IMC: %.1f",
                        Int(c.patient.profile.age),
                        c.patient.profile.gender == .male ? "M" : "F",
                        c.patient.imc), font: bodyFont)
            draw(String(format: "Peso: %.0f kg   Talla: %.0f cm",
                        c.patient.profile.weight, c.patient.profile.height), font: bodyFont, gap: 14)

            draw("Diagnóstico", font: heading)
            draw("Preoperatorio: \(display(c.diagnosticoPreop))", font: bodyFont)
            draw("Postoperatorio: \(display(c.diagnosticoPostop))", font: bodyFont)
            draw("Operación: \(display(c.operacionPropuesta))", font: bodyFont)
            draw("ASA: \(c.asa.map(romanASA) ?? "—")", font: bodyFont, gap: 14)

            draw("Técnica anestésica", font: heading)
            draw("Modalidad: \(c.technique.modality.isEmpty ? "—" : c.technique.modality)", font: bodyFont)
            draw("Fármacos registrados: \(c.drugs.count)", font: bodyFont, gap: 6)
            for d in c.drugs {
                let dose = d.doseValue.map { String(format: "%.1f", $0) } ?? "—"
                let name = d.farmaco.isEmpty ? "(sin nombre)" : d.farmaco
                let label = d.label.isEmpty ? "" : "\(d.label). "
                draw("  \(label)\(name): \(dose) \(d.doseUnit) \(d.via)", font: bodyFont, gap: 3)
            }
            y += 11

            let totals = aldreteTotals(c.recovery)
            draw("Aldrete (recovery)", font: heading)
            if totals.isEmpty {
                draw("No Aldrete score recorded", font: bodyFont, color: .secondaryLabel, gap: 14)
            } else {
                for col in totals {
                    draw("  \(col.point): \(col.total) / 10", font: bodyFont, gap: 3)
                }
                y += 11
            }

            draw("MVP summary only — not the print-faithful form-fill export. The true 1:1 "
                 + "form fill is produced server-side and requires the field-crosswalk and "
                 + "fill-pdf value pass, which are not built yet.",
                 font: caption, color: .secondaryLabel)
        }

        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent("TivaTrainer-Case-Summary.pdf")
        try? data.write(to: url, options: .atomic)
        return url
    }
}

// MARK: - Private sub-widgets (file-scoped, name-prefixed)

/// A read-only label + value row for the review summary.
private struct RE_SummaryRow: View {
    let label: String
    let value: String

    var body: some View {
        HStack {
            Text(label).foregroundStyle(.secondary)
            Spacer()
            Text(value)
                .font(.cellValue)
                .multilineTextAlignment(.trailing)
        }
        .frame(minHeight: Spacing.tapTarget)
        .accessibilityElement(children: .combine)
    }
}

/// The four exportable forms (backend `form_id`s).
private enum FormOption: String, CaseIterable, Identifiable {
    case nota21 = "registro_transanestesico"
    case nota2 = "nota_postanestesica"
    case imssP1 = "imss_valoracion_preanestesica"
    case imssP2 = "imss_registro_anestesia"

    var id: String { rawValue }
    var title: String {
        switch self {
        case .nota21: return "Registro transanestésico"
        case .nota2:  return "Nota postanestésica"
        case .imssP1: return "IMSS · Valoración"
        case .imssP2: return "IMSS · Registro"
        }
    }
}
