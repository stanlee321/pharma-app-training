import { SECTION_TITLES } from '../lib/wording';
import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { SEXO_LABELS } from '../api/types';
import { InfoRow, NumberRow, StepperRow, TextRow } from '../components/FormRows';
import { Icon } from '../components/Icon';
import { Section } from '../components/Section';
import { imc, pesoIdeal, vsc } from '../lib/biometrics';
import { isFemale } from '../lib/sex';
import { useCaseScope } from '../state/caseScope';
import { SEXO_UNKNOWN_WARNING } from '../state/patientForm';
import { patientStore, usePatientStore } from '../state/patientStore';
import { CaseScreen } from './CaseScreen';
import { paths } from './paths';
import './patient.css';

/**
 * 3′ — Patient Data (Swift PatientDataScreen): somatometry (weight/height/age → the PK engine's
 * `PatientProfile`), a live read-only derived card (IMC · peso ideal · VSC) computed exactly as
 * Swift `PatientRecord`, and the per-encounter values (cama, Hb, Hto).
 *
 * Historias clínicas: the IDENTITY (nombre, registro, sexo, grupo, Rh) lives on the patient and
 * is shown read-only here (the case's snapshot, which the server keeps equal to the patient on
 * every draft write), with "Editar paciente" → the patient screen's edit form.
 *
 * Addition vs the Swift clinical screen: a Dilution stepper for `profile.dilution` (the Swift PK
 * PatientInputView exposes it; the clinical screen does not). It feeds the TCI chip's ml/h maths.
 */
/** Enough fraction digits that a stored sub-0.1 dilution is shown (and not rounded) as-is. */
function decimalsFor(v: number): number {
  return v > 0 && v < 0.1 ? 3 : 1;
}

export function PatientDataScreen() {
  const scope = useCaseScope();
  return (
    <CaseScreen title={SECTION_TITLES.patient}>
      {(c, update) => {
        const p = c.patient;
        const profile = p.profile;
        const setProfile = (patch: Partial<typeof profile>) =>
          update((d) => {
            d.patient.profile = { ...d.patient.profile, ...patch };
          });
        return (
          <>
            <Section header="Somatometría">
              <StepperRow
                label="Peso"
                value={profile.weight}
                onChange={(weight) => setProfile({ weight })}
                unit="kg"
                step={1}
                min={1}
                max={300}
                decimals={0}
              />
              <StepperRow
                label="Talla"
                value={profile.height}
                onChange={(height) => setProfile({ height })}
                unit="cm"
                step={1}
                min={20}
                max={250}
                decimals={0}
              />
              <StepperRow
                label="Edad"
                value={profile.age}
                onChange={(age) => setProfile({ age })}
                unit="años"
                step={1}
                min={0}
                max={120}
                decimals={0}
              />
              <StepperRow
                label="Dilución"
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
              <div className="derived" aria-label="Biometría derivada (solo lectura)">
                <p className="derived__header">
                  <Icon name="lock" size={14} /> Derivados
                </p>
                <dl className="derived__grid">
                  <Metric label="IMC" value={imc(profile).toFixed(1)} unit="kg/m²" />
                  <Metric label="Peso ideal" value={pesoIdeal(profile).toFixed(1)} unit="kg" />
                  <Metric label="VSC" value={vsc(profile).toFixed(0)} unit="ml" />
                </dl>
              </div>
            </Section>

            <Section
              header="Identidad del paciente"
              footer="La identidad pertenece al paciente (historia clínica) y se copia a sus casos en borrador; se edita en la ficha del paciente."
            >
              <InfoRow label="Nombre" value={p.nombre} />
              <InfoRow label="Registro" value={p.registro} />
              <PatientSexRow patientId={c.patient_id ?? null} gender={profile.gender} />
              <InfoRow label="Grupo sanguíneo" value={p.grupo_sanguineo} />
              <InfoRow label="Rh" value={p.rh} />
              {c.patient_id && scope.patient ? (
                <Link className="row link-row" to={paths.pacienteEditar(c.patient_id)}>
                  <span className="link-row__icon">
                    <Icon name="person" />
                  </span>
                  <span className="link-row__title">Editar paciente</span>
                  <span className="link-row__chevron">
                    <Icon name="chevronRight" size={16} />
                  </span>
                </Link>
              ) : null}
            </Section>

            <Section header="Datos del caso">
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

/**
 * Sexo: the PATIENT's value when it is known here (the case snapshot cannot tell an unknown sex
 * from the "male" default). An unknown sex reads "Sin especificar" with a warning, because the PK
 * models then compute as male.
 */
function PatientSexRow({ patientId, gender }: { patientId: string | null; gender: string }) {
  const patient = usePatientStore((s) => (patientId ? s.details[patientId]?.data ?? null : null));
  const known = usePatientStore((s) => (patientId ? !!s.details[patientId] : true));
  useEffect(() => {
    if (patientId && !known) void patientStore.getState().loadPatient(patientId);
  }, [patientId, known]);
  if (patient && patient.id === patientId && patient.sexo === '') {
    return (
      <>
        <InfoRow label="Sexo" value={SEXO_LABELS['']} />
        <div className="row__hint" role="alert" data-testid="sexo-warning">
          {SEXO_UNKNOWN_WARNING}
        </div>
      </>
    );
  }
  return <InfoRow label="Sexo" value={isFemale(gender) ? SEXO_LABELS.female : SEXO_LABELS.male} />;
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
