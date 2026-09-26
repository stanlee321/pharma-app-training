import { DRUG_DATABASE } from '../engine/drugDatabase';

/**
 * The drug-model catalogue the Drug Ledger picker offers — port of
 * PharmaApp/Resources/drug_models.json (the fields the ledger uses), read from the engine's copy
 * (src/engine/drug_models.json) so the picker and the engine can never disagree. `rustModelId` is the engine
 * model key persisted as `rust_model_id`; `pickerLabel` is Swift `DrugModel.pickerLabel`.
 */
export interface DrugModelEntry {
  id: string;
  drug: string;
  model: string;
  rustModelId: string;
}

export const DRUG_MODELS: readonly DrugModelEntry[] = DRUG_DATABASE.map(({ id, drug, model, rustModelId }) => ({
  id,
  drug,
  model,
  rustModelId,
}));

/** Swift `DrugModel.pickerLabel`: "Propofol [Marsh]". */
export const pickerLabel = (m: DrugModelEntry) => `${m.drug} [${m.model}]`;

/**
 * Swift `DrugLedgerRowEditor.matchedModel`: the first model whose picker label or bare drug name
 * equals the trimmed text ("Propofol" → Marsh, the first Propofol entry), else undefined.
 */
export function matchedModel(name: string): DrugModelEntry | undefined {
  const t = name.trim();
  if (t === '') return undefined;
  return DRUG_MODELS.find((m) => pickerLabel(m) === t || m.drug === t);
}
