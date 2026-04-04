import Foundation

/// A drug + PK/PD model combination loaded from the drug database JSON.
struct DrugModel: Codable, Identifiable, Sendable {
    let id: String                  // e.g. "propofol_marsh"
    let drug: String                // e.g. "Propofol"
    let model: String               // e.g. "Marsh"
    let description: String
    let publication: Publication
    let comments: String?
    let concentrationUnit: ConcentrationUnit
    let targetEffects: [String]     // e.g. ["Plasma", "Effect-site"]
    let manualDosingRules: String?
    let preparationRecipe: String?  // e.g. "2 ml Dexmedetomidine + 45 ml NaCl 0.9%"
    let defaultDilutionMgMl: Double
    let validationRules: ValidationRules
    let rustModelId: String         // maps to Rust engine model ID

    struct Publication: Codable, Sendable {
        let title: String
        let url: String?
    }

    /// Display name for picker: "Propofol [Marsh]"
    var pickerLabel: String {
        "\(drug) [\(model)]"
    }
}

/// Loads the drug model database from the bundled JSON.
enum DrugDatabase {
    static func load() -> [DrugModel] {
        guard let url = Bundle.main.url(forResource: "drug_models", withExtension: "json"),
              let data = try? Data(contentsOf: url) else {
            // Fallback to hardcoded models during development
            return Self.hardcoded
        }
        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        return (try? decoder.decode([DrugModel].self, from: data)) ?? Self.hardcoded
    }

    /// Hardcoded models for development before JSON is finalized.
    static let hardcoded: [DrugModel] = [
        DrugModel(
            id: "propofol_marsh",
            drug: "Propofol",
            model: "Marsh",
            description: "Implemented in Diprifusor https://eurosiva.eu",
            publication: .init(title: "Br. J Anaesthesia 1991;67:41-48", url: "https://eurosiva.eu"),
            comments: nil,
            concentrationUnit: .mcgPerMl,
            targetEffects: ["Plasma", "Effect-site"],
            manualDosingRules: nil,
            preparationRecipe: "Propofol 1% (10 mg/ml)",
            defaultDilutionMgMl: 10.0,
            validationRules: ValidationRules(
                minWeight: 30, maxWeight: 150, minHeight: 100, maxHeight: 220,
                minAge: 1, maxAge: 99, requiresHeight: false, requiresGender: false
            ),
            rustModelId: "marsh"
        ),
        DrugModel(
            id: "propofol_schnider",
            drug: "Propofol",
            model: "Schnider",
            description: "Age, weight, height, and LBM-adjusted model",
            publication: .init(title: "Anesthesiology 1998;88:1170-82", url: nil),
            comments: "Effect-site targeting recommended",
            concentrationUnit: .mcgPerMl,
            targetEffects: ["Effect-site", "Plasma"],
            manualDosingRules: nil,
            preparationRecipe: "Propofol 1% (10 mg/ml)",
            defaultDilutionMgMl: 10.0,
            validationRules: ValidationRules(
                minWeight: 44, maxWeight: 123, minHeight: 155, maxHeight: 196,
                minAge: 18, maxAge: 88, requiresHeight: true, requiresGender: true
            ),
            rustModelId: "schnider"
        ),
        DrugModel(
            id: "remifentanil_minto",
            drug: "Remifentanil",
            model: "Minto",
            description: "Opioid PK model with age and LBM covariates",
            publication: .init(title: "Anesthesiology 1997;86:24-33", url: nil),
            comments: "Ultra-short acting opioid. Context-sensitive half-time ~3-4 min.",
            concentrationUnit: .ngPerMl,
            targetEffects: ["Effect-site", "Plasma"],
            manualDosingRules: nil,
            preparationRecipe: "Remifentanil 1mg + 50ml NaCl 0.9% (20 mcg/ml)",
            defaultDilutionMgMl: 0.02,
            validationRules: ValidationRules(
                minWeight: 30, maxWeight: 150, minHeight: 150, maxHeight: 200,
                minAge: 18, maxAge: 90, requiresHeight: true, requiresGender: true
            ),
            rustModelId: "minto"
        ),
        DrugModel(
            id: "dexmedetomidine_hannivoort",
            drug: "Dexmedetomidine",
            model: "Hannivoort",
            description: "British Journal of Anaesthesia, 115(2): 200-10 (2017)",
            publication: .init(title: "Hannivoort et al. 2015", url: nil),
            comments: """
                FULL PHARMACODYNAMICS IMPLEMENTED
                sedation 0.2 to 2.0 ng/ml blood concentration
                (supra) additive interaction with other sedatives and opioids exist
                Target effect: Heart rate(bradycardia)
                """,
            concentrationUnit: .ngPerMl,
            targetEffects: ["Effect-site", "Plasma"],
            manualDosingRules: "loading dose 1 mcg/kg over 10 minutes\nelderly patient: 0.5 mcg/kg over 10 minutes",
            preparationRecipe: "2 ml Dexmedetomidine + 45 ml NaCl 0.9%",
            defaultDilutionMgMl: 0.004,
            validationRules: ValidationRules(
                minWeight: 45, maxWeight: 120, minHeight: 100, maxHeight: 220,
                minAge: 18, maxAge: 80, requiresHeight: false, requiresGender: false
            ),
            rustModelId: "hannivoort"
        ),
    ]
}
