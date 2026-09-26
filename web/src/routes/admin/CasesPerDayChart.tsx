import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { casesLabel, longDay, niceAxis, normalizeDays, shortDay, TOOLTIP_H, type DayCount } from './chartMath';

const HEIGHT = 220;
const M = { top: 22, right: 8, bottom: 26, left: 34 };
const BAR_MAX = 24;
const GAP = 2;
const RADIUS = 4;
const TOOLTIP_GAP = 8;

/** Column path: 4px rounded data end (top), square at the baseline. */
function columnPath(x: number, y: number, w: number, h: number): string {
  const r = Math.min(RADIUS, w / 2, h);
  const b = y + h;
  return `M${x},${b}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${b}Z`;
}

/** Container width via ResizeObserver (jsdom / old browsers: a fixed fallback). */
function useWidth(fallback: number) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(fallback);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w && w > 0) setWidth(Math.round(w));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return { ref, width };
}

/**
 * Cases created per UTC day (the dashboard's 30-day window): a hand-built SVG column chart.
 * Single series → no legend (the section header names it). Recessive hairline grid, clean integer
 * ticks, columns ≤ 24px with a 2px gap and a rounded data end, the peak labelled on its cap.
 * Hover / keyboard (←/→, Home/End on the focused chart) show a tooltip; the same values are in
 * the "Show as table" view and the chart's text description, so nothing is hover-only.
 */
export function CasesPerDayChart({ days }: { days: readonly DayCount[] }) {
  const series = useMemo(() => normalizeDays(days), [days]);
  const { ref, width } = useWidth(640);
  const [active, setActive] = useState<number | null>(null);
  const [announce, setAnnounce] = useState('');
  const titleId = useId();
  const descId = useId();

  const n = series.length;
  const total = series.reduce((s, d) => s + d.count, 0);
  const max = series.reduce((m, d) => Math.max(m, d.count), 0);
  const peakIndex = max > 0 ? series.findIndex((d) => d.count === max) : -1;
  const { top, step } = niceAxis(max);
  const plotW = Math.max(40, width - M.left - M.right);
  const plotH = HEIGHT - M.top - M.bottom;
  const band = n > 0 ? plotW / n : plotW;
  const barW = Math.max(2, Math.min(BAR_MAX, band - GAP));
  const y = (v: number) => M.top + plotH - (v / top) * plotH;
  const ticks: number[] = [];
  for (let v = 0; v <= top; v += step) ticks.push(v);
  // x labels anchored on the last day (today), one per week.
  const labelled = (i: number) => (n - 1 - i) % 7 === 0;

  const summary =
    n === 0
      ? 'No data.'
      : `${casesLabel(total)} from ${shortDay(series[0]!.date)} to ${shortDay(series[n - 1]!.date)}` +
        (peakIndex >= 0
          ? `; busiest day ${shortDay(series[peakIndex]!.date)} with ${casesLabel(max)}.`
          : '; no cases in this period.');

  const move = (i: number) => {
    const next = Math.max(0, Math.min(n - 1, i));
    setActive(next);
    const d = series[next]!;
    setAnnounce(`${longDay(d.date)}: ${casesLabel(d.count)}`);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (n === 0) return;
    const cur = active ?? n - 1;
    const keys: Record<string, number> = { ArrowLeft: cur - 1, ArrowRight: cur + 1, Home: 0, End: n - 1 };
    if (e.key in keys) {
      e.preventDefault();
      move(keys[e.key]!);
    } else if (e.key === 'Escape') {
      setActive(null);
    }
  };

  const tip = active != null ? series[active] : undefined;
  const tipX = active != null ? M.left + active * band + band / 2 : 0;
  const tipY = tip ? y(tip.count) : 0;
  // No room above the cap (the tallest bars, i.e. the peak day): the card clips overflow and the
  // tooltip would also hide the peak label, so it flips below the cap, inside the plot.
  const tipBelow = tipY - TOOLTIP_H - TOOLTIP_GAP < 0;

  return (
    <div className="chart">
      <div
        ref={ref}
        className="chart__frame"
        tabIndex={n > 0 ? 0 : undefined}
        role="group"
        aria-labelledby={titleId}
        aria-describedby={descId}
        onKeyDown={onKeyDown}
        onFocus={() => {
          if (active == null && n > 0) move(n - 1);
        }}
        onBlur={() => setActive(null)}
        onPointerLeave={() => setActive(null)}
      >
        <svg className="chart__svg" width={width} height={HEIGHT} role="img" aria-labelledby={`${titleId} ${descId}`}>
          <title id={titleId}>Cases per day</title>
          <desc id={descId}>{summary}</desc>
          <g aria-hidden="true">
            {ticks.map((v) => (
              <g key={v}>
                <line className="chart__grid" x1={M.left} x2={M.left + plotW} y1={y(v)} y2={y(v)} />
                <text className="chart__tick" x={M.left - 6} y={y(v)} dy="0.32em" textAnchor="end">
                  {v.toLocaleString('en-US')}
                </text>
              </g>
            ))}
            {series.map((d, i) => {
              const h = (d.count / top) * plotH;
              const x = M.left + i * band + (band - barW) / 2;
              return (
                <g key={d.date}>
                  {d.count > 0 ? (
                    <path
                      className={`chart__bar${active === i ? ' chart__bar--active' : ''}`}
                      data-testid="chart-bar"
                      data-date={d.date}
                      d={columnPath(x, y(d.count), barW, h)}
                    />
                  ) : null}
                  {labelled(i) ? (
                    <text className="chart__tick" x={M.left + i * band + band / 2} y={HEIGHT - 8} textAnchor="middle">
                      {shortDay(d.date)}
                    </text>
                  ) : null}
                  {/* Hit target: the whole day's column, not just the painted bar. */}
                  <rect
                    className="chart__hit"
                    x={M.left + i * band}
                    y={M.top}
                    width={band}
                    height={plotH}
                    onPointerEnter={() => move(i)}
                    onPointerMove={() => active !== i && move(i)}
                  />
                </g>
              );
            })}
            {peakIndex >= 0 ? (
              <text
                className="chart__value"
                x={M.left + peakIndex * band + band / 2}
                y={y(max) - 6}
                textAnchor="middle"
              >
                {max.toLocaleString('en-US')}
              </text>
            ) : null}
          </g>
        </svg>
        {tip ? (
          <div
            className={`chart__tooltip${tipBelow ? ' chart__tooltip--below' : ''}`}
            role="presentation"
            data-placement={tipBelow ? 'below' : 'above'}
            style={{
              left: Math.min(Math.max(tipX, 60), width - 60),
              top: tipBelow ? tipY : tipY - TOOLTIP_GAP,
            }}
          >
            <strong className="chart__tooltip-value">{casesLabel(tip.count)}</strong>
            <span className="chart__tooltip-label">{longDay(tip.date)}</span>
          </div>
        ) : null}
        {max === 0 && n > 0 ? <p className="chart__empty">No cases in the last {n} days.</p> : null}
      </div>
      <span className="visually-hidden" aria-live="polite">
        {announce}
      </span>
      <details className="chart__table">
        <summary>Show as table</summary>
        <div className="admin-table-scroll">
          <table className="admin-table admin-table--compact">
            <caption className="visually-hidden">Cases per day (UTC)</caption>
            <thead>
              <tr>
                <th scope="col">Day (UTC)</th>
                <th scope="col" className="num">
                  Cases
                </th>
              </tr>
            </thead>
            <tbody>
              {series.map((d) => (
                <tr key={d.date}>
                  <th scope="row">{longDay(d.date)}</th>
                  <td className="num">{d.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
