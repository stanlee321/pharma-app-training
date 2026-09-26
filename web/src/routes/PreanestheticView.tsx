import { SECTION_TITLES } from '../lib/wording';
import type { PreanestheticAssessment } from '../api/types';
import { ChoiceChips, ToggleRow } from '../components/Choice';
import { NumberRow, TextRow } from '../components/FormRows';
import { Section } from '../components/Section';
import { parseNumber } from '../lib/number';
import { CaseScreen } from './CaseScreen';

const ASA_OPTIONS = ['I', 'II', 'III', 'IV', 'V'] as const;
const RAQ_OPTIONS = ['1', '2', '3', '4', '5'] as const;
/** Lab rows: label → `labs` map key (Swift `labRow`). */
const LABS: [label: string, key: string][] = [
  ['Urea', 'urea'],
  ['Creatinina', 'creatinina'],
  ['Glucosa', 'glucosa'],
  ['Hb', 'hb'],
  ['Hto', 'hto'],
];

/** Swift `roman(_:)` — clamps to I…V. */
const roman = (n: number) => ASA_OPTIONS[Math.max(0, Math.min(4, n - 1))]!;
const fromRoman = (s: string): number | null => {
  const i = (ASA_OPTIONS as readonly string[]).indexOf(s);
  return i < 0 ? null : i + 1;
};

/** A lab value as a number: the DTO allows string|number; non-numeric strings read as empty. */
function labNumber(v: string | number | undefined): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string') {
    const n = parseNumber(v);
    return n === null || Number.isNaN(n) ? null : n;
  }
  return null;
}

type TextKey = 'alergia' | 'dentadura' | 'estado_psiquico';

/** N3 — Preanesthetic Assessment (Swift PreanestheticView). */
export function PreanestheticView() {
  return (
    <CaseScreen title={SECTION_TITLES.preanesthetic}>
      {(c, update) => {
        const a = c.pre_assessment;
        const edit = (fn: (pa: PreanestheticAssessment) => void) =>
          update((d) => {
            fn(d.pre_assessment);
          });
        const text = (label: string, key: TextKey, placeholder?: string) => (
          <TextRow
            label={label}
            value={a[key]}
            placeholder={placeholder}
            onChange={(v) =>
              edit((pa) => {
                pa[key] = v;
              })
            }
          />
        );
        return (
          <>
            <Section header="Antecedentes">
              {text('Alergias', 'alergia', 'Ninguna')}
              {text('Dentadura', 'dentadura')}
              {/* The exported forms read `cuello` (crosswalk ant_cuello); Swift wrote `viaAerea`.
                  Read either, write both so Swift-written records still display on iOS. */}
              <TextRow
                label="Cuello / vía aérea"
                value={a.cuello || a.via_aerea}
                onChange={(v) =>
                  edit((pa) => {
                    pa.cuello = v;
                    pa.via_aerea = v;
                  })
                }
              />
              {text('Estado psíquico', 'estado_psiquico')}
              <ToggleRow
                label="Ayuno confirmado"
                checked={a.ayuno}
                onChange={(v) =>
                  edit((pa) => {
                    pa.ayuno = v;
                  })
                }
              />
              <ToggleRow
                label="Consentimiento"
                checked={a.consentimiento}
                onChange={(v) =>
                  edit((pa) => {
                    pa.consentimiento = v;
                  })
                }
              />
            </Section>

            <Section>
              <ChoiceChips
                title="ASA"
                options={ASA_OPTIONS}
                selection={a.asa == null ? [] : [roman(a.asa)]}
                onChange={(sel) =>
                  edit((pa) => {
                    pa.asa = sel[0] ? fromRoman(sel[0]) : null;
                  })
                }
              />
              <ChoiceChips
                title="R.A.Q."
                options={RAQ_OPTIONS}
                selection={a.raq == null ? [] : [String(a.raq)]}
                onChange={(sel) =>
                  edit((pa) => {
                    pa.raq = sel[0] ? Number(sel[0]) : null;
                  })
                }
              />
            </Section>

            <Section header="Laboratorios">
              {LABS.map(([label, key]) => (
                <NumberRow
                  key={key}
                  label={label}
                  value={labNumber(a.labs[key])}
                  onChange={(v) =>
                    edit((pa) => {
                      if (v === null) delete pa.labs[key];
                      else pa.labs[key] = v;
                    })
                  }
                />
              ))}
            </Section>

            <Section header="Premedicación">
              <TextRow
                label="Notas"
                multiline
                placeholder="Notas"
                value={a.premedicacion}
                onChange={(v) =>
                  edit((pa) => {
                    pa.premedicacion = v;
                  })
                }
              />
            </Section>
          </>
        );
      }}
    </CaseScreen>
  );
}
