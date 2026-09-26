import type { AnesthesiaCase } from '../../api/types';
import { ChoiceChips } from '../../components/Choice';
import { GridNumberCell } from '../../components/GridNumberCell';
import { EditOnly } from '../../components/ReadOnly';
import { Section } from '../../components/Section';
import {
  BLOOD_OPTIONS,
  cellValue,
  cumulativeBalance,
  FLUID_HOURS,
  FLUID_ROWS,
  formatMl,
  hourBalance,
  LEGACY_ROWS,
  legacyRowsPresent,
  migrateLegacyRows,
  setCell,
} from '../../state/fluidBalance';
import { CaseScreen, type CaseUpdate } from '../CaseScreen';

/**
 * N7 — Fluid Balance (Swift FluidBalanceScreen layout): the hourly rows × hours spreadsheet (frozen
 * row labels, horizontally scrolling hour columns) with live read-only Balance parcial / total rows
 * (red when negative), plus the Hemocomponentes multi-select. Rows and formula follow the backend's
 * canonical control_fluidos rows (see state/fluidBalance.ts), not Swift's.
 */
export function FluidBalanceScreen() {
  return <CaseScreen title="Balance hídrico">{(c, update) => <FluidForm c={c} update={update} />}</CaseScreen>;
}

function FluidForm({ c, update }: { c: AnesthesiaCase; update: CaseUpdate }) {
  const fb = c.fluid_balance;
  const blood = BLOOD_OPTIONS.filter((o) => fb.blood_components[o] === true);
  const legacy = legacyRowsPresent(fb);
  return (
    <>
      {legacy.length > 0 && (
        <div className="banner banner--warning" role="status">
          <span className="banner__text">
            Este caso tiene filas de una versión anterior ({legacy.join(', ')}) que el formulario no
            reconoce y no se exportan.
          </span>
          <EditOnly>
            <button
              type="button"
              className="btn-plain"
              onClick={() =>
                update((d) => {
                  migrateLegacyRows(d.fluid_balance);
                })
              }
            >
              Mover a {legacy.map((k) => LEGACY_ROWS[k]).join(' / ')}
            </button>
          </EditOnly>
        </div>
      )}
      <Section
        header="Balance hídrico horario"
        footer="Balance parcial = (Cristaloide + Coloide + Hemocomponente) − (NCL + DCL + 3er espacio + Diuresis + Circuito resp. + Sangrado). Balance total = suma acumulada. Mismo cálculo que el servidor y el PDF."
      >
        <div className="grid-scroll">
          <table className="grid-table">
            <caption className="visually-hidden">Balance hídrico horario (ml)</caption>
            <thead>
              <tr>
                <th scope="col">
                  <span className="visually-hidden">Fila</span>
                </th>
                {FLUID_HOURS.map((h) => (
                  <th key={h} scope="col">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {FLUID_ROWS.map((row) => (
                <tr key={row.key} data-kind={row.kind}>
                  <th scope="row" title={row.key}>
                    {row.label}
                  </th>
                  {FLUID_HOURS.map((h) => (
                    <td key={h}>
                      <GridNumberCell
                        label={`${row.label} ${h}`}
                        value={cellValue(fb, row.key, h)}
                        onChange={(v) =>
                          update((d) => {
                            setCell(d.fluid_balance, row.key, h, v);
                          })
                        }
                      />
                    </td>
                  ))}
                </tr>
              ))}
              <tr>
                <th scope="row" className="grid-derived">
                  Balance parcial
                </th>
                {FLUID_HOURS.map((h) => {
                  const b = hourBalance(fb, h);
                  return (
                    <td
                      key={h}
                      className={`grid-derived${b < 0 ? ' value--negative' : ''}`}
                      data-testid={`balance-${h}`}
                    >
                      {formatMl(b)}
                    </td>
                  );
                })}
              </tr>
              <tr>
                <th scope="row" className="grid-derived">
                  Balance total
                </th>
                {FLUID_HOURS.map((h) => {
                  const b = cumulativeBalance(fb, h);
                  return (
                    <td
                      key={h}
                      className={`grid-derived${b < 0 ? ' value--negative' : ''}`}
                      data-testid={`balance-total-${h}`}
                    >
                      {formatMl(b)}
                    </td>
                  );
                })}
              </tr>
            </tbody>
          </table>
        </div>
      </Section>

      <Section>
        <ChoiceChips
          title="Hemocomponentes"
          options={BLOOD_OPTIONS}
          multiSelect
          selection={blood}
          onChange={(sel) =>
            update((d) => {
              // Swift bloodBinding setter: writes every option (true/false).
              for (const o of BLOOD_OPTIONS) d.fluid_balance.blood_components[o] = sel.includes(o);
            })
          }
        />
      </Section>
    </>
  );
}
