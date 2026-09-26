/*
 * Anesthetic Technique field spec — the `technique.values` blob keys (schema field ids, crosswalk
 * mode `values_blob`) exactly as PharmaApp/Views/Technique/TechniqueScreen.swift writes them,
 * plus typed read/write helpers mirroring its `boolB` / `numText` / `numDouble` / `textB` /
 * `multiBool` / `modalityBinding` Swift bindings.
 *
 * The blob is shared by all three zones; `technique.modality` is shared too (General "Modalidad"
 * and Neuraxial "Abordaje" both write it, as in Swift).
 */
import { TECHNIQUE_ZONES, type AnestheticTechnique, type TechniqueZone } from '../api/types';
import { techniqueHasData } from './completion';

export type TechniqueValues = AnestheticTechnique['values'];

/** A `checkbox_value` row: `<key>` (bool) + `<key>_val` (number). */
export interface CheckboxValueField {
  label: string;
  unit: string;
  key: string;
}
const cbv = (label: string, unit: string, key: string): CheckboxValueField => ({ label, unit, key });
export const valKey = (key: string) => `${key}_val`;

export const GENERAL = {
  modalities: ['AGIB', 'AGEV', 'BEPD', 'Bloqueo de Plexo'],
  volatiles: ['Sevoflurano', 'Desflurano', 'Isoflurano', 'N2O'],
  volatilPrefix: 'volatil_',
  induccion: [
    cbv('Propofol', 'mg', 'ind_propofol'),
    cbv('Fentanilo', 'mcg', 'ind_fentanilo'),
    cbv('Midazolam', 'mg', 'ind_midazolam'),
    cbv('Rocuronio', 'mg', 'ind_rocuronio'),
  ],
  /** Steppers show a fallback until first touched (Swift `numDouble(_:default:)`). */
  tetCalibre: { key: 'va_tet_calibre', fallback: 7.0, unit: 'mmDI', step: 0.5, min: 5, max: 9 },
  flujo: { key: 'va_flujo', fallback: 2.0, unit: 'L/min', step: 0.5, min: 0.5, max: 10 },
  intubacion: 'va_intubacion',
  ventControlada: 'vent_controlada',
  /** Target Cp of the TCI decision-aid chip (written by TciChipSlot). */
  tciTargetCp: { key: 'tci_target_cp', fallback: 4.0 },
} as const;

export const NEURAXIAL = {
  approach: ['Epidural', 'Subaracnoidea', 'Mixta'],
  needles: ['Tuohy', 'Quincke', 'Whitacre'],
  agujaPrefix: 'aguja_',
  nivel: 'nivel',
  agujaCalibre: 'aguja_calibre',
  dosis: [
    cbv('Bupivacaína', 'mg', 'dx_bupivacaina'),
    cbv('Fentanilo', 'mcg', 'dx_fentanilo'),
    cbv('Morfina', 'mcg', 'dx_morfina'),
  ],
} as const;

export const PERIPHERAL = {
  sitio: 'sitio_bloqueo',
  volumen: 'volumen_ml',
  ecoguiado: 'ecoguiado',
  neuroestimulador: 'neuroestimulador',
  agents: ['Bupivacaína', 'Lidocaína', 'Ropivacaína', 'Mepivacaína'],
  alPrefix: 'al_',
  dosis: [cbv('Concentración', '%', 'dx_concentracion'), cbv('Adrenalina', 'mcg', 'dx_adrenalina')],
} as const;

// ---- readers (Swift getters) ----------------------------------------------------------------

/** `.bool(b)` → b, anything else → false. */
export function getBool(v: TechniqueValues, key: string): boolean {
  return v[key] === true;
}
/** `.number(n)` → n, else null. */
export function getNum(v: TechniqueValues, key: string): number | null {
  const x = v[key];
  return typeof x === 'number' && Number.isFinite(x) ? x : null;
}
/** `.text(t)` → t, else "". */
export function getText(v: TechniqueValues, key: string): string {
  const x = v[key];
  return typeof x === 'string' ? x : '';
}
/** Options whose `<prefix><option>` flag is true (Swift `multiBool` getter). */
export function getFlags(v: TechniqueValues, options: readonly string[], prefix: string): string[] {
  return options.filter((o) => v[prefix + o] === true);
}

