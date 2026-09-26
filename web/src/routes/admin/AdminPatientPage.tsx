import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { adminApi } from '../../api/adminApi';
import { BackendError, errorMessage } from '../../api/backend';
import { SEXO_LABELS, type PatientDetailDTO } from '../../api/types';
import { EmptyState } from '../../components/EmptyState';
import { InfoRow } from '../../components/FormRows';
import { Section } from '../../components/Section';
import { StatusBadge } from '../../components/StatusBadge';
import { formatCalendarDateEs, formatDateEs, formatDateTime } from '../../lib/datetime';
import { edadLabel, plural, UI } from '../../lib/wording';
import { paths } from '../paths';
import { InlineAlert, LoadError, LoadingRow } from './adminUi';
import { patientFacts } from '../../state/patientForm';
import { isUuid } from './paging';
import type { PatientsNotice } from './AdminPatientsPage';
import { useQuery } from './useQuery';

/** The server's 409 while the patient still has cases (compared raw, shown translated). */
export const PATIENT_HAS_CASES_DETAIL = 'patient has cases; delete them first';

/**
 * An admin's view of one patient (`/admin/patients/:id`, read with `GET /patients/{id}`): the
 * identity (read-only here: anesthesiologists maintain it), every case of the patient by any
 * author (each opens the admin's read-only case view), a link to the case list filtered to the
 * patient, and Delete — offered only while the patient has no cases, with an in-page
 * confirmation (the server answers 409 otherwise).
 */
