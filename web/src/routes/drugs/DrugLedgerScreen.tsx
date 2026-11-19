import { SECTION_TITLES } from '../../lib/wording';
import { useId } from 'react';
import type { AnesthesiaCase, DrugAdministration, PatientProfile } from '../../api/types';
import { SegmentedControl } from '../../components/Choice';
import { ConfirmDeleteButton } from '../../components/ConfirmDeleteButton';
import { AddRowButton } from '../../components/ReadOnly';
import { RepeatButton } from '../../components/RepeatButton';
import { Section } from '../../components/Section';
import { useNumberText } from '../../components/useNumberText';
import { isoToLocalInput, localInputToIso } from '../../lib/datetime';
import { DRUG_MODELS, matchedModel, pickerLabel } from '../../lib/drugModels';
import {
  DOSE_STEP,
  DOSE_UNITS,
  DRUG_MODES,
  drugIsIncomplete,
  isInfusion,
  newDrug,
  RATE_UNITS,
  ROUTES,
  rowLetter,
  type DrugMode,
} from '../../state/drugLedger';
import { CaseScreen, type CaseUpdate } from '../CaseScreen';
import { DRUG_TCI_DEFAULT_TARGET_CP, DrugTciChipSlot } from './DrugTciChipSlot';
import './drugs.css';

/**
 * N6 — Drug Ledger (Swift DrugLedgerScreen): a growable ledger of every drug given. Each row:
 * drug name (free text + model menu), dose ± value + unit, route, time; a left bar is red while the
 * row is incomplete and blue once complete. Typing a name that matches a modelled agent sets
 * `rust_model_id` exactly as Swift's `matchedModel`; picking from the model menu sets both.
 * Modelled rows render the live TCI recommendation chip (DrugTciChipSlot; never persisted, ADR-5).
 */
export function DrugLedgerScreen() {
  return <CaseScreen title={SECTION_TITLES.drugs}>{(c, update) => <Ledger c={c} update={update} />}</CaseScreen>;
}

function Ledger({ c, update }: { c: AnesthesiaCase; update: CaseUpdate }) {
  return (
    <>
      <Section header="Registro de fármacos">
        {c.drugs.length === 0 ? (
          <p className="row drug-empty">Aún no hay fármacos registrados.</p>
        ) : (
          c.drugs.map((d, i) => (
            <DrugRowEditor key={d.id} drug={d} index={i} patient={c.patient.profile} update={update} />
          ))
        )}
      </Section>

      <Section footer="Las recomendaciones TCI son una ayuda para la decisión con los agentes modelados y no se guardan.">
        <AddRowButton
          label="Agregar fármaco"
          onAdd={() =>
            update((draft) => {
              draft.drugs.push(newDrug());
            })
          }
        />
      </Section>
    </>
  );
}

