import { positionDef } from '../state/positions';

/** The graphic symbol of an operative position (state/positions.ts), drawn in `currentColor`. */
export function PositionIcon({ position, width = 40, height = 16 }: { position: string; width?: number; height?: number }) {
  const def = positionDef(position);
  if (!def) return null;
  const pad = 2;
  const w = width - 2 * pad;
  const h = height - 2 * pad;
  const pt = ([x, y]: readonly [number, number]) => `${(pad + x * w).toFixed(1)},${(pad + y * h).toFixed(1)}`;
  const r = Math.min(w, h) * 0.16;
  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={def.label}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx={pad + def.head[0] * w} cy={pad + def.head[1] * h} r={r} />
      {def.lines.map((l, i) => (
        <polyline key={i} points={l.map(pt).join(' ')} />
      ))}
      {def.arrows.map(([a, b], i) => {
        const [ax, ay] = [pad + a[0] * w, pad + a[1] * h];
        const [bx, by] = [pad + b[0] * w, pad + b[1] * h];
        const len = Math.hypot(bx - ax, by - ay) || 1;
        const [ux, uy] = [(bx - ax) / len, (by - ay) / len];
        const s = r * 1.8;
        const barb = (sx: number) => `${bx},${by} ${bx - s * (ux + sx * uy * 0.6)},${by - s * (uy - sx * ux * 0.6)}`;
        return (
          <g key={`a${i}`}>
            <line x1={ax} y1={ay} x2={bx} y2={by} />
            <polyline points={barb(1)} />
            <polyline points={barb(-1)} />
          </g>
        );
      })}
    </svg>
  );
}