// ---- writers (mutate a draft blob; Swift setters) ---------------------------------------------

export function setBool(v: TechniqueValues, key: string, b: boolean): void {
  v[key] = b;
}
/** null → key removed (Swift `values[key] = nil` on empty text). */
export function setNum(v: TechniqueValues, key: string, n: number | null): void {
  if (n === null) delete v[key];
  else v[key] = n;
}
/** Always stores the text, even "" (Swift `textB` setter). */
export function setText(v: TechniqueValues, key: string, t: string): void {
  v[key] = t;
}
/** Writes `<prefix><option>` = selected? for EVERY option (Swift `multiBool` setter). */
export function setFlags(
  v: TechniqueValues,
  options: readonly string[],
  prefix: string,
  selection: readonly string[],
): void {
  for (const o of options) v[prefix + o] = selection.includes(o);
}

// ---- per-zone completion (Hub rows) -----------------------------------------------------------

const cbvKeys = (rows: readonly CheckboxValueField[]) => rows.flatMap((r) => [r.key, valKey(r.key)]);
const flagKeys = (options: readonly string[], prefix: string) => options.map((o) => prefix + o);

/** Every blob key each zone's screen can write. */
export const ZONE_KEYS: Record<TechniqueZone, readonly string[]> = {
  general: [
    ...flagKeys(GENERAL.volatiles, GENERAL.volatilPrefix),
    ...cbvKeys(GENERAL.induccion),
    GENERAL.tetCalibre.key,
    GENERAL.flujo.key,
    GENERAL.intubacion,
    GENERAL.ventControlada,
    GENERAL.tciTargetCp.key,
  ],
  neuraxial: [
    ...flagKeys(NEURAXIAL.needles, NEURAXIAL.agujaPrefix),
    NEURAXIAL.nivel,
    NEURAXIAL.agujaCalibre,
    ...cbvKeys(NEURAXIAL.dosis),
  ],
  peripheral: [
    PERIPHERAL.sitio,
    PERIPHERAL.volumen,
    PERIPHERAL.ecoguiado,
    PERIPHERAL.neuroestimulador,
    ...flagKeys(PERIPHERAL.agents, PERIPHERAL.alPrefix),
    ...cbvKeys(PERIPHERAL.dosis),
  ],
};

const ZONE_MODALITIES: Record<TechniqueZone, readonly string[]> = {
  general: GENERAL.modalities,
  neuraxial: NEURAXIAL.approach,
  peripheral: [],
};

/**
 * Hub completion for one technique zone. Same "any key present" rule as Swift
 * `AnestheticTechnique.hasData` (`!modality.isEmpty || !values.isEmpty`), scoped to the keys and
 * modality options that zone's screen writes.
 */
export function techniqueZoneHasData(t: AnestheticTechnique, zone: TechniqueZone): boolean {
  if (ZONE_MODALITIES[zone].includes(t.modality)) return true;
  return ZONE_KEYS[zone].some((k) => Object.prototype.hasOwnProperty.call(t.values, k));
}

/**
 * Completion flags for the three Hub technique rows. `techniqueHasData` (completion.ts, the Swift
 * `AnestheticTechnique.hasData` rule) stays the source of truth for "any technique data": when it
 * is true but no zone recognises the data (a modality outside every option list, or blob keys
 * outside ZONE_KEYS — e.g. written by an older/newer client or a backend import), the General row
 * is marked filled, since General is where Swift's single technique row lands. So a technique
 * Swift would show green never reads as "not documented" on every row.
 */
export function techniqueZoneCompletion(t: AnestheticTechnique): Record<TechniqueZone, boolean> {
  const out = Object.fromEntries(TECHNIQUE_ZONES.map((z) => [z, techniqueZoneHasData(t, z)])) as Record<
    TechniqueZone,
    boolean
  >;
  if (techniqueHasData(t) && !TECHNIQUE_ZONES.some((z) => out[z])) out.general = true;
  return out;
}
