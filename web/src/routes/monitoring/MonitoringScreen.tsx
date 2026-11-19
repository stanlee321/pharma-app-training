import { SECTION_TITLES } from '../../lib/wording';
import type { AnesthesiaCase } from '../../api/types';
import { ChoiceChips } from '../../components/Choice';
import { NumberRow, TextRow } from '../../components/FormRows';
import { Section } from '../../components/Section';
import { INTERCURRENCIAS, MONITORING_OPTIONS, SNAPSHOT_TITLES, VITAL_ROWS, type SnapshotKey } from '../../state/monitoring';
import { CaseScreen, type CaseUpdate } from '../CaseScreen';
import { TimeGridSection } from './TimeGridSection';
import { VitalsMiniChart } from './VitalsMiniChart';
import './monitoring.css';

/**
 * N5 — Transanesthetic Monitoring: monitoring multi-select, the resting (basal) and end-of-surgery
 * vital snapshots with their trend, the intraoperative grid every 5 minutes (series + events),
 * complicaciones and intercurrencias — all on `trans_record`. Wording and the grid follow the
 * clinician feedback 2026-11 (docs/wiki/plans/clinician-feedback-2026-11.md).
 */
export function MonitoringScreen() {
  return <CaseScreen title={SECTION_TITLES.monitoring}>{(c, update) => <MonitoringForm c={c} update={update} />}</CaseScreen>;
}

function MonitoringForm({ c, update }: { c: AnesthesiaCase; update: CaseUpdate }) {
  const tr = c.trans_record;
  const selection = MONITORING_OPTIONS.filter((o) => tr.monitoring[o] === true);
  const incidents = INTERCURRENCIAS.filter((o) => tr.intercurrencias_tipos[o] === true);

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

      <SnapshotSection title={SNAPSHOT_TITLES.basal} which="basal" c={c} update={update} />

      <TimeGridSection c={c} update={update} />

      <SnapshotSection title={SNAPSHOT_TITLES.termination} which="termination" c={c} update={update} />

      <Section header="Tendencia de reposo → fin de la cirugía">
        <VitalsMiniChart basal={tr.basal} termination={tr.termination} />
      </Section>

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

      <Section
        header="Intercurrencias"
        footer="Eventos ajenos al acto médico durante el periodo perioperatorio. Se imprimen en Observaciones."
      >
        <ChoiceChips
          title="Tipo"
          options={INTERCURRENCIAS}
          multiSelect
          selection={incidents}
          onChange={(sel) =>
            update((d) => {
              d.trans_record.intercurrencias_tipos = Object.fromEntries(sel.map((o) => [o, true]));
            })
          }
        />
        <TextRow
          label="Descripción"
          multiline
          placeholder="Hora, duración y medidas tomadas"
          value={tr.intercurrencias}
          onChange={(v) =>
            update((d) => {
              d.trans_record.intercurrencias = v;
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
