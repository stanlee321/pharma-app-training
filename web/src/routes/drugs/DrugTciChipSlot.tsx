import type { PatientProfile } from '../../api/types';
import { Icon } from '../../components/Icon';
import { computeTCI, toEnginePatient, ZERO_STATE } from '../../engine';

/** Swift `DrugLedgerRowEditor.defaultTargetCp` — plasma target (display units) of the chip. */
export const DRUG_TCI_DEFAULT_TARGET_CP = 3.0;

/**
 * Drug Ledger TCI recommendation chip — port of Swift `DrugLedgerRowEditor.tciChip`. Rendered only
 * for rows with a `rust_model_id`: `computeTCI(modelId, patient, [0,0,0,0], targetCp, plasma)`
 * shown as "TCI: %.1f ml bolus · %.1f ml/h" (sparkles in infusion orange) with a trailing
 * "@ %.1f" target caption; renders nothing when the engine has no result (unknown model id).
 * Client-side decision aid (ADR-5): never persisted — DrugAdministrationDTO has no `recommended`.
 */
export interface DrugTciChipSlotProps {
  modelId: string;
  patient: PatientProfile;
  targetCp: number;
}

export function DrugTciChipSlot({ modelId, patient, targetCp }: DrugTciChipSlotProps) {
  const tci = computeTCI(modelId, toEnginePatient(patient), ZERO_STATE, targetCp, 'plasma');
  if (!tci) return null;
  const text = `TCI: bolo ${tci.bolusMl.toFixed(1)} ml · ${tci.infusionRateMlHr.toFixed(1)} ml/h`;
  const caption = `@ ${targetCp.toFixed(1)}`;
  return (
    <div
      className="drug-tci-chip"
      data-slot="drug-tci-chip"
      data-model-id={modelId}
      data-target-cp={targetCp}
      role="group"
      aria-label="Dosis TCI recomendada"
    >
      <Icon name="sparkles" size={16} />
      <span className="drug-tci-chip__text">{text}</span>
      <span className="drug-tci-chip__caption">{caption}</span>
    </div>
  );
}
