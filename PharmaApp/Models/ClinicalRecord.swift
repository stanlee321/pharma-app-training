import Foundation

// MARK: - Supporting value types

/// Dynamic field value for the dense checkbox / technique "values blob"
/// (keyed by schema field id). Encoded as a single JSON value.
enum FieldValue: Codable, Sendable, Hashable {
    case bool(Bool)
    case number(Double)
    case text(String)

    init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if let b = try? c.decode(Bool.self) { self = .bool(b) }
        else if let d = try? c.decode(Double.self) { self = .number(d) }
        else { self = .text(try c.decode(String.self)) }
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.singleValueContainer()
        switch self {
        case .bool(let b):   try c.encode(b)
        case .number(let d): try c.encode(d)
        case .text(let t):   try c.encode(t)
        }
    }
}

/// A number + unit (mirrors the backend `Quantity` value object).
struct Quantity: Codable, Sendable, Hashable {
    var value: Double
    var unit: String
}

/// A signer (nombre + clave).
struct Provider: Codable, Sendable, Hashable {
    var nombre: String = ""
    var clave: String = ""
}

/// TCI recommendation shown beside a given dose — client-computed decision aid,
/// not persisted authoritative data (ADR-5).
struct RecommendedDose: Codable, Sendable, Hashable {
    var bolusMl: Double
    var infusionMlHr: Double

    enum CodingKeys: String, CodingKey {
        case bolusMl = "bolus_ml"
        case infusionMlHr = "infusion_ml_hr"
    }
}

// MARK: - Entity DTOs
// Mirror docs/wiki/plans/rest-contract.md §3 (camelCase; in-memory for Phase A).
// Singleton children default to empty non-nil values for clean SwiftUI bindings.

/// Patient (embeds the PK engine's PatientProfile — capture once, parameterise downstream).
struct PatientRecord: Codable, Sendable {
    var profile: PatientProfile = .defaultMale
    var registro: String = ""
    var nombre: String = ""
    var hb: Double? = nil
    var hto: Double? = nil
    var rh: String = ""
    var grupoSanguineo: String = ""
    var cama: String = ""

    enum CodingKeys: String, CodingKey {
        case profile
        case registro
        case nombre
        case hb
        case hto
        case rh
        case grupoSanguineo = "grupo_sanguineo"
        case cama
    }

    // Derived (computed, never stored authoritative)
    var imc: Double {
        let m = profile.height / 100
        return m > 0 ? (profile.weight / (m * m)) : 0
    }
    /// Devine ideal body weight (kg).
    var pesoIdeal: Double {
        let inchesOver60 = max(0, profile.height / 2.54 - 60)
        let base = profile.gender == .male ? 50.0 : 45.5
        return base + 2.3 * inchesOver60
    }
    /// Estimated blood volume (~70 ml/kg).
    var vsc: Double { profile.weight * 70 }
}

struct PreanestheticAssessment: Codable, Sendable {
    var alergia: String = ""
    var dentadura: String = ""
    var cuello: String = ""
    var viaAerea: String = ""
    var estadoPsiquico: String = ""
    var premedicacion: String = ""
    var ayuno: Bool = false
    var consentimiento: Bool = false
    var asa: Int? = nil            // 1..5
    var raq: Int? = nil            // 1..5
    var labs: [String: Double] = [:]   // urea, creatinina, glucosa, hb, hto, ...
    var notes: String = ""

    enum CodingKeys: String, CodingKey {
        case alergia
        case dentadura
        case cuello
        case viaAerea = "via_aerea"
        case estadoPsiquico = "estado_psiquico"
        case premedicacion
        case ayuno
        case consentimiento
        case asa
        case raq
        case labs
        case notes
    }
}

struct AnestheticTechnique: Codable, Sendable {
    var modality: String = ""      // AGIB | AGEV | BEPD | ...
    /// Dense checkbox surface keyed by schema field id (values_blob).
    var values: [String: FieldValue] = [:]
}

struct VitalPoint: Codable, Sendable, Hashable {
    var t: Double
    var value: Double
}

struct VitalSeries: Codable, Sendable {
    var lane: String
    var points: [VitalPoint] = []
}

struct SurgicalEvent: Codable, Sendable {
    var marker: Int
    var t: Double
    var label: String = ""
}

struct VitalSnapshot: Codable, Sendable {
    var fc: Double? = nil
    var fr: Double? = nil
    var taSys: Double? = nil
    var taDia: Double? = nil
    var spo2: Double? = nil
    var pvc: Double? = nil

    enum CodingKeys: String, CodingKey {
        case fc
        case fr
        case taSys = "ta_sys"
        case taDia = "ta_dia"
        case spo2
        case pvc
    }
}

