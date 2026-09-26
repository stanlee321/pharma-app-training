import type { Gender } from '../api/types';
import { ChoiceChips } from '../components/Choice';
import { NumberRow, StepperRow, TextRow } from '../components/FormRows';
import { Icon } from '../components/Icon';
import { Section } from '../components/Section';
import { imc, pesoIdeal, vsc } from '../lib/biometrics';
import { isFemale } from '../lib/sex';
import { CaseScreen } from './CaseScreen';
import './patient.css';

const SEX_OPTIONS = ['Male', 'Female'] as const;

/**
 * 3′ — Patient Data (Swift PatientDataScreen): somatometry (weight/height/age/sex → the PK
 * engine's `PatientProfile`), identity write-ins, Hb/Hto/Rh/grupo, and a live read-only derived
 * card (IMC · peso ideal · VSC) computed exactly as Swift `PatientRecord`.
 *
 * Addition vs the Swift clinical screen: a Dilution stepper for `profile.dilution` (the Swift PK
 * PatientInputView exposes it; the clinical screen does not). It feeds the TCI chip's ml/h maths.
 */
/** Enough fraction digits that a stored sub-0.1 dilution is shown (and not rounded) as-is. */
function decimalsFor(v: number): number {
  return v > 0 && v < 0.1 ? 3 : 1;
}

export function PatientDataScreen() {
  return (
    <CaseScreen title="Patient">
      {(c, update) => {
        const p = c.patient;
        const profile = p.profile;
        const setProfile = (patch: Partial<typeof profile>) =>
          update((d) => {
            d.patient.profile = { ...d.patient.profile, ...patch };
          });
        return (
          <>
            <Section header="Somatometry">
              <StepperRow
                label="Weight"
                value={profile.weight}
                onChange={(weight) => setProfile({ weight })}
                unit="kg"
                step={1}
                min={1}
                max={300}
                decimals={0}
              />
              <StepperRow
                label="Height"
                value={profile.height}
                onChange={(height) => setProfile({ height })}
                unit="cm"
                step={1}
                min={20}
                max={250}
                decimals={0}
              />
              <StepperRow
                label="Age"
                value={profile.age}
                onChange={(age) => setProfile({ age })}
                unit="yr"
                step={1}
                min={0}
                max={120}
                decimals={0}
              />
              <ChoiceChips
                title="Sex"
                options={SEX_OPTIONS}
                selection={[isFemale(profile.gender) ? 'Female' : 'Male']}
                onChange={(sel) => {
                  const s = sel[0];
                  if (!s) return; // single-select: ignore deselect (Swift genderBinding)
                  setProfile({ gender: (s === 'Female' ? 'female' : 'male') satisfies Gender });
                }}
              />
              <StepperRow
                label="Dilution"
                value={profile.dilution}
                onChange={(dilution) => setProfile({ dilution })}
                unit="mg/ml"
                step={0.5}
                min={0.001}
                max={100}
                decimals={decimalsFor(profile.dilution)}
              />
            </Section>

            <Section>
              <div className="derived" aria-label="Derived biometrics (read-only)">
                <p className="derived__header">
                  <Icon name="lock" size={14} /> Derived
                </p>
                <dl className="derived__grid">
                  <Metric label="IMC" value={imc(profile).toFixed(1)} unit="kg/m²" />
                  <Metric label="Peso ideal" value={pesoIdeal(profile).toFixed(1)} unit="kg" />
                  <Metric label="VSC" value={vsc(profile).toFixed(0)} unit="ml" />
                </dl>
              </div>
            </Section>

            <Section header="Identity">
              <TextRow
                label="Registro"
                value={p.registro}
                placeholder="—"
                onChange={(v) =>
                  update((d) => {
                    d.patient.registro = v;
                  })
                }
              />
              <TextRow
                label="Nombre"
                value={p.nombre}
                placeholder="—"
                onChange={(v) =>
                  update((d) => {
                    d.patient.nombre = v;
                  })
                }
              />
              <TextRow
                label="Cama"
                value={p.cama}
                placeholder="—"
                onChange={(v) =>
                  update((d) => {
                    d.patient.cama = v;
                  })
                }
              />
            </Section>

            <Section header="Blood">
              <TextRow
                label="Grupo sanguíneo"
                value={p.grupo_sanguineo}
                placeholder="A / B / AB / O"
                onChange={(v) =>
                  update((d) => {
                    d.patient.grupo_sanguineo = v;
                  })
                }
              />
              <TextRow
                label="Rh"
                value={p.rh}
                placeholder="+ / −"
                onChange={(v) =>
                  update((d) => {
                    d.patient.rh = v;
                  })
                }
              />
              <NumberRow
                label="Hb"
                unit="g/dL"
                value={p.hb}
                onChange={(v) =>
                  update((d) => {
                    d.patient.hb = v;
                  })
                }
              />
              <NumberRow
                label="Hto"
                unit="%"
                value={p.hto}
                onChange={(v) =>
                  update((d) => {
                    d.patient.hto = v;
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

function Metric({ label, value, unit }: { label: string; value: string; unit: string }) {
  return (
    <div className="derived__metric">
      <dt className="derived__label">{label}</dt>
      <dd className="derived__value">
        <output>{value}</output>
        <span className="derived__unit">{unit}</span>
      </dd>
    </div>
  );
}
