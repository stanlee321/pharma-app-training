/** Drug Ledger row spec — port of PharmaApp/Views/DrugLedger/DrugLedgerScreen.swift. */
import type { DrugAdministration } from '../api/types';
import { newUUID } from '../lib/uuid';

/** Swift `DrugLedgerRowEditor.units` / `.routes` / `.doseStep`. */
export const DOSE_UNITS = ['mg', 'mcg', 'g', 'ml', 'mcg/kg', 'mcg/kg/min', 'UI'] as const;
/** Rate units offered for a continuous infusion (clinician feedback 2026-11, item 9). */
export const RATE_UNITS = ['mcg/kg/min', 'mcg/min', 'mcg/kg/h', 'mg/kg/h', 'mg/h', 'ml/h', 'UI/h', 'UI/min'] as const;

/** `modo`: a single dose or a continuous infusion (started at `time`, stopped at `fin`). */
export const DRUG_MODES = [
  { value: 'bolo', label: 'Bolo' },
  { value: 'infusion', label: 'Infusión continua' },
] as const;
export type DrugMode = (typeof DRUG_MODES)[number]['value'];
export const isInfusion = (d: Pick<DrugAdministration, 'modo'>) => d.modo === 'infusion';
export const ROUTES = ['IV', 'IM', 'SC', 'VO', 'Epidural', 'Intratecal', 'Inhalatoria', 'Tópica'] as const;
export const DOSE_STEP = 5;

/**
 * Swift `DrugAdministration()` defaults, except the time: a new row starts at the current minute,
 * so its letter lands on the transanesthetic grid (clinician feedback 2026-11b, item 9).
 */
export function newDrug(now: Date = new Date()): DrugAdministration {
  const at = new Date(now);
  at.setSeconds(0, 0);
  return {
    id: newUUID(),
    label: '',
    farmaco: '',
    dose_value: null,
    dose_unit: 'mg',
    via: 'IV',
    time: at.toISOString(),
    modo: 'bolo',
    fin: null,
    rust_model_id: null,
  };
}

/** Swift `isIncomplete`: no drug name (trimmed) or no dose value → red bar. */
export const drugIsIncomplete = (d: DrugAdministration) => d.farmaco.trim() === '' || d.dose_value == null;

/** Row letter shown beside each row (the nota21 / imss_p2 A…O / A…M row the entry exports to, by position). */
export const rowLetter = (i: number) => (i < 26 ? String.fromCharCode(65 + i) : String(i + 1));
