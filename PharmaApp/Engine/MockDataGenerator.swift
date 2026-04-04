import Foundation

/// Generates and exports mock simulation data as JSON files.
/// Run `MockDataGenerator.generateAll()` once during development to create
/// snapshot files in Resources/MockData/ for previews and unit tests.
///
/// You can also use these JSON files directly in SwiftUI previews
/// without running the mock engine.
enum MockDataGenerator {

    /// Generate all standard test scenarios and write to disk.
    static func generateAll(outputDir: URL) async {
        let engine = MockPKEngine()

        // Scenario 1: Propofol Marsh, 70kg male, target 4 mcg/ml
        if let result = await engine.simulate(
            modelId: "marsh",
            patient: .defaultMale,
            targets: [TargetEvent(time: 0, concentration: 4.0, targetType: .plasma)],
            timeRangeSeconds: 1800,  // 30 minutes
            resolutionSeconds: 1.0
        ) {
            write(result, to: outputDir.appendingPathComponent("marsh_70kg_target4_plasma.json"))
        }

        // Scenario 2: Propofol Marsh, step up then step down
        if let result = await engine.simulate(
            modelId: "marsh",
            patient: .defaultMale,
            targets: [
                TargetEvent(time: 0, concentration: 4.0, targetType: .plasma),
                TargetEvent(time: 600, concentration: 6.0, targetType: .plasma),
                TargetEvent(time: 1200, concentration: 2.0, targetType: .plasma),
            ],
            timeRangeSeconds: 1800,
            resolutionSeconds: 1.0
        ) {
            write(result, to: outputDir.appendingPathComponent("marsh_70kg_multitarget.json"))
        }

        // Scenario 3: Dexmedetomidine Hannivoort, 80kg, target 0.8 ng/ml
        let dexPatient = PatientProfile(weight: 80, height: 170, age: 40, gender: .male, dilution: 0.004)
        if let result = await engine.simulate(
            modelId: "hannivoort",
            patient: dexPatient,
            targets: [TargetEvent(time: 0, concentration: 0.8, targetType: .plasma)],
            timeRangeSeconds: 1800,
            resolutionSeconds: 1.0
        ) {
            write(result, to: outputDir.appendingPathComponent("hannivoort_80kg_target08ng.json"))
        }

        // Scenario 4: Schnider, 60kg female, effect-site targeting
        let schniderPatient = PatientProfile(weight: 60, height: 160, age: 50, gender: .female, dilution: 10.0)
        if let result = await engine.simulate(
            modelId: "schnider",
            patient: schniderPatient,
            targets: [TargetEvent(time: 0, concentration: 3.0, targetType: .effectSite)],
            timeRangeSeconds: 1800,
            resolutionSeconds: 1.0
        ) {
            write(result, to: outputDir.appendingPathComponent("schnider_60kg_target3_effect.json"))
        }

        // Scenario 5: Remifentanil Minto, 70kg male, target 4 ng/ml
        let mintoPatient = PatientProfile(weight: 70, height: 170, age: 40, gender: .male, dilution: 0.02)
        if let result = await engine.simulate(
            modelId: "minto",
            patient: mintoPatient,
            targets: [TargetEvent(time: 0, concentration: 4.0, targetType: .effectSite)],
            timeRangeSeconds: 1800,
            resolutionSeconds: 1.0
        ) {
            write(result, to: outputDir.appendingPathComponent("minto_70kg_target4ng_effect.json"))
        }
    }

    private static func write(_ output: SimulationOutput, to url: URL) {
        let encoder = JSONEncoder()
        encoder.keyEncodingStrategy = .convertToSnakeCase
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        guard let data = try? encoder.encode(output) else { return }
        try? data.write(to: url)
    }

    /// Load a previously generated snapshot from a JSON file.
    static func loadSnapshot(named filename: String) -> SimulationOutput? {
        // Try bundle first (for app), then MockData directory (for previews)
        let url = Bundle.main.url(forResource: filename, withExtension: nil)
            ?? Bundle.main.url(
                forResource: filename.replacingOccurrences(of: ".json", with: ""),
                withExtension: "json",
                subdirectory: "MockData"
            )
        guard let url, let data = try? Data(contentsOf: url) else { return nil }
        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        return try? decoder.decode(SimulationOutput.self, from: data)
    }
}
