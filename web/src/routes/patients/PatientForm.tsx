import { useId, useState, type FormEvent, type ReactNode } from 'react';
import type { Sexo } from '../../api/types';
import { SegmentedControl, type Option } from '../../components/Choice';
import { TextRow } from '../../components/FormRows';
import { Section } from '../../components/Section';
import { todayYmd } from '../../lib/datetime';
import {
  NOMBRE_MAX,
  REGISTRO_MAX,
  validatePatient,
  type PatientFormErrors,
  type PatientFormValues,
} from '../../state/patientForm';

const SEXO_OPTIONS: Option<Sexo>[] = [
  { value: 'female', label: 'Femenino' },
  { value: 'male', label: 'Masculino' },
];
const GRUPO_OPTIONS: Option<string>[] = [{ value: '', label: '—' }, 'A', 'B', 'AB', 'O'];
const RH_OPTIONS: Option<string>[] = [
  { value: '', label: '—' },
  { value: '+', label: 'Positivo (+)' },
  { value: '-', label: 'Negativo (−)' },
];

/** The fixed choices plus a stored value outside them (legacy free text), so it is never lost. */
function withCurrent(options: Option<string>[], current: string): Option<string>[] {
  const known = options.some((o) => (typeof o === 'string' ? o : o.value) === current);
  return known ? options : [...options, { value: current, label: current }];
}

export interface PatientFormProps {
  initial: PatientFormValues;
  submitLabel: string;
  busy: boolean;
  /** Called with valid values (client checks passed). */
  onSubmit: (values: PatientFormValues) => void;
  onCancel?: () => void;
  /** Server-side problem (e.g. the duplicate-registro notice with its action). */
  notice?: ReactNode;
  /** Field errors from the server (shown until the next edit / submit). */
  serverErrors?: PatientFormErrors;
  /** Any field changed (e.g. to clear a server notice). */
  onEdit?: () => void;
}

/**
 * Patient identity form (new patient and "Editar paciente"): nombre, registro, sexo, fecha de
 * nacimiento, grupo sanguíneo and Rh. Every input is labelled; errors are shown on the field.
 */
export function PatientForm({ initial, submitLabel, busy, onSubmit, onCancel, notice, serverErrors, onEdit }: PatientFormProps) {
  const [v, setV] = useState<PatientFormValues>(initial);
  const [errors, setErrors] = useState<PatientFormErrors>({});
  const [touched, setTouched] = useState(false);
  const dateId = useId();
  const set = <K extends keyof PatientFormValues>(k: K, value: PatientFormValues[K]) => {
    setV((x) => ({ ...x, [k]: value }));
    if (touched) setErrors((e) => ({ ...e, [k]: undefined }));
    onEdit?.();
  };
  const shown: PatientFormErrors = { ...serverErrors, ...Object.fromEntries(Object.entries(errors).filter(([, m]) => m)) };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    const found = validatePatient(v);
    setErrors(found);
    if (Object.keys(found).length === 0) onSubmit(v);
  };

  return (
    <form className="patient-form" onSubmit={submit} noValidate aria-label="Datos del paciente">
      <Section header="Identificación">
        <TextRow
          label="Nombre"
          value={v.nombre}
          onChange={(x) => set('nombre', x)}
          placeholder="Nombre completo"
          maxLength={NOMBRE_MAX}
          required
          error={shown.nombre}
        />
        <TextRow
          label="Registro / expediente"
          value={v.registro}
          onChange={(x) => set('registro', x)}
          placeholder="Único en el hospital"
          maxLength={REGISTRO_MAX}
          noAutoCorrect
          required
          error={shown.registro}
        />
      </Section>
      <Section header="Datos demográficos">
        <div className={`row patient-form__segmented${shown.sexo ? ' row--invalid' : ''}`}>
          <SegmentedControl label="Sexo" showLabel options={SEXO_OPTIONS} value={v.sexo} onChange={(x) => set('sexo', x)} />
        </div>
        {shown.sexo ? (
          <div className="row__hint" role="alert">
            {shown.sexo}
          </div>
        ) : null}
        <div className={`row${shown.fecha_nacimiento ? ' row--invalid' : ''}`}>
          <label className="row__label" htmlFor={dateId}>
            Fecha de nacimiento
          </label>
          <input
            id={dateId}
            className="row__input"
            type="date"
            value={v.fecha_nacimiento}
            max={todayYmd()}
            aria-invalid={shown.fecha_nacimiento ? true : undefined}
            aria-describedby={shown.fecha_nacimiento ? `${dateId}-note` : undefined}
            onChange={(e) => set('fecha_nacimiento', e.target.value)}
          />
        </div>
        {shown.fecha_nacimiento ? (
          <div className="row__hint" id={`${dateId}-note`} role="alert">
            {shown.fecha_nacimiento}
          </div>
        ) : null}
        <div className="row patient-form__segmented">
          <SegmentedControl
            label="Grupo sanguíneo"
            showLabel
            options={withCurrent(GRUPO_OPTIONS, v.grupo_sanguineo)}
            value={v.grupo_sanguineo}
            onChange={(x) => set('grupo_sanguineo', x)}
          />
        </div>
        <div className="row patient-form__segmented">
          <SegmentedControl
            label="Rh"
            showLabel
            options={withCurrent(RH_OPTIONS, v.rh)}
            value={v.rh}
            onChange={(x) => set('rh', x)}
          />
        </div>
      </Section>
      {notice}
      <div className="patient-form__actions">
        {onCancel ? (
          <button type="button" className="btn-plain" onClick={onCancel} disabled={busy}>
            Cancelar
          </button>
        ) : null}
        <button type="submit" className="btn-primary btn-primary--compact" disabled={busy} aria-busy={busy}>
          {busy ? 'Guardando…' : submitLabel}
        </button>
      </div>
    </form>
  );
}
