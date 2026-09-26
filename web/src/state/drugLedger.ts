/** Drug Ledger row spec — port of PharmaApp/Views/DrugLedger/DrugLedgerScreen.swift. */
import type { DrugAdministration } from '../api/types';
import { newUUID } from '../lib/uuid';

/** Swift `DrugLedgerRowEditor.units` / `.routes` / `.doseStep`. */
export const DOSE_UNITS = ['mg', 'mcg', 'g', 'ml', 'mcg/kg', 'mcg/kg/min', 'UI'] as const;
export const ROUTES = ['IV', 'IM', 'SC', 'VO', 'Epidural', 'Intratecal', 'Inhalatoria', 'Tópica'] as const;
export const DOSE_STEP = 5;

/** Swift `DrugAdministration()` defaults. */
export function newDrug(): DrugAdministration {
  return { id: newUUID(), label: '', farmaco: '', dose_value: null, dose_unit: 'mg', via: 'IV', time: null, rust_model_id: null };
}

/** Swift `isIncomplete`: no drug name (trimmed) or no dose value → red bar. */
export const drugIsIncomplete = (d: DrugAdministration) => d.farmaco.trim() === '' || d.dose_value == null;

/** Row letter shown beside each row (the nota21 / imss_p2 A…O / A…M row the entry exports to, by position). */
export const rowLetter = (i: number) => (i < 26 ? String.fromCharCode(65 + i) : String(i + 1));
