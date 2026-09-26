import type { PatientProfile } from '../../api/types';
import { StepperRow } from '../../components/FormRows';
import { Icon } from '../../components/Icon';
import { computeTCI, toEnginePatient, ZERO_STATE } from '../../engine';

/**
 * Technique TCI decision aid — port of Swift `TechTCIChip` (TechniqueScreen.swift): a "Target Cp"
 * stepper (mcg/ml, step 0.5, 1…8, 1 decimal) bound to the technique blob key `tci_target_cp`
 * (written through `onTargetCpChange`), plus the engine's
 * `computeTCI(modelId, patient, [0,0,0,0], targetCp, plasma)` recommendation recomputed on every
 * render: "Bolo %.1f ml" (plasma cyan) and "%.1f ml/h" (infusion orange), or
 * "Sin recomendación disponible". The recommendation itself is never persisted (ADR-5; no DTO has
 * a `recommended` field) — only the target the clinician chose is.
 */
export interface TciChipSlotProps {
  /** Engine model key (`DrugModel.rustModelId`), e.g. "marsh" for Propofol. */
  modelId: string;
  patient: PatientProfile;
  targetCp: number;
  onTargetCpChange: (value: number) => void;
}

export function TciChipSlot({ modelId, patient, targetCp, onTargetCpChange }: TciChipSlotProps) {
  const rec = computeTCI(modelId, toEnginePatient(patient), ZERO_STATE, targetCp, 'plasma');
  return (
    <div className="tci-chip" data-slot="tci-chip" data-model-id={modelId}>
      <StepperRow
        label="Target Cp"
        value={targetCp}
        onChange={onTargetCpChange}
        unit="mcg/ml"
        step={0.5}
        min={1}
        max={8}
        decimals={1}
      />
      <div className="row tci-chip__result" aria-live="polite">
        {rec ? (
          <>
            <span className="tci-chip__item tci-chip__item--plasma" data-testid="tci-bolus">
              <Icon name="syringe" size={14} />
              {`Bolo ${rec.bolusMl.toFixed(1)} ml`}
            </span>
            <span className="tci-chip__item tci-chip__item--infusion" data-testid="tci-infusion">
              <Icon name="drop" size={14} />
              {`${rec.infusionRateMlHr.toFixed(1)} ml/h`}
            </span>
          </>
        ) : (
          <span className="tci-chip__none">Sin recomendación disponible</span>
        )}
      </div>
    </div>
  );
}
