import { useEffect, useId, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import type { AnesthesiaCase, TransanestheticRecord } from '../../api/types';
import { GridNumberCell } from '../../components/GridNumberCell';
import { useReadOnly } from '../../components/readOnlyContext';
import { EditOnly } from '../../components/ReadOnly';
import { PositionIcon } from '../../components/PositionIcon';
import { Section } from '../../components/Section';
import { useCaseScope } from '../../state/caseScope';
import { rowLetter } from '../../state/drugLedger';
import { POSITION_LANE, POSITIONS, positionDef } from '../../state/positions';
import { isoToLocalInput, localInputToIso } from '../../lib/datetime';
import {
  addNamedLane,
  cell,
  columnCount,
  columnLabel,
  drugMarks,
  EVENT_MARKERS,
  eventAt,
  FLUID_PREFIX,
  FLUIDS,
  INHALED_AGENTS,
  INHALED_PREFIX,
  intervalOf,
  MAX_FLUIDS,
  MAX_INHALED,
  namedLanes,
  pendingPressures,
  removeLane,
  renameNamedLane,
  setCell,
  setEvent,
  VENTILATION_LANE,
  VENTILATION_MODES,
  visibleMonitorLanes,
  visibleVitalLanes,
  type LaneDef,
} from '../../state/timeGrid';
import type { CaseUpdate } from '../CaseScreen';

/**
 * Intraoperative record every 5 minutes (clinician feedback 2026-11): one column per interval
 * from the grid start, rows for vitals, monitors (EKG rhythm, SpO₂, O₂, POCUS, BIS, Entropía,
 * NINDEX…), inhaled agents in %, IV fluids by full name in ml, and the surgical events 1–6.
 * Prints on the transanesthetic record's time grid.
 */
export function TimeGridSection({ c, update }: { c: AnesthesiaCase; update: CaseUpdate }) {
  const tr = c.trans_record;
  const [extra, setExtra] = useState(0);
  const step = intervalOf(tr);
  const cols = columnCount(tr, extra);
  const times = Array.from({ length: cols }, (_, i) => i * step);
  const edit = (fn: (r: TransanestheticRecord) => void) =>
    update((d) => {
      fn(d.trans_record);
    });
  const inhaled = namedLanes(tr, INHALED_PREFIX);
  const fluids = namedLanes(tr, FLUID_PREFIX);
  const startId = useId();
  const { paths } = useCaseScope();
  const now = useNow(30_000);
  const readOnly = useReadOnly();
  const pending = readOnly ? [] : pendingPressures(tr, now);
  const pendingSet = new Set(pending);
  const marks = drugMarks(tr, c.drugs, rowLetter);
  // Open on the latest columns (the current time, or the last value); earlier ones stay a swipe away.
  const scroller = useRef<HTMLDivElement>(null);
  const focusT = latestColumn(tr, now, step);
  useEffect(() => {
    const el = scroller.current;
    const th = el?.querySelector<HTMLElement>(`[data-t="${focusT}"]`);
    if (el && th) el.scrollLeft = Math.max(0, th.offsetLeft - el.clientWidth / 2);
    // only when the screen opens or the start time changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tr.inicio]);

  return (
    <Section
      header={`Registro intraoperatorio (cada ${step} minutos)`}
      footer="Se imprime en la cuadrícula del registro transanestésico (5 horas). Los valores de texto (EKG, POCUS) se escriben cuando cambian."
    >
      <div className="row">
        <label className="row__label" htmlFor={startId}>
          Inicio del registro
        </label>
        <input
          id={startId}
          type="datetime-local"
          className="row__input"
          value={isoToLocalInput(tr.inicio)}
          disabled={useReadOnly()}
          onChange={(e) => {
            const v = localInputToIso(e.target.value);
            edit((r) => {
              r.inicio = v;
            });
          }}
        />
        <EditOnly>
          <button
            type="button"
            className="btn-plain"
            onClick={() =>
              edit((r) => {
                const now = new Date();
                now.setSeconds(0, 0);
                r.inicio = now.toISOString();
              })
            }
          >
            Ahora
          </button>
        </EditOnly>
      </div>

      {pending.length > 0 ? (
        <div className="banner banner--warning" role="status" data-testid="pending-pressures">
          <span className="banner__text">
            Presión arterial pendiente: {pending.slice(-4).map((t) => columnLabel(tr.inicio, t)).join(', ')}
            {pending.length > 4 ? ` y ${pending.length - 4} más` : ''}
          </span>
        </div>
      ) : null}
      <div className="grid-scroll" ref={scroller}>
        <table className="grid-table time-grid">
          <caption className="visually-hidden">Registro intraoperatorio cada {step} minutos</caption>
          <thead>
            <tr>
              <th scope="col">
                <span className="visually-hidden">Fila</span>
              </th>
              {times.map((t) => (
                <th key={t} scope="col" data-t={t}>
                  {columnLabel(tr.inicio, t)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <GroupRow title="Signos vitales" span={cols} />
            {visibleVitalLanes(tr).map((l) => (
              <LaneRow
                key={l.key}
                lane={l}
                tr={tr}
                times={times}
                edit={edit}
                pending={l.key === 'ta_sys' || l.key === 'ta_dia' ? pendingSet : undefined}
              />
            ))}
            <GroupRow title="Monitorización" span={cols} />
            {visibleMonitorLanes(tr).map((l) => (
              <LaneRow key={l.key} lane={l} tr={tr} times={times} edit={edit} />
            ))}

            <GroupRow title="Anestésicos inhalados (%)" span={cols} />
            {inhaled.map((name) => (
              <NamedRow
                key={name}
                prefix={INHALED_PREFIX}
                name={name}
                options={[{ group: 'Agentes', names: INHALED_AGENTS }]}
                taken={inhaled}
                unit="%"
                max={100}
                tr={tr}
                times={times}
                edit={edit}
              />
            ))}
            {inhaled.length < MAX_INHALED ? (
              <AddNamedRow
                label="Agregar anestésico inhalado"
                prefix={INHALED_PREFIX}
                options={[{ group: 'Agentes', names: INHALED_AGENTS }]}
                taken={inhaled}
                edit={edit}
              />
            ) : null}

            <GroupRow title="Fluidos IV (ml)" span={cols} />
            {fluids.map((name) => (
              <NamedRow
                key={name}
                prefix={FLUID_PREFIX}
                name={name}
                options={FLUIDS}
                taken={fluids}
                unit="ml"
                tr={tr}
                times={times}
                edit={edit}
              />
            ))}
            {fluids.length < MAX_FLUIDS ? (
              <AddNamedRow label="Agregar fluido" prefix={FLUID_PREFIX} options={FLUIDS} taken={fluids} edit={edit} />
            ) : null}

            <GroupRow title="Ventilación" span={cols} />
            <ChoiceLaneRow
              label="Ventilación"
              lane={VENTILATION_LANE}
              options={VENTILATION_MODES.map((m) => ({ value: m, label: m }))}
              tr={tr}
              times={times}
              edit={edit}
            />

            <GroupRow title="Posición" span={cols} />
            <ChoiceLaneRow
              label="Posición"
              lane={POSITION_LANE}
              options={POSITIONS.map((p) => ({ value: p.key, label: p.label }))}
              tr={tr}
              times={times}
              edit={edit}
              icon
            />

            <GroupRow title="Fármacos (letra del registro de fármacos)" span={cols} />
            <tr>
              <th scope="row">
                <Link to={paths.drugs(c.id)} className="time-grid__link">
                  Fármacos
                </Link>
              </th>
              {times.map((t) => (
                <td key={t} className="time-grid__drugs" data-testid={`drugs-${t}`}>
                  {(marks.get(t) ?? []).join(' ')}
                </td>
              ))}
            </tr>

            <GroupRow title="Tiempos del 1 al 6" span={cols} />
            <tr>
              <th scope="row">Evento</th>
              {times.map((t) => (
                <td key={t}>
                  <EventCell tr={tr} t={t} edit={edit} />
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
      <EditOnly>
        {cols < 300 / step ? (
          <div className="row">
            <button type="button" className="btn-plain" onClick={() => setExtra((n) => n + 6)}>
              Agregar 30 minutos
            </button>
          </div>
        ) : null}
      </EditOnly>
    </Section>
  );
}

function GroupRow({ title, span }: { title: string; span: number }) {
  return (
    <tr className="time-grid__group">
      <th scope="rowgroup" colSpan={span + 1}>
        {title}
      </th>
    </tr>
  );
}

type Edit = (fn: (r: TransanestheticRecord) => void) => void;

function LaneRow({
  lane,
  tr,
  times,
  edit,
  pending,
}: {
  lane: LaneDef;
  tr: TransanestheticRecord;
  times: number[];
  edit: Edit;
  pending?: Set<number>;
}) {
  const name = lane.unit ? `${lane.label} (${lane.unit})` : lane.label;
  return (
    <tr>
      <th scope="row">{name}</th>
      {times.map((t) => (
        <td key={t} className={pending?.has(t) ? 'time-grid__pending' : undefined}>
          <Cell
            label={`${lane.label} ${columnLabel(tr.inicio, t)}`}
            kind={lane.kind}
            value={cell(tr, lane.key, t)}
            min={lane.min}
            max={lane.max}
            onChange={(v) => edit((r) => setCell(r, lane.key, t, v))}
          />
        </td>
      ))}
    </tr>
  );
}

function Cell({
  label,
  kind,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  kind: 'number' | 'text';
  value: number | string | null;
  min?: number;
  max?: number;
  onChange: (v: number | string | null) => void;
}) {
  const id = useId();
  const off = useReadOnly();
  if (kind === 'number') {
    return (
      <GridNumberCell
        label={label}
        value={typeof value === 'number' ? value : null}
        min={min}
        max={max}
        onChange={onChange}
      />
    );
  }
  return (
    <>
      <label className="visually-hidden" htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        className="grid-cell grid-cell--text"
        placeholder="—"
        disabled={off}
        title={typeof value === 'string' ? value : undefined}
        value={value == null ? '' : String(value)}
        onChange={(e) => onChange(e.target.value)}
      />
    </>
  );
}

type Options = readonly { group: string; names: readonly string[] }[];

function NameSelect({
  id,
  value,
  options,
  taken,
  onChange,
  placeholder = 'Seleccionar…',
}: {
  id: string;
  value: string;
  options: Options;
  taken: string[];
  onChange: (name: string) => void;
  placeholder?: string;
}) {
  const known = options.some((g) => g.names.includes(value));
  return (
    <select
      id={id}
      className="drug-row__select time-grid__name"
      value={value}
      disabled={useReadOnly()}
      onChange={(e) => onChange(e.target.value)}
    >
      {value === '' ? <option value="">{placeholder}</option> : null}
      {!known && value !== '' ? <option value={value}>{value}</option> : null}
      {options.map((g) => (
        <optgroup key={g.group} label={g.group}>
          {g.names.map((n) => (
            <option key={n} value={n} disabled={n !== value && taken.includes(n)}>
              {n}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}

function NamedRow({
  prefix,
  name,
  options,
  taken,
  unit,
  max,
  tr,
  times,
  edit,
}: {
  prefix: string;
  name: string;
  options: Options;
  taken: string[];
  unit: string;
  max?: number;
  tr: TransanestheticRecord;
  times: number[];
  edit: Edit;
}) {
  const id = useId();
  const lane = prefix + name;
  return (
    <tr>
      <th scope="row">
        <label className="visually-hidden" htmlFor={id}>
          {prefix === INHALED_PREFIX ? 'Anestésico inhalado' : 'Fluido'}
        </label>
        <span className="time-grid__named">
          <NameSelect
            id={id}
            value={name}
            options={options}
            taken={taken}
            onChange={(to) => edit((r) => void renameNamedLane(r, prefix, name, to))}
          />
          <EditOnly>
            <button
              type="button"
              className="btn-plain time-grid__remove"
              aria-label={`Quitar ${name}`}
              onClick={() => edit((r) => removeLane(r, lane))}
            >
              ✕
            </button>
          </EditOnly>
        </span>
      </th>
      {times.map((t) => (
        <td key={t}>
          <GridNumberCell
            label={`${name} ${columnLabel(tr.inicio, t)} (${unit})`}
            value={(() => {
              const v = cell(tr, lane, t);
              return typeof v === 'number' ? v : null;
            })()}
            min={0}
            max={max}
            onChange={(v) => edit((r) => setCell(r, lane, t, v))}
          />
        </td>
      ))}
    </tr>
  );
}

function AddNamedRow({
  label,
  prefix,
  options,
  taken,
  edit,
}: {
  label: string;
  prefix: string;
  options: Options;
  taken: string[];
  edit: Edit;
}) {
  const id = useId();
  if (useReadOnly()) return null;
  return (
    <tr>
      <th scope="row">
        <label className="visually-hidden" htmlFor={id}>
          {label}
        </label>
        <NameSelect
          id={id}
          value=""
          placeholder={`+ ${label}`}
          options={options}
          taken={taken}
          onChange={(n) => edit((r) => addNamedLane(r, prefix, n))}
        />
      </th>
    </tr>
  );
}

function EventCell({ tr, t, edit }: { tr: TransanestheticRecord; t: number; edit: Edit }) {
  const id = useId();
  const ev = eventAt(tr, t);
  return (
    <>
      <label className="visually-hidden" htmlFor={id}>
        {`Evento ${columnLabel(tr.inicio, t)}`}
      </label>
      <select
        id={id}
        className="grid-cell time-grid__event"
        value={ev ? String(ev.marker) : ''}
        disabled={useReadOnly()}
        onChange={(e) => {
          const v = e.target.value;
          edit((r) => setEvent(r, t, v === '' ? null : Number(v)));
        }}
      >
        <option value="">—</option>
        {EVENT_MARKERS.map((m) => (
          <option key={m.marker} value={m.marker}>
            {`${m.marker} · ${m.label}`}
          </option>
        ))}
      </select>
    </>
  );
}

/** A clock that re-renders every `ms` (for the pending-pressure reminder). */
function useNow(ms: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}

/** Column to bring into view: the current time while the grid runs, else the last value. */
function latestColumn(tr: TransanestheticRecord, now: number, step: number): number {
  const last = Math.max(0, ...tr.series.flatMap((s) => s.points.map((p) => p.t)), ...tr.events.map((e) => e.t));
  if (tr.inicio) {
    const elapsed = (now - new Date(tr.inicio).getTime()) / 60_000;
    if (Number.isFinite(elapsed) && elapsed >= 0 && elapsed < 300) return Math.floor(elapsed / step) * step;
  }
  return Math.floor(last / step) * step;
}

/** A row of dropdowns (one per column) for a text lane with a fixed list of values. */
function ChoiceLaneRow({
  label,
  lane,
  options,
  tr,
  times,
  edit,
  icon = false,
}: {
  label: string;
  lane: string;
  options: readonly { value: string; label: string }[];
  tr: TransanestheticRecord;
  times: number[];
  edit: Edit;
  icon?: boolean;
}) {
  return (
    <tr>
      <th scope="row">{label}</th>
      {times.map((t) => (
        <td key={t}>
          <ChoiceCell
            label={`${label} ${columnLabel(tr.inicio, t)}`}
            value={cell(tr, lane, t)}
            options={options}
            icon={icon}
            onChange={(v) => edit((r) => setCell(r, lane, t, v))}
          />
        </td>
      ))}
    </tr>
  );
}

function ChoiceCell({
  label,
  value,
  options,
  icon,
  onChange,
}: {
  label: string;
  value: number | string | null;
  options: readonly { value: string; label: string }[];
  icon: boolean;
  onChange: (v: string | null) => void;
}) {
  const id = useId();
  const v = value == null ? '' : String(value);
  const known = v === '' || options.some((o) => o.value === v);
  return (
    <span className="time-grid__choice">
      <label className="visually-hidden" htmlFor={id}>
        {label}
      </label>
      <select
        id={id}
        className="grid-cell time-grid__select"
        value={v}
        disabled={useReadOnly()}
        title={options.find((o) => o.value === v)?.label ?? v}
        onChange={(e) => onChange(e.target.value === '' ? null : e.target.value)}
      >
        <option value="">—</option>
        {!known ? <option value={v}>{v}</option> : null}
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      {icon && positionDef(v) ? <PositionIcon position={v} width={44} height={16} /> : null}
    </span>
  );
}