export function AdminPatientPage() {
  const { id = '' } = useParams();
  // A malformed id is answered locally: the server would 422 with an English pydantic message.
  const validId = isUuid(id);
  const q = useQuery<PatientDetailDTO | null>(`patient:${id}`, () =>
    validId ? adminApi.getPatient(id) : Promise.resolve(null),
  );
  // useQuery keeps the previous data while a new id loads: never show another patient.
  const p = q.data && q.data.id === id ? q.data : undefined;

  if (!validId) {
    return (
      <>
        <Crumb />
        <h1 className="large-title">Paciente</h1>
        <section className="section">
          <div className="section__card">
            <EmptyState icon="warning" title="Paciente no encontrado" description="El enlace no corresponde a un paciente." />
          </div>
        </section>
      </>
    );
  }

  if (!p) {
    const notFound = q.status === 'error' && q.error != null && /no encontrad/i.test(q.error);
    return (
      <>
        <Crumb />
        <h1 className="large-title">Paciente</h1>
        <section className="section">
          <div className="section__card">
            {q.status === 'error' ? (
              <LoadError
                title={notFound ? 'Paciente no encontrado' : 'No se pudo cargar el paciente'}
                error={q.error}
                onRetry={q.reload}
              />
            ) : (
              <LoadingRow label="Cargando el paciente…" />
            )}
          </div>
        </section>
      </>
    );
  }

  const cases = p.cases ?? [];
  return (
    <>
      <Crumb />
      <div className="admin-head">
        <h1 className="large-title">{p.nombre.trim() || 'Sin nombre'}</h1>
      </div>
      <p className="admin-user-meta" data-testid="admin-patient-header">
        <span className="admin-user-meta__name">{p.registro ? `Registro ${p.registro}` : 'Sin registro'}</span>
        <span>{patientFacts(p)}</span>
      </p>
      <p className="admin-user-dates">
        Creado {formatDateTime(p.created_at)} · Último cambio {formatDateTime(p.updated_at)}
      </p>

      <Section header="Datos del paciente" footer="Los anestesiólogos mantienen estos datos desde la historia clínica.">
        <InfoRow label="Nombre" value={p.nombre} />
        <InfoRow label="Registro" value={p.registro} />
        <InfoRow label="Sexo" value={p.sexo ? SEXO_LABELS[p.sexo] : 'Sin especificar'} />
        <InfoRow label="Fecha de nacimiento" value={p.fecha_nacimiento ? formatCalendarDateEs(p.fecha_nacimiento) : ''} />
        <InfoRow label="Edad" value={p.edad != null ? edadLabel(p.edad) : ''} />
        <InfoRow label="Grupo sanguíneo" value={p.grupo_sanguineo} />
        <InfoRow label="Rh" value={p.rh} />
      </Section>

      <Section header={`Casos (${cases.length})`}>
        {cases.length === 0 ? (
          <EmptyState icon="tray" title="Sin casos" description="Este paciente aún no tiene casos." />
        ) : (
          <>
            <div className="admin-table-scroll">
              <table className="admin-table">
                <caption className="visually-hidden">Casos del paciente</caption>
                <thead>
                  <tr>
                    <th scope="col">Caso</th>
                    <th scope="col">Anestesiólogo</th>
                    <th scope="col">Estado</th>
                    <th scope="col" className="hide-narrow">
                      Fecha
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {cases.map((c) => (
                    <tr key={c.id} data-testid="admin-patient-case" data-case-id={c.id}>
                      <th scope="row">
                        <Link to={paths.admin.case(c.id)} className="admin-table__link">
                          Caso {c.numero}
                        </Link>
                        <span className="admin-table__sub">{c.diagnostico_preop.trim() || 'Sin diagnóstico'}</span>
                      </th>
                      <td>{c.author_name?.trim() || '—'}</td>
                      <td>
                        <StatusBadge status={c.status} />
                      </td>
                      <td className="hide-narrow">{formatDateEs(c.fecha ?? c.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="row">
              <Link className="btn-plain admin-inline-link" to={paths.admin.casesForPatient(p.id)}>
                Ver en la lista de casos ›
              </Link>
            </div>
          </>
        )}
      </Section>

      <DeletePatient p={p} onChanged={q.reload} />
    </>
  );
}

function Crumb() {
  return (
    <p className="admin-crumb">
      <Link to={paths.admin.patients}>‹ Pacientes</Link>
    </p>
  );
}

/** Delete an empty patient (in-page confirmation); with cases, explains why it is not offered. */
function DeletePatient({ p, onChanged }: { p: PatientDetailDTO; onChanged: () => void }) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const count = p.cases?.length ?? p.cases_count;
  const name = p.nombre.trim() || 'Sin nombre';

  const doDelete = async () => {
    setBusy(true);
    setError(null);
    try {
      await adminApi.deletePatient(p.id);
    } catch (e) {
      if (!mounted.current) return;
      setError(`No se pudo eliminar: ${errorMessage(e)}`);
      setBusy(false);
      setConfirming(false);
      // 409: a case was added meanwhile (or 404: already deleted) — show the current state.
      if (e instanceof BackendError && (e.detail === PATIENT_HAS_CASES_DETAIL || e.status === 404)) onChanged();
      return;
    }
    const state: PatientsNotice = { notice: `Se eliminó el paciente «${name}».` };
    navigate(paths.admin.patients, { replace: true, state });
  };

  return (
    <Section header="Eliminar paciente">
      {error ? <InlineAlert>{error}</InlineAlert> : null}
      {count > 0 ? (
        <div className="row admin-row-actions">
          <span className="row__label">
            El paciente tiene {plural(count, 'caso', 'casos')}. Solo se puede eliminar un paciente sin casos; elimine
            primero sus casos.
          </span>
        </div>
      ) : confirming ? (
        <div className="row admin-row-actions" role="group" aria-label="Confirmar eliminación del paciente">
          <span className="row__label">¿Eliminar definitivamente al paciente «{name}»? No se puede deshacer.</span>
          <button type="button" className="btn-plain" onClick={() => setConfirming(false)} disabled={busy}>
            {UI.cancel}
          </button>
          <button type="button" className="btn-destructive" onClick={() => void doDelete()} disabled={busy}>
            {busy ? UI.deleting : 'Eliminar paciente'}
          </button>
        </div>
      ) : (
        <div className="row admin-row-actions">
          <span className="row__label">El paciente no tiene casos y puede eliminarse.</span>
          <button
            type="button"
            className="btn-plain btn-plain--destructive"
            onClick={() => {
              setError(null);
              setConfirming(true);
            }}
          >
            Eliminar paciente…
          </button>
        </div>
      )}
    </Section>
  );
}
