import { SECTION_TITLES } from '../../lib/wording';
import { useId } from 'react';
import type { AnesthesiaCase } from '../../api/types';
import { ChoiceChips } from '../../components/Choice';
import { InfoRow, NumberRow, TextRow } from '../../components/FormRows';
import { useReadOnly } from '../../components/readOnlyContext';
import { EditOnly } from '../../components/ReadOnly';
import { Section } from '../../components/Section';
import {
  ACCESS_TYPES,
  hoursBetween,
  INTERCURRENCIAS,
  MONITORING_OPTIONS,
  O2_DEVICES,
  SNAPSHOT_TITLES,
  TEMP_SITES,
  VITAL_ROWS,
  type SnapshotKey,
} from '../../state/monitoring';
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
  const tempSites = TEMP_SITES.filter((o) => tr.monitoring[o] === true);
  const o2 = O2_DEVICES.find((d) => d.value === tr.o2_suplementario.dispositivo);
  const isqHours = hoursBetween(c.isquemia.hr_inicio, c.isquemia.hr_termino);

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
        {tr.monitoring.Temp === true ? (
          <ChoiceChips
            title="Temperatura · sitio"
            options={TEMP_SITES}
            multiSelect
            selection={tempSites}
            onChange={(sel) =>
              update((d) => {
                for (const o of TEMP_SITES) d.trans_record.monitoring[o] = sel.includes(o);
              })
            }
          />
        ) : null}
        <TextRow
          label="Otra monitorización"
          placeholder="Escriba otra si se usó"
          value={tr.monitoring_otro}
          onChange={(v) =>
            update((d) => {
              d.trans_record.monitoring_otro = v;
            })
          }
        />
      </Section>

      <Section header="Diagnóstico y procedimiento">
        <InfoRow label="Diagnóstico preoperatorio" value={c.diagnostico_preop} />
        <TextRow
          label="Diagnóstico operatorio"
          placeholder="—"
          value={c.diagnostico_postop}
          onChange={(v) =>
            update((d) => {
              d.diagnostico_postop = v;
            })
          }
        />
        <TextRow
          label="Procedimiento propuesto"
          placeholder="—"
          value={c.operacion_propuesta}
          onChange={(v) =>
            update((d) => {
              d.operacion_propuesta = v;
            })
          }
        />
        <TextRow
          label="Procedimiento realizado"
          placeholder="—"
          value={c.operacion_realizada}
          onChange={(v) =>
            update((d) => {
              d.operacion_realizada = v;
            })
          }
        />
      </Section>

      <AccessSection c={c} update={update} />

      <Section header="O₂ suplementario">
        <ChoiceChips
          title="Dispositivo"
          options={O2_DEVICES.map((d) => d.label)}
          selection={o2 ? [o2.label] : []}
          onChange={(sel) =>
            update((d) => {
              d.trans_record.o2_suplementario.dispositivo = O2_DEVICES.find((x) => x.label === sel[0])?.value ?? '';
            })
          }
        />
        <NumberRow
          label="Flujo"
          unit="L/min"
          min={0}
          max={60}
          value={tr.o2_suplementario.flujo}
          onChange={(v) =>
            update((d) => {
              d.trans_record.o2_suplementario.flujo = v;
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

      <Section header="Isquemia">
        <TimeRow
          label="Hora de inicio"
          value={c.isquemia.hr_inicio}
          onChange={(v) =>
            update((d) => {
              d.isquemia.hr_inicio = v;
            })
          }
        />
        <TimeRow
          label="Hora de término"
          value={c.isquemia.hr_termino}
          onChange={(v) =>
            update((d) => {
              d.isquemia.hr_termino = v;
            })
          }
        />
        <InfoRow label="Tiempo total" value={isqHours === null ? null : `${isqHours} h`} />
        <NumberRow
          label="Presión"
          unit="mmHg"
          min={0}
          max={600}
          value={c.isquemia.presion}
          onChange={(v) =>
            update((d) => {
              d.isquemia.presion = v;
            })
          }
        />
        <TextRow
          label="Sitio de isquemia"
          placeholder="—"
          value={c.isquemia.sitio}
          onChange={(v) =>
            update((d) => {
              d.isquemia.sitio = v;
            })
          }
        />
      </Section>

      <Section header="Neumoperitoneo">
        <TimeRow
          label="Hora de inicio"
          value={c.neumoperitoneo.hr_inicio}
          onChange={(v) =>
            update((d) => {
              d.neumoperitoneo.hr_inicio = v;
            })
          }
        />
        <NumberRow
          label="Presión"
          unit="mmHg"
          min={0}
          max={40}
          value={c.neumoperitoneo.presion}
          onChange={(v) =>
            update((d) => {
              d.neumoperitoneo.presion = v;
            })
          }
        />
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

      <Section
        header="Notas"
        footer="Medicación adicional (p. ej. dexametasona 4 mg IV) y otras notas. Se imprimen en Observaciones."
      >
        <TextRow
          label="Medicación adicional y notas"
          multiline
          placeholder="Dexametasona 4 mg IV…"
          value={tr.notas}
          onChange={(v) =>
            update((d) => {
              d.trans_record.notas = v;
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

/** "HH:MM" time field (isquemia / neumoperitoneo); empty clears to null. */
function TimeRow({ label, value, onChange }: { label: string; value: string | null; onChange: (v: string | null) => void }) {
  const id = useId();
  return (
    <div className="row">
      <label className="row__label" htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        type="time"
        className="row__input"
        disabled={useReadOnly()}
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value === '' ? null : e.target.value)}
      />
    </div>
  );
}

/** Acceso endovascular: up to 3 peripheral veins, 1 arterial line and 1 central catheter. */
function AccessSection({ c, update }: { c: AnesthesiaCase; update: CaseUpdate }) {
  const list = c.trans_record.accesos;
  return (
    <Section header="Acceso endovascular" footer="Calibre y ubicación de cada acceso (se imprimen en el registro).">
      {list.map((a, i) => {
        const type = ACCESS_TYPES.find((x) => x.value === a.tipo);
        const n = list.slice(0, i + 1).filter((x) => x.tipo === a.tipo).length;
        const name = `${type?.label ?? a.tipo} ${n}`;
        return (
          <div key={i} role="group" aria-label={name} className="access-row">
            <div className="row">
              <span className="row__label row__label--primary">{name}</span>
              <EditOnly>
                <button
                  type="button"
                  className="btn-plain"
                  aria-label={`Quitar ${name}`}
                  onClick={() =>
                    update((d) => {
                      d.trans_record.accesos.splice(i, 1);
                    })
                  }
                >
                  Quitar
                </button>
              </EditOnly>
            </div>
            <TextRow
              label="Calibre"
              placeholder="18G"
              value={a.calibre}
              onChange={(v) =>
                update((d) => {
                  d.trans_record.accesos[i]!.calibre = v;
                })
              }
            />
            <TextRow
              label="Ubicación"
              placeholder="Dorso de mano izquierda"
              value={a.ubicacion}
              onChange={(v) =>
                update((d) => {
                  d.trans_record.accesos[i]!.ubicacion = v;
                })
              }
            />
          </div>
        );
      })}
      <EditOnly>
        <div className="row">
          {ACCESS_TYPES.map((t) =>
            list.filter((x) => x.tipo === t.value).length < t.max ? (
              <button
                key={t.value}
                type="button"
                className="btn-plain"
                onClick={() =>
                  update((d) => {
                    d.trans_record.accesos.push({ tipo: t.value, calibre: '', ubicacion: '' });
                  })
                }
              >
                + {t.label}
              </button>
            ) : null,
          )}
        </div>
      </EditOnly>
    </Section>
  );
}