function DrugRowEditor({
  drug,
  index,
  patient,
  update,
}: {
  drug: DrugAdministration;
  index: number;
  patient: PatientProfile;
  update: CaseUpdate;
}) {
  const uid = useId();
  const letter = rowLetter(index);
  const incomplete = drugIsIncomplete(drug);
  /** Mutate this row inside the draft (found by id, so reorders/deletes can't hit the wrong row). */
  const edit = (fn: (row: DrugAdministration) => void) =>
    update((d) => {
      const row = d.drugs.find((x) => x.id === drug.id);
      if (row) fn(row);
    });
  const dose = useNumberText({
    value: drug.dose_value,
    min: 0,
    onChange: (v) =>
      edit((r) => {
        r.dose_value = v;
      }),
  });
  const bump = (delta: number) =>
    edit((r) => {
      r.dose_value = Math.max(0, (r.dose_value ?? 0) + delta);
    });
  const ids = {
    farmaco: `${uid}-farmaco`,
    model: `${uid}-model`,
    dose: `${uid}-dose`,
    unit: `${uid}-unit`,
    via: `${uid}-via`,
    time: `${uid}-time`,
    fin: `${uid}-fin`,
  };
  const infusion = isInfusion(drug);
  const unitOptions: string[] = infusion ? [...RATE_UNITS] : [...DOSE_UNITS];
  if (drug.dose_unit !== '' && !unitOptions.includes(drug.dose_unit)) unitOptions.push(drug.dose_unit);
  const routeOptions: string[] = [...ROUTES];
  if (drug.via !== '' && !routeOptions.includes(drug.via)) routeOptions.push(drug.via);
  const known = DRUG_MODELS.some((m) => m.rustModelId === drug.rust_model_id);

  return (
    <div
      className={`drug-row${incomplete ? ' drug-row--incomplete' : ''}`}
      role="group"
      aria-label={`Fila ${letter}`}
      data-testid="drug-row"
    >
      <span className="drug-row__bar" aria-hidden="true" />
      <div className="drug-row__body">
        <div className="drug-row__line">
          <span className="drug-row__letter" aria-hidden="true">
            {letter}
          </span>
          <label className="visually-hidden" htmlFor={ids.farmaco}>
            {`Fármaco ${letter}`}
          </label>
          <input
            id={ids.farmaco}
            className="drug-row__name"
            placeholder="Fármaco"
            autoComplete="off"
            value={drug.farmaco}
            onChange={(e) => {
              const v = e.target.value;
              edit((r) => {
                r.farmaco = v;
                // Swift `.onChange(of: drug.farmaco)`: re-derive the engine model from the name.
                r.rust_model_id = matchedModel(v)?.rustModelId ?? null;
              });
            }}
          />
          <label className="visually-hidden" htmlFor={ids.model}>
            {`Modelo PK ${letter}`}
          </label>
          <select
            id={ids.model}
            className="drug-row__model"
            value={drug.rust_model_id ?? ''}
            onChange={(e) => {
              const m = DRUG_MODELS.find((x) => x.rustModelId === e.target.value);
              edit((r) => {
                if (m) {
                  r.farmaco = pickerLabel(m);
                  r.rust_model_id = m.rustModelId;
                } else {
                  r.rust_model_id = null; // Swift "Clear model"
                }
              });
            }}
          >
            <option value="">{drug.rust_model_id ? 'Quitar modelo' : 'Modelo…'}</option>
            {DRUG_MODELS.map((m) => (
              <option key={m.rustModelId} value={m.rustModelId}>
                {pickerLabel(m)}
              </option>
            ))}
            {drug.rust_model_id && !known ? <option value={drug.rust_model_id}>{drug.rust_model_id}</option> : null}
          </select>
          <ConfirmDeleteButton
            label={`Eliminar fármaco ${letter}`}
            onDelete={() =>
              update((d) => {
                d.drugs = d.drugs.filter((x) => x.id !== drug.id);
              })
            }
          />
        </div>

        <div className="drug-row__line">
          <SegmentedControl
            label={`Tipo de administración ${letter}`}
            options={DRUG_MODES}
            value={(drug.modo === 'infusion' ? 'infusion' : 'bolo') as DrugMode}
            onChange={(v) =>
              edit((r) => {
                r.modo = v;
                if (v === 'infusion') {
                  if (!(RATE_UNITS as readonly string[]).includes(r.dose_unit)) r.dose_unit = 'mcg/kg/min';
                } else {
                  r.fin = null;
                  if (!(DOSE_UNITS as readonly string[]).includes(r.dose_unit)) r.dose_unit = 'mg';
                }
              })
            }
          />
        </div>

        <div className={`drug-row__line${dose.problem ? ' row--invalid' : ''}`}>
          <RepeatButton kind="minus" label={`Disminuir dosis ${letter}`} onStep={() => bump(-DOSE_STEP)} />
          <label className="visually-hidden" htmlFor={ids.dose}>
            {`Dosis ${letter}`}
          </label>
          <input
            id={ids.dose}
            className="drug-row__dose"
            placeholder={infusion ? 'Velocidad' : 'Dosis'}
            aria-invalid={dose.problem ? true : undefined}
            {...dose.inputProps}
          />
          <RepeatButton kind="plus" label={`Aumentar dosis ${letter}`} onStep={() => bump(DOSE_STEP)} />
          <label className="visually-hidden" htmlFor={ids.unit}>
            {`Unidad ${letter}`}
          </label>
          <select
            id={ids.unit}
            className="drug-row__select"
            value={drug.dose_unit}
            onChange={(e) => {
              const v = e.target.value;
              edit((r) => {
                r.dose_unit = v;
              });
            }}
          >
            {drug.dose_unit === '' ? <option value="">Unidad</option> : null}
            {unitOptions.map((u) => (
              <option key={u} value={u}>
                {u}
              </option>
            ))}
          </select>
        </div>
        {dose.problem ? (
          <div className="row__hint" role="alert">
            {dose.problem}
          </div>
        ) : null}

        <div className="drug-row__line">
          <label className="drug-row__caption" htmlFor={ids.via}>
            Vía
          </label>
          <select
            id={ids.via}
            className="drug-row__select drug-row__select--pill"
            value={drug.via}
            onChange={(e) => {
              const v = e.target.value;
              edit((r) => {
                r.via = v;
              });
            }}
          >
            {drug.via === '' ? <option value="">Seleccionar</option> : null}
            {routeOptions.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </div>

        <div className="drug-row__line">
          <label className="drug-row__caption" htmlFor={ids.time}>
            {infusion ? 'Inicio' : 'Hora'}
          </label>
          <input
            id={ids.time}
            type="datetime-local"
            className="drug-row__time"
            value={isoToLocalInput(drug.time)}
            onChange={(e) => {
              const v = localInputToIso(e.target.value);
              edit((r) => {
                r.time = v;
              });
            }}
          />
          <button
            type="button"
            className="btn-plain"
            aria-label={`Hora actual ${letter}`}
            onClick={() =>
              edit((r) => {
                r.time = new Date().toISOString();
              })
            }
          >
            Ahora
          </button>
        </div>

        {infusion ? (
          <div className="drug-row__line">
            <label className="drug-row__caption" htmlFor={ids.fin}>
              Fin
            </label>
            <input
              id={ids.fin}
              type="datetime-local"
              className="drug-row__time"
              value={isoToLocalInput(drug.fin)}
              onChange={(e) => {
                const v = localInputToIso(e.target.value);
                edit((r) => {
                  r.fin = v;
                });
              }}
            />
            <button
              type="button"
              className="btn-plain"
              aria-label={`Fin ahora ${letter}`}
              onClick={() =>
                edit((r) => {
                  r.fin = new Date().toISOString();
                })
              }
            >
              Ahora
            </button>
          </div>
        ) : null}

        {drug.rust_model_id ? (
          <DrugTciChipSlot modelId={drug.rust_model_id} patient={patient} targetCp={DRUG_TCI_DEFAULT_TARGET_CP} />
        ) : null}
        {incomplete ? <span className="visually-hidden">Incompleto</span> : null}
      </div>
    </div>
  );
}
