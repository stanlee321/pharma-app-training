import SwiftUI

/// Persistence port (ADR-2). MVP is online-first behind this protocol; screens depend on
/// a `CaseStore`, never on `URLSession` directly, so a REST/offline impl can be dropped in
/// later without rewiring screens. Phase A ships the in-memory `MockCaseStore`.
@MainActor
protocol CaseStore: AnyObject {
    var cases: [AnesthesiaCase] { get set }
    func createCase(owner: String) -> AnesthesiaCase
    func index(of id: UUID) -> Int?
    func delete(id: UUID)
}

/// In-memory case store — lets the entire frontend build and run with no backend.
@MainActor @Observable
final class MockCaseStore: CaseStore {
    var cases: [AnesthesiaCase]

    init() {
        var demo = AnesthesiaCase()
        demo.owner = "demo"
        demo.patient.nombre = "N. Pérez"
        demo.patient.registro = "TU-2026-0481"
        demo.patient.profile = PatientProfile(weight: 72, height: 161, age: 54, gender: .female, dilution: 10)
        demo.diagnosticoPreop = "Colecistitis aguda"
        demo.sala = "Q3"
        demo.servicio = "Cirugía General"
        self.cases = [demo]
    }

    func createCase(owner: String) -> AnesthesiaCase {
        var c = AnesthesiaCase()
        c.owner = owner
        cases.append(c)
        return c
    }

    func index(of id: UUID) -> Int? {
        cases.firstIndex { $0.id == id }
    }

    func delete(id: UUID) {
        cases.removeAll { $0.id == id }
    }
}
