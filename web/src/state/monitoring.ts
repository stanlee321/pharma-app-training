/** Transanesthetic Monitoring spec — port of PharmaApp/Views/Monitoring/MonitoringScreen.swift. */
import type { VitalSnapshot } from '../api/types';

/** Swift `MonitoringScreen.monitoringOptions` — keys of `trans_record.monitoring`. */
export const MONITORING_OPTIONS = ['ECG', 'SpO2', 'EtCO2', 'BIS', 'TNM', 'Temp'] as const;

export type SnapshotKey = 'basal' | 'termination';
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
