import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { errorMessage } from '../../api/backend';
import { Icon } from '../../components/Icon';
import { Page } from '../../components/Page';
import { SessionChangedError } from '../../state/caseStore';
import { EMPTY_PATIENT, toCreate, type PatientFormValues } from '../../state/patientForm';
import { patientStore } from '../../state/patientStore';
import { paths } from '../paths';
import { PatientForm } from './PatientForm';
import './patients.css';

/**
 * Nuevo paciente: the identity form → `POST /patients` → the new patient's screen. A registro
 * that already exists (409 with the existing id) is explained with "Abrir paciente existente".
 */
export function PatientNewView() {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [existing, setExisting] = useState<{ id: string; registro: string } | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const submit = async (v: PatientFormValues) => {
    setBusy(true);
    setError(null);
    setExisting(null);
    try {
      const res = await patientStore.getState().createPatient(toCreate(v));
      if (!mounted.current) return;
      if (res.kind === 'saved') {
        navigate(paths.paciente(res.patient.id), { replace: true });
        return;
      }
      setExisting({ id: res.patientId, registro: v.registro.trim() });
    } catch (e) {
      if (e instanceof SessionChangedError || !mounted.current) return;
      setError(`No se pudo registrar al paciente: ${errorMessage(e)}`);
    } finally {
      if (mounted.current) setBusy(false);
    }
  };

  const notice = existing ? (
    <div className="banner banner--warning" role="alert">
      <Icon name="warning" size={18} />
      <span className="banner__text">Ya existe un paciente con el registro «{existing.registro}».</span>
      <button type="button" className="btn-plain" onClick={() => navigate(paths.paciente(existing.id))}>
        Abrir paciente existente
      </button>
    </div>
  ) : error ? (
    <div className="banner" role="alert">
      <Icon name="warning" size={18} />
      <span className="banner__text">{error}</span>
    </div>
  ) : null;

  return (
    <Page title="Nuevo paciente" back={{ to: paths.pacientes, label: 'Historias clínicas' }}>
      <PatientForm
        initial={EMPTY_PATIENT}
        submitLabel="Registrar paciente"
        busy={busy}
        onSubmit={(v) => void submit(v)}
        onCancel={() => navigate(paths.pacientes)}
        notice={notice}
        serverErrors={existing ? { registro: 'Este registro ya pertenece a otro paciente.' } : undefined}
        onEdit={() => {
          if (existing) setExisting(null);
          if (error) setError(null);
        }}
      />
    </Page>
  );
}
