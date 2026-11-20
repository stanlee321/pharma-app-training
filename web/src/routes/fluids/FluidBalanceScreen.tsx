import { SECTION_TITLES } from '../../lib/wording';
import type { AnesthesiaCase } from '../../api/types';
import { ChoiceChips } from '../../components/Choice';
import { InfoRow } from '../../components/FormRows';
import { GridNumberCell } from '../../components/GridNumberCell';
import type { ReactNode } from 'react';
import { EditOnly } from '../../components/ReadOnly';
import { Section } from '../../components/Section';
import {
  bleeding,
  BLOOD_OPTIONS,
  cellValue,
  cumulativeBalance,
  FLUID_HOURS,
  FLUID_ROWS,
  formatMl,
  gridFluidTotal,
  gridIntake,
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
  return <CaseScreen title={SECTION_TITLES.fluids}>{(c, update) => <FluidForm c={c} update={update} />}</CaseScreen>;
}

function FluidForm({ c, update }: { c: AnesthesiaCase; update: CaseUpdate }) {
  const fb = c.fluid_balance;
  const grid = gridIntake(c.trans_record);
  const total = gridFluidTotal(c.trans_record);
  const bleedAt = FLUID_ROWS.findIndex((r) => r.kind === 'bleed');
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
        footer="Los ingresos vacíos toman la suma de Fluidos IV del registro transanestésico de esa hora (en gris); escriba un valor para reemplazarla. Sangrado = Textiles + Aspirador + Recuperador. Balance parcial = ingresos − (NCL + DCL + 3er espacio + Diuresis + Circuito respiratorio + Sangrado). Balance total = suma acumulada. Mismo cálculo que el servidor y el PDF."
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
              {FLUID_ROWS.map((row, i) => (
                <FluidRowView key={row.key} first={i === bleedAt}>
                  <tr data-kind={row.kind}>
                    <th scope="row" title={row.key}>
                      {row.label}
                    </th>
                    {FLUID_HOURS.map((h) => {
                      const fromGrid = row.kind === 'intake' ? grid[row.key]?.[h] : undefined;
                      return (
                        <td key={h}>
                          <GridNumberCell
                            label={`${row.label} ${h}`}
                            value={cellValue(fb, row.key, h)}
                            placeholder={fromGrid !== undefined ? formatMl(fromGrid) : '—'}
                            onChange={(v) =>
                              update((d) => {
                                setCell(d.fluid_balance, row.key, h, v);
                              })
                            }
                          />
                        </td>
                      );
                    })}
                  </tr>
                </FluidRowView>
              ))}
              <tr>
                <th scope="row" className="grid-derived">
                  Sangrado
                </th>
                {FLUID_HOURS.map((h) => {
                  const b = bleeding(fb, h);
                  return (
                    <td key={h} className="grid-derived" data-testid={`sangrado-${h}`}>
                      {b === null ? '—' : formatMl(b)}
                    </td>
                  );
                })}
              </tr>
              <tr>
                <th scope="row" className="grid-derived">
                  Balance parcial
                </th>
                {FLUID_HOURS.map((h) => {
                  const b = hourBalance(fb, h, grid);
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
                  const b = cumulativeBalance(fb, h, grid);
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

      <Section header="Fluidos IV del registro transanestésico">
        <InfoRow label="Total fluidos infundidos" value={total > 0 ? `${formatMl(total)} ml` : null} />
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

/** Puts the bleeding breakdown under a small "Sangrado" caption row. */
function FluidRowView({ first, children }: { first: boolean; children: ReactNode }) {
  return (
    <>
      {first ? (
        <tr className="time-grid__group">
          <th scope="rowgroup" colSpan={FLUID_HOURS.length + 1}>
            Sangrado por origen
          </th>
        </tr>
      ) : null}
      {children}
    </>
  );
}
