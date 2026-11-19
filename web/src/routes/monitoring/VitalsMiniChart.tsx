import type { VitalSnapshot } from '../../api/types';
import { trendSamples } from '../../state/monitoring';

const W = 320;
const H = 150;
const PAD = { l: 34, r: 12, t: 10, b: 22 };

/**
 * Reposo (basal) → fin de la cirugía trend of FC / TA sist. / SpO₂ (port of the Swift Charts demo): x domain −0.2…1.2
 * with ticks "Basal" / "Fin", one line + points per metric, legend below. Hand-drawn SVG.
 */
export function VitalsMiniChart({ basal, termination }: { basal: VitalSnapshot; termination: VitalSnapshot }) {
  const series = trendSamples(basal, termination);
  if (series.length === 0) {
    return (
      <div className="mini-chart mini-chart--empty" role="status">
        <p>Ingrese los signos en reposo y al finalizar la cirugía para ver la tendencia</p>
      </div>
    );
  }
  const values = series.flatMap((s) => s.points.map((p) => p.value));
  let lo = Math.min(...values);
  let hi = Math.max(...values);
  if (lo === hi) {
    lo -= 10;
    hi += 10;
  }
  const span = hi - lo;
  lo -= span * 0.1;
  hi += span * 0.1;
  const sx = (x: number) => PAD.l + ((x + 0.2) / 1.4) * (W - PAD.l - PAD.r);
  const sy = (v: number) => PAD.t + (1 - (v - lo) / (hi - lo)) * (H - PAD.t - PAD.b);
  const summary = series
    .map((s) => `${s.name}: ${s.points.map((p) => `${p.x === 0 ? 'reposo' : 'fin'} ${p.value}`).join(', ')}`)
    .join('; ');

  return (
    <div className="mini-chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Tendencia de reposo → fin de la cirugía. ${summary}`}>
        {[0, 1].map((x) => (
          <g key={x}>
            <line x1={sx(x)} x2={sx(x)} y1={PAD.t} y2={H - PAD.b} className="mini-chart__grid" />
            <text x={sx(x)} y={H - 6} textAnchor="middle" className="mini-chart__tick">
              {x === 0 ? 'Reposo' : 'Fin de la cirugía'}
            </text>
          </g>
        ))}
        {[lo, (lo + hi) / 2, hi].map((v) => (
          <text key={v} x={PAD.l - 6} y={sy(v) + 3} textAnchor="end" className="mini-chart__tick">
            {Math.round(v)}
          </text>
        ))}
        {series.map((s) => (
          <g key={s.key} style={{ color: s.color }}>
            {s.points.length === 2 ? (
              <line
                x1={sx(s.points[0]!.x)}
                y1={sy(s.points[0]!.value)}
                x2={sx(s.points[1]!.x)}
                y2={sy(s.points[1]!.value)}
                stroke="currentColor"
                strokeWidth={2}
              />
            ) : null}
            {s.points.map((p) => (
              <circle key={p.x} cx={sx(p.x)} cy={sy(p.value)} r={4} fill="currentColor" />
            ))}
          </g>
        ))}
      </svg>
      <ul className="mini-chart__legend" aria-hidden="true">
        {series.map((s) => (
          <li key={s.key}>
            <span className="mini-chart__swatch" style={{ background: s.color }} />
            {s.name}
          </li>
        ))}
      </ul>
    </div>
  );
}
