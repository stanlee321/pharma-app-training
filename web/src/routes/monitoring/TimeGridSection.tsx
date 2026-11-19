import { useId, useState } from 'react';
import type { AnesthesiaCase, TransanestheticRecord } from '../../api/types';
import { GridNumberCell } from '../../components/GridNumberCell';
import { useReadOnly } from '../../components/readOnlyContext';
import { EditOnly } from '../../components/ReadOnly';
import { Section } from '../../components/Section';
import { isoToLocalInput, localInputToIso } from '../../lib/datetime';
import {
  addNamedLane,
  cell,
  columnCount,
  columnLabel,
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
  removeLane,
  renameNamedLane,
  setCell,
  setEvent,
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

      <div className="grid-scroll">
        <table className="grid-table time-grid">
          <caption className="visually-hidden">Registro intraoperatorio cada {step} minutos</caption>
          <thead>
            <tr>
              <th scope="col">
                <span className="visually-hidden">Fila</span>
              </th>
              {times.map((t) => (
                <th key={t} scope="col">
                  {columnLabel(tr.inicio, t)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <GroupRow title="Signos vitales" span={cols} />
            {visibleVitalLanes(tr).map((l) => (
              <LaneRow key={l.key} lane={l} tr={tr} times={times} edit={edit} />
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

            <GroupRow title="Eventos" span={cols} />
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

function LaneRow({ lane, tr, times, edit }: { lane: LaneDef; tr: TransanestheticRecord; times: number[]; edit: Edit }) {
  const name = lane.unit ? `${lane.label} (${lane.unit})` : lane.label;
  return (
    <tr>
      <th scope="row">{name}</th>
      {times.map((t) => (
        <td key={t}>
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
