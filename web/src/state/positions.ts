/**
 * Operative positions and their standard graphic symbols (clinician feedback 2026-11b, item 14;
 * after the "Símbolos gráficos para posiciones operatorias" reference sheet). Stored in the time
 * grid as lane `posicion` (value = key) and printed in the transanesthetic record's "Posición"
 * row. Geometry mirrors backend `render/extras.py` POSITIONS — keep the two in sync.
 *
 * Unit box: x 0..1 (head at the left), y 0..1 downwards.
 */
type P = readonly [number, number];
export interface PositionDef {
  key: string;
  label: string;
  head: P;
  lines: readonly (readonly P[])[];
  arrows: readonly (readonly [P, P])[];
}

const SUPINE: readonly P[] = [
  [0.05, 0.62],
  [1, 0.62],
  [1, 0.4],
];

export const POSITIONS: readonly PositionDef[] = [
  { key: 'supina', label: 'Supina', head: [0.1, 0.3], lines: [SUPINE], arrows: [] },
  { key: 'prona', label: 'Prona', head: [0.1, 0.72], lines: [[[0.05, 0.38], [1, 0.38], [1, 0.58]]], arrows: [] },
  { key: 'cabeza_alta', label: 'Cabeza alta', head: [0.1, 0.22], lines: [[[0.08, 0.42], [1, 0.88], [1, 0.68]]], arrows: [] },
  { key: 'cabeza_baja', label: 'Cabeza baja', head: [0.1, 0.72], lines: [[[0.14, 0.62], [1, 0.22], [1, 0.02]]], arrows: [] },
  {
    key: 'trendelenburg',
    label: 'Trendelenburg',
    head: [0.08, 0.72],
    lines: [[[0.12, 0.82], [0.5, 0.28], [1, 0.28], [1, 0.08]]],
    arrows: [],
  },
  {
    key: 'litotomia',
    label: 'Litotomía',
    head: [0.08, 0.72],
    lines: [[[0.13, 0.86], [0.6, 0.86], [0.6, 0.3], [1, 0.3], [1, 0.1]]],
    arrows: [],
  },
  { key: 'lateral_derecha', label: 'Lateral derecha', head: [0.1, 0.3], lines: [SUPINE], arrows: [[[0.25, 1], [0.7, 0.05]]] },
  { key: 'lateral_izquierda', label: 'Lateral izquierda', head: [0.1, 0.3], lines: [SUPINE], arrows: [[[0.75, 1], [0.3, 0.05]]] },
  {
    key: 'renal_derecha',
    label: 'Renal derecha',
    head: [0.1, 0.3],
    lines: [
      [[0.05, 0.55], [1, 0.55], [1, 0.35]],
      [[0.3, 0.95], [0.42, 0.62], [0.54, 0.95]],
    ],
    arrows: [[[0.5, 0.95], [0.85, 0.2]]],
  },
  {
    key: 'renal_izquierda',
    label: 'Renal izquierda',
    head: [0.1, 0.3],
    lines: [
      [[0.05, 0.55], [1, 0.55], [1, 0.35]],
      [[0.46, 0.95], [0.58, 0.62], [0.7, 0.95]],
    ],
    arrows: [[[0.5, 0.95], [0.18, 0.2]]],
  },
  {
    key: 'raquilateral_derecha',
    label: 'Raqui-lateral derecha',
    head: [0.12, 0.35],
    lines: [[[0.18, 0.62], [0.6, 0.9], [0.95, 0.55], [0.6, 0.35], [0.95, 0.12]]],
    arrows: [],
  },
  {
    key: 'colecistectomia',
    label: 'Colecistectomía',
    head: [0.1, 0.62],
    lines: [[[0.16, 0.66], [0.5, 0.25], [1, 0.7], [1, 0.9]]],
    arrows: [],
  },
  {
    key: 'raquilateral_izquierda',
    label: 'Raqui-lateral izquierda',
    head: [0.1, 0.78],
    lines: [[[0.15, 0.6], [0.5, 0.18], [0.95, 0.28], [0.6, 0.6], [0.95, 0.85]]],
    arrows: [],
  },
  {
    key: 'litotomia_avanzada',
    label: 'Litotomía avanzada',
    head: [0.08, 0.75],
    lines: [[[0.13, 0.86], [0.6, 0.86], [0.4, 0.2], [1, 0.2], [1, 0.02]]],
    arrows: [],
  },
  {
    key: 'semisentada',
    label: 'Semisentada',
    head: [0.12, 0.12],
    lines: [[[0.14, 0.3], [0.38, 0.6], [0.68, 0.6], [0.95, 0.98]]],
    arrows: [],
  },
  {
    key: 'sentada',
    label: 'Sentada',
    head: [0.4, 0.1],
    lines: [[[0.32, 0.25], [0.32, 0.6], [0.68, 0.6], [0.68, 0.98], [0.95, 0.98]]],
    arrows: [],
  },
  { key: 'kerr', label: 'Kerr', head: [0.1, 0.8], lines: [[[0.15, 0.68], [0.52, 0.1], [0.95, 0.68], [0.95, 0.85]]], arrows: [] },
];

export const POSITION_LANE = 'posicion';

export const positionDef = (key: string | null | undefined) => POSITIONS.find((p) => p.key === key);
