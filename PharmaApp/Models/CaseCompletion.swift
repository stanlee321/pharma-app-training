import Foundation

/// Section-completion flags for the Encounter Hub: empty sections read blue ("to do"),
/// sections with any captured data read green ("done").

extension PatientRecord {
    var hasData: Bool {
        !nombre.isEmpty || !registro.isEmpty || hb != nil || hto != nil
            || !rh.isEmpty || !grupoSanguineo.isEmpty || !cama.isEmpty
    }
}

extension PreanestheticAssessment {
    var hasData: Bool {
        !alergia.isEmpty || !dentadura.isEmpty || !cuello.isEmpty || !viaAerea.isEmpty
            || !estadoPsiquico.isEmpty || !premedicacion.isEmpty || !notes.isEmpty
            || ayuno || consentimiento || asa != nil || raq != nil || !labs.isEmpty
    }
}

extension AnestheticTechnique {
    var hasData: Bool { !modality.isEmpty || !values.isEmpty }
}

extension TransanestheticRecord {
    var hasData: Bool {
        !series.isEmpty || !events.isEmpty || !monitoring.isEmpty || !complicaciones.isEmpty
            || basal.fc != nil || basal.spo2 != nil || basal.taSys != nil
    }
}

extension FluidBalance {
    var hasData: Bool { !matrix.isEmpty || !bloodComponents.isEmpty }
}

extension RecoveryScore {
    var hasData: Bool { !aldrete.isEmpty || !otras.isEmpty || !altaAPiso.isEmpty }
}