struct TransanestheticRecord: Codable, Sendable {
    var series: [VitalSeries] = []
    var events: [SurgicalEvent] = []
    var monitoring: [String: Bool] = [:]
    var basal: VitalSnapshot = VitalSnapshot()
    var termination: VitalSnapshot = VitalSnapshot()
    var complicaciones: String = ""
}

struct DrugAdministration: Codable, Sendable, Identifiable {
    var id: UUID = UUID()
    var label: String = ""         // A..O / A..M
    var farmaco: String = ""
    var doseValue: Double? = nil
    var doseUnit: String = "mg"
    var via: String = "IV"
    var time: Date? = nil
    var recommended: RecommendedDose? = nil   // client-computed (ADR-5)
    var rustModelId: String? = nil            // set if a modelled TCI agent

    enum CodingKeys: String, CodingKey {
        case id
        case label
        case farmaco
        case doseValue = "dose_value"
        case doseUnit = "dose_unit"
        case via
        case time
        case recommended
        case rustModelId = "rust_model_id"
    }
}

struct FluidBalance: Codable, Sendable {
    /// row_id -> hour ("1hr".."5hr") -> ml
    var matrix: [String: [String: Double]] = [:]
    var bloodComponents: [String: Bool] = [:]

    enum CodingKeys: String, CodingKey {
        case matrix
        case bloodComponents = "blood_components"
    }
}

struct RecoveryScore: Codable, Sendable {
    /// criterion -> time_point -> 0/1/2
    var aldrete: [String: [String: Int]] = [:]
    var otras: [String: Int] = [:]   // ramsay, bromage, ena
    var altaAPiso: String = ""
    var medicoResponsable: String = ""

    enum CodingKeys: String, CodingKey {
        case aldrete
        case otras
        case altaAPiso = "alta_a_piso"
        case medicoResponsable = "medico_responsable"
    }
}

struct NewbornRecord: Codable, Sendable, Identifiable {
    var id: UUID = UUID()
    var sexo: String = ""
    var pesoGramos: Double? = nil
    var tallaCm: Double? = nil
    var apgar1: Int? = nil
    var apgar5: Int? = nil
    var apgar10: Int? = nil

    enum CodingKeys: String, CodingKey {
        case id
        case sexo
        case pesoGramos = "peso_gramos"
        case tallaCm = "talla_cm"
        case apgar1
        case apgar5
        case apgar10
    }
}

// MARK: - Aggregate root

/// The AnesthesiaCase aggregate — the system of record everything hangs off.
struct AnesthesiaCase: Codable, Sendable, Identifiable {
    var id: UUID = UUID()
    var createdAt: Date = Date()
    var owner: String = ""          // author (ADR-3)

    // Envelope (root fields)
    var fecha: Date = Date()
    var sala: String = ""
    var servicio: String = ""
    var turno: String = ""
    var tipoAdmision: String = ""   // urgencia | electiva
    var diagnosticoPreop: String = ""
    var diagnosticoPostop: String = ""
    var operacionPropuesta: String = ""
    var operacionRealizada: String = ""
    var asa: Int? = nil
    var raq: Int? = nil
    var anestesiologo: Provider = Provider()
    var cirujano: Provider = Provider()

    // Singleton children
    var patient: PatientRecord = PatientRecord()
    var preAssessment: PreanestheticAssessment = PreanestheticAssessment()
    var technique: AnestheticTechnique = AnestheticTechnique()
    var transRecord: TransanestheticRecord = TransanestheticRecord()
    var fluidBalance: FluidBalance = FluidBalance()
    var recovery: RecoveryScore = RecoveryScore()

    // Collections
    var drugs: [DrugAdministration] = []
    var newborns: [NewbornRecord] = []

    enum CodingKeys: String, CodingKey {
        case id
        case createdAt = "created_at"
        case owner
        case fecha
        case sala
        case servicio
        case turno
        case tipoAdmision = "tipo_admision"
        case diagnosticoPreop = "diagnostico_preop"
        case diagnosticoPostop = "diagnostico_postop"
        case operacionPropuesta = "operacion_propuesta"
        case operacionRealizada = "operacion_realizada"
        case asa
        case raq
        case anestesiologo
        case cirujano
        case patient
        case preAssessment = "pre_assessment"
        case technique
        case transRecord = "trans_record"
        case fluidBalance = "fluid_balance"
        case recovery
        case drugs
        case newborns
    }

    // Convenience
    var title: String {
        patient.nombre.isEmpty ? "Untitled case" : patient.nombre
    }
    var subtitle: String {
        diagnosticoPreop.isEmpty ? "No diagnosis" : diagnosticoPreop
    }
}
