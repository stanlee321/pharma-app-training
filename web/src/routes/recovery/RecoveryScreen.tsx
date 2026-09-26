import type { AnesthesiaCase } from '../../api/types';
import { SegmentedControl } from '../../components/Choice';
import { StepperRow, TextRow } from '../../components/FormRows';
import { Section } from '../../components/Section';
import {
  ALDRETE_CRITERIA,
  ALDRETE_TIME_POINTS,
  aldreteCell,
  aldreteColumnTotal,
  OTRAS_SCALES,
  otrasValue,
  setOtras,
  setAldreteCell,
} from '../../state/recovery';
import { CaseScreen, type CaseUpdate } from '../CaseScreen';
import './recovery.css';

const SCORES = ['0', '1', '2'] as const;

/**
 * N8 — Recovery (Aldrete) (Swift RecoveryScreen): the 5 criteria × 6 time-point 0/1/2 matrix with
 * a live TOTAL row ("—" until the column is complete, green at 10), the término scales
 * (Ramsay / Bromage / ENA steppers into `recovery.otras`) and the discharge fields.
 */
export function RecoveryScreen() {
  return <CaseScreen title="Recovery">{(c, update) => <RecoveryForm c={c} update={update} />}</CaseScreen>;
}

function RecoveryForm({ c, update }: { c: AnesthesiaCase; update: CaseUpdate }) {
  const r = c.recovery;
  return (
    <>
      <Section
        header="Aldrete"
        footer="0–2 por criterio. TOTAL 0–10; se muestra “—” hasta completar los 5 y verde al alcanzar 10."
      >
        <div className="grid-scroll">
          <table className="grid-table aldrete-grid">
            <caption className="visually-hidden">Aldrete</caption>
            <thead>
              <tr>
                <th scope="col">min</th>
                {ALDRETE_TIME_POINTS.map((tp) => (
                  <th key={tp} scope="col">
                    {tp}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ALDRETE_CRITERIA.map((crit) => (
                <tr key={crit}>
                  <th scope="row">{crit}</th>
                  {ALDRETE_TIME_POINTS.map((tp) => {
                    const v = aldreteCell(r, crit, tp);
                    return (
                      <td key={tp} className="aldrete-cell">
                        <SegmentedControl
                          label={`${crit} ${tp}`}
                          options={SCORES}
                          value={v === null ? null : (String(v) as (typeof SCORES)[number])}
                          onChange={(s) =>
                            update((d) => {
                              setAldreteCell(d.recovery, crit, tp, Number(s));
                            })
                          }
                        />
                      </td>
                    );
                  })}
                </tr>
              ))}
              <tr>
                <th scope="row" className="grid-derived aldrete-total-label">
                  TOTAL
                </th>
                {ALDRETE_TIME_POINTS.map((tp) => {
                  const t = aldreteColumnTotal(r, tp);
                  return (
                    <td
                      key={tp}
                      className={`grid-derived${t === 10 ? ' value--complete' : ''}`}
                      data-testid={`aldrete-total-${tp}`}
                    >
                      {t === null ? '—' : t}
                    </td>
                  );
                })}
              </tr>
            </tbody>
          </table>
        </div>
      </Section>

      <Section header="Escalas al término">
        {OTRAS_SCALES.map((s) => (
          <StepperRow
            key={s.key}
            label={s.label}
            unit={s.unit || undefined}
            value={otrasValue(r, s) ?? s.fallback}
            step={1}
            min={s.min}
            max={s.max}
            decimals={0}
            onChange={(v) =>
              update((d) => {
                setOtras(d.recovery, s, v);
              })
            }
          />
        ))}
      </Section>

      <Section header="Alta">
        <TextRow
          label="Alta a su piso"
          placeholder="URPA"
          value={r.alta_a_piso}
          onChange={(v) =>
            update((d) => {
              d.recovery.alta_a_piso = v;
            })
          }
        />
        <TextRow
          label="Médico responsable"
          placeholder="Dr. …"
          value={r.medico_responsable}
          onChange={(v) =>
            update((d) => {
              d.recovery.medico_responsable = v;
            })
          }
        />
      </Section>
    </>
  );
}
