import { SECTION_TITLES } from '../../lib/wording';
import type { AnesthesiaCase } from '../../api/types';
import { ChoiceChips } from '../../components/Choice';
import { NumberRow, TextRow } from '../../components/FormRows';
import { Section } from '../../components/Section';
import { MONITORING_OPTIONS, VITAL_ROWS, type SnapshotKey } from '../../state/monitoring';
import { CaseScreen, type CaseUpdate } from '../CaseScreen';
import { VitalsMiniChart } from './VitalsMiniChart';
import './monitoring.css';

/**
 * N5 — Transanesthetic Monitoring (Swift MonitoringScreen): monitoring multi-select, basal and
 * termination vital snapshots, a basal → fin trend chart of the entered vitals, and the
 * complicaciones note — all on `trans_record`.
 *
 * Faithful to Swift: there is NO vital-series / surgical-event entry UI (the Swift screen has
 * none). `series` / `events` written by other clients are preserved untouched in the aggregate
 * and only summarised read-only here, because they count towards the Hub's completion flag.
 */
export function MonitoringScreen() {
  return <CaseScreen title={SECTION_TITLES.monitoring}>{(c, update) => <MonitoringForm c={c} update={update} />}</CaseScreen>;
}

function MonitoringForm({ c, update }: { c: AnesthesiaCase; update: CaseUpdate }) {
  const tr = c.trans_record;
  const selection = MONITORING_OPTIONS.filter((o) => tr.monitoring[o] === true);
  const recorded = tr.series.reduce((n, s) => n + s.points.length, 0);

  return (
    <>
      <Section>
        <ChoiceChips
          title="Monitorización"
          options={MONITORING_OPTIONS}
          multiSelect
          selection={selection}
          onChange={(sel) =>
            update((d) => {
              // Swift `.onChange(of: monitoringSel)`: writes every option (true/false).
              for (const o of MONITORING_OPTIONS) d.trans_record.monitoring[o] = sel.includes(o);
            })
          }
        />
      </Section>

      <SnapshotSection title="Signos basales" which="basal" c={c} update={update} />
      <SnapshotSection title="Signos de terminación" which="termination" c={c} update={update} />

      <Section header="Tendencia basal → fin">
        <VitalsMiniChart basal={tr.basal} termination={tr.termination} />
      </Section>

      {tr.series.length > 0 || tr.events.length > 0 ? (
        <Section
          header="Registro intraoperatorio"
          footer="Capturado en otro cliente; se conserva al guardar y no se edita en esta pantalla."
        >
          <div className="row">
            <span className="row__label">Series de signos vitales</span>
            <span className="row__value-text">
              {tr.series.length} ({recorded} puntos)
            </span>
          </div>
          <div className="row">
            <span className="row__label">Eventos quirúrgicos</span>
            <span className="row__value-text">{tr.events.length}</span>
          </div>
        </Section>
      ) : null}

      <Section header="Complicaciones transanestésicas">
        <TextRow
          label="Complicaciones"
          multiline
          placeholder="Sin complicaciones"
          value={tr.complicaciones}
          onChange={(v) =>
            update((d) => {
              d.trans_record.complicaciones = v;
            })
          }
        />
      </Section>
    </>
  );
}

function SnapshotSection({
  title,
  which,
  c,
  update,
}: {
  title: string;
  which: SnapshotKey;
  c: AnesthesiaCase;
  update: CaseUpdate;
}) {
  const snap = c.trans_record[which];
  return (
    <Section header={title}>
      <div role="group" aria-label={title}>
        {VITAL_ROWS.map((r) => (
          <NumberRow
            key={r.key}
            label={r.label}
            unit={r.unit}
            value={snap[r.key] ?? null}
            onChange={(v) =>
              update((d) => {
                d.trans_record[which][r.key] = v;
              })
            }
          />
        ))}
      </div>
    </Section>
  );
}
