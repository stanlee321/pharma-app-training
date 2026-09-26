import { SECTION_TITLES } from '../../lib/wording';
import { useId } from 'react';
import type { AnesthesiaCase, NewbornRecord } from '../../api/types';
import { ChoiceChips } from '../../components/Choice';
import { ConfirmDeleteButton } from '../../components/ConfirmDeleteButton';
import { EmptyState } from '../../components/EmptyState';
import { NumberRow, TextRow } from '../../components/FormRows';
import { Icon } from '../../components/Icon';
import { AddRowButton } from '../../components/ReadOnly';
import { Section } from '../../components/Section';
import { newNewborn } from '../../state/newborns';
import { CaseScreen, type CaseUpdate } from '../CaseScreen';
import './newborn.css';

type ApgarKey = 'apgar1' | 'apgar5' | 'apgar10';
const APGAR_ROWS: readonly { label: string; key: ApgarKey }[] = [
  { label: "Apgar 1'", key: 'apgar1' },
  { label: "Apgar 5'", key: 'apgar5' },
  { label: "Apgar 10'", key: 'apgar10' },
];
const APGAR_VALUES = Array.from({ length: 11 }, (_, i) => i);

/**
 * N9 — Newborn Record (Swift NewbornScreen): 0..n newborn records per (obstetric) case — one per
 * birth. Each: Sexo M/F single-select, Peso (g), Talla (cm), Apgar 1'/5'/10' pickers (— or 0…10).
 * DTO-only fields the Swift model lacks (Expulsión de placenta, Estado general) are also editable.
 */
export function NewbornScreen() {
  return <CaseScreen title={SECTION_TITLES.newborn}>{(c, update) => <NewbornList c={c} update={update} />}</CaseScreen>;
}

function NewbornList({ c, update }: { c: AnesthesiaCase; update: CaseUpdate }) {
  return (
    <>
      <Section footer="Agregue un registro por nacimiento; una gestación múltiple agrega más.">
        {c.newborns.length === 0 ? (
          <EmptyState
            icon="family"
            title="Sin registros de recién nacido"
            description="Solo casos obstétricos. Agregue un registro por nacimiento para capturar sexo, peso, talla y Apgar."
          />
        ) : (
          c.newborns.map((n, i) => <NewbornEditor key={n.id} newborn={n} number={i + 1} update={update} />)
        )}
      </Section>
      <Section>
        <AddRowButton
          label="Agregar recién nacido"
          ariaLabel="Agregar registro de recién nacido"
          onAdd={() =>
            update((d) => {
              d.newborns.push(newNewborn());
            })
          }
        />
      </Section>
    </>
  );
}

function NewbornEditor({ newborn, number, update }: { newborn: NewbornRecord; number: number; update: CaseUpdate }) {
  const uid = useId();
  const title = `Recién nacido ${number}`;
  const edit = (fn: (n: NewbornRecord) => void) =>
    update((d) => {
      const n = d.newborns.find((x) => x.id === newborn.id);
      if (n) fn(n);
    });
  return (
    <div className="newborn" role="group" aria-label={title}>
      <div className="newborn__header">
        <Icon name="family" size={18} />
        <span className="newborn__title">{title}</span>
        <ConfirmDeleteButton
          label={`Eliminar ${title}`}
          onDelete={() =>
            update((d) => {
              d.newborns = d.newborns.filter((x) => x.id !== newborn.id);
            })
          }
        />
      </div>
      <ChoiceChips
        title="Sexo"
        options={['M', 'F']}
        selection={newborn.sexo === '' ? [] : [newborn.sexo]}
        onChange={(sel) =>
          edit((n) => {
            n.sexo = sel[0] ?? '';
          })
        }
      />
      <NumberRow
        label="Peso"
        unit="g"
        min={0}
        value={newborn.peso_gramos}
        onChange={(v) =>
          edit((n) => {
            n.peso_gramos = v;
          })
        }
      />
      <NumberRow
        label="Talla"
        unit="cm"
        min={0}
        value={newborn.talla_cm}
        onChange={(v) =>
          edit((n) => {
            n.talla_cm = v;
          })
        }
      />
      {APGAR_ROWS.map((a) => {
        const id = `${uid}-${a.key}`;
        const v = newborn[a.key];
        return (
          <div className="row" key={a.key}>
            <label className="row__label" htmlFor={id}>
              {a.label}
            </label>
            <select
              id={id}
              className="newborn__apgar"
              value={v == null ? '' : String(v)}
              onChange={(e) => {
                const s = e.target.value;
                edit((n) => {
                  n[a.key] = s === '' ? null : Number(s);
                });
              }}
            >
              <option value="">—</option>
              {APGAR_VALUES.map((n) => (
                <option key={n} value={String(n)}>
                  {n}
                </option>
              ))}
            </select>
          </div>
        );
      })}
      <TextRow
        label="Expulsión de placenta"
        value={newborn.expulsion_placenta}
        placeholder="—"
        onChange={(v) =>
          edit((n) => {
            n.expulsion_placenta = v;
          })
        }
      />
      <TextRow
        label="Estado general"
        value={newborn.estado_general}
        placeholder="—"
        onChange={(v) =>
          edit((n) => {
            n.estado_general = v;
          })
        }
      />
    </div>
  );
}
