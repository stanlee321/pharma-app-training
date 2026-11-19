/** Transanesthetic Monitoring spec — port of PharmaApp/Views/Monitoring/MonitoringScreen.swift. */
import type { VitalSnapshot } from '../api/types';

/**
 * Keys of `trans_record.monitoring` (Swift `monitoringOptions` plus the clinician feedback 2026-11
 * monitors: Entropía, NINDEX, Neuromonitorización, POCUS). Selecting one shows its row in the
 * intraoperative grid (state/timeGrid.ts).
 */
export const MONITORING_OPTIONS = [
  'ECG',
  'SpO2',
  'EtCO2',
  'BIS',
  'Entropía',
  'NINDEX',
  'TNM',
  'Neuromonitorización',
  'POCUS',
  'Temp',
] as const;

export type SnapshotKey = 'basal' | 'termination';

/** Snapshot section titles (clinician wording, 2026-11: "signos al finalizar la cirugía"). */
export const SNAPSHOT_TITLES: Record<SnapshotKey, string> = {
  basal: 'Signos en reposo (basales)',
  termination: 'Signos al finalizar la cirugía',
};

/** Intercurrencias: events not caused by the medical act (e.g. a power outage in the OR). */
export const INTERCURRENCIAS = [
  'Corte de energía eléctrica',
  'Falla de equipo',
  'Falla en el suministro de gases medicinales',
  'Falta de insumos o medicamentos',
  'Falla de comunicación o sistemas',
  'Otra',
] as const;
export type VitalKey = keyof Pick<VitalSnapshot, 'fc' | 'fr' | 'ta_sys' | 'ta_dia' | 'spo2'>;

/** The five snapshot rows, in Swift order (label, unit, key). PVC has no row in Swift. */
export const VITAL_ROWS: readonly { label: string; unit: string; key: VitalKey }[] = [
  { label: 'FC', unit: 'lpm', key: 'fc' },
  { label: 'FR', unit: 'rpm', key: 'fr' },
  { label: 'TA sist.', unit: 'mmHg', key: 'ta_sys' },
  { label: 'TA diast.', unit: 'mmHg', key: 'ta_dia' },
  { label: 'SpO₂', unit: '%', key: 'spo2' },
];

/** Swift `MonitoringVitalsMiniChart` metrics (name, snapshot key). */
const METRICS = [
  { name: 'FC', key: 'fc', color: 'var(--chart-1)' },
  { name: 'TA sist.', key: 'ta_sys', color: 'var(--chart-2)' },
  { name: 'SpO₂', key: 'spo2', color: 'var(--chart-3)' },
] as const;

interface Sample {
  x: 0 | 1; // 0 = basal, 1 = fin
  value: number;
}

/** Samples per metric, exactly as the Swift chart builds them (missing values are skipped). */
export function trendSamples(basal: VitalSnapshot, termination: VitalSnapshot) {
  return METRICS.map((m) => {
    const pts: Sample[] = [];
    const b = basal[m.key];
    const t = termination[m.key];
    if (b != null) pts.push({ x: 0, value: b });
    if (t != null) pts.push({ x: 1, value: t });
    return { ...m, points: pts };
  }).filter((m) => m.points.length > 0);
}
