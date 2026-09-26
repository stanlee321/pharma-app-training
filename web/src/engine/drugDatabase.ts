/**
 * Port of Swift `DrugModel` / `DrugDatabase.load()`: the bundled drug_models.json (a verbatim copy
 * of PharmaApp/Resources/drug_models.json), decoded snake_case → camelCase like Swift's
 * `.convertFromSnakeCase`. `rustModelId` is the engine key (`computeTCI(modelId, …)`).
 */
import raw from './drug_models.json';
import type { ConcentrationUnit } from './types';

export interface ValidationRules {
  minWeight: number;
  maxWeight: number;
  minHeight: number;
  maxHeight: number;
  minAge: number;
  maxAge: number;
  requiresHeight: boolean;
  requiresGender: boolean;
}

export interface DrugModel {
  id: string;
  drug: string;
  model: string;
  description: string;
  publication: { title: string; url: string | null };
  comments: string | null;
  concentrationUnit: ConcentrationUnit;
  targetEffects: string[];
  manualDosingRules: string | null;
  preparationRecipe: string | null;
  defaultDilutionMgMl: number;
  validationRules: ValidationRules;
  rustModelId: string;
}

type RawValidation = (typeof raw)[number]['validation_rules'];

function decodeRules(r: RawValidation): ValidationRules {
  return {
    minWeight: r.min_weight,
    maxWeight: r.max_weight,
    minHeight: r.min_height,
    maxHeight: r.max_height,
    minAge: r.min_age,
    maxAge: r.max_age,
    requiresHeight: r.requires_height,
    requiresGender: r.requires_gender,
  };
}

export const DRUG_DATABASE: readonly DrugModel[] = raw.map((m) => ({
  id: m.id,
  drug: m.drug,
  model: m.model,
  description: m.description,
  publication: { title: m.publication.title, url: m.publication.url },
  comments: m.comments,
  concentrationUnit: m.concentration_unit as ConcentrationUnit,
  targetEffects: m.target_effects,
  manualDosingRules: m.manual_dosing_rules,
  preparationRecipe: m.preparation_recipe,
  defaultDilutionMgMl: m.default_dilution_mg_ml,
  validationRules: decodeRules(m.validation_rules),
  rustModelId: m.rust_model_id,
}));

/** Swift `MockPKEngine.validationRules(for:)`. */
export function validationRules(modelId: string): ValidationRules | null {
  return DRUG_DATABASE.find((m) => m.rustModelId === modelId)?.validationRules ?? null;
}
