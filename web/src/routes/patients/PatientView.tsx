import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { errorMessage } from '../../api/backend';
import { SEXO_LABELS, type PatientCaseSummaryDTO, type PatientDetailDTO } from '../../api/types';
import { EmptyState } from '../../components/EmptyState';
import { InfoRow } from '../../components/FormRows';
import { Icon } from '../../components/Icon';
import { Page } from '../../components/Page';
import { Section } from '../../components/Section';
import { StatusBadge } from '../../components/StatusBadge';
import { formatCalendarDateEs, formatDateEs } from '../../lib/datetime';
import { edadLabel, UI } from '../../lib/wording';
import { displayName, useAuthStore } from '../../state/authStore';
import { caseStore, SessionChangedError } from '../../state/caseStore';
import { SEXO_UNKNOWN_WARNING, toUpdate, valuesOf, type PatientFormValues } from '../../state/patientForm';
import { patientStore, usePatientStore } from '../../state/patientStore';
import { isUuid } from '../admin/paging';
import { paths } from '../paths';
import { PatientForm } from './PatientForm';
import '../encounters.css';
import './patients.css';

/**
 * Paciente — the screen between the list and a case: the patient's header (nombre, registro,
 * edad, sexo), their data (editable by any anesthesiologist: patients are shared; `?editar=1`
 * opens the form), and every case of the patient by any author ("Caso N · fecha · diagnóstico ·
 * estado · autor"). Own drafts open editable (and can be deleted); everyone else's cases open
 * read-only through the case screens' one read-only mechanism. "+" starts a new case for this
 * patient and opens its Hub.
 */
export function PatientView() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const editing = params.get('editar') === '1';
  const detail = usePatientStore((s) => s.details[id]);
  const user = useAuthStore((s) => s.user);

  // A malformed id is answered locally: the server would 422 with an English pydantic message.
  const validId = isUuid(id);
  useEffect(() => {
    if (validId) void patientStore.getState().loadPatient(id);
  }, [id, validId]);

  const data = detail?.data && detail.data.id === id ? detail.data : null;
  const back = { to: paths.pacientes, label: 'Historias clínicas' };

  const newCase = () => {
    if (!data) return;
    const c = caseStore.getState().createCase(user ? displayName(user) : '', data);
    navigate(paths.hub(c.id));
  };

  if (!validId) {
    return (
      <Page title="Paciente" back={back} titleDisplay="inline">
        <Section>
          <EmptyState icon="warning" title="Paciente no encontrado" description="El enlace no corresponde a un paciente." />
        </Section>
      </Page>
    );
  }

  if (!data) {
    return (
      <Page title="Paciente" back={back} titleDisplay="inline">
        <Section>
          {detail?.status === 'error' ? (
            <EmptyState
              icon="warning"
              title="Paciente no encontrado"
              description={detail.error ?? undefined}
              action={
                <button type="button" className="btn-plain" onClick={() => void patientStore.getState().loadPatient(id)}>
                  Reintentar
                </button>
              }
            />
          ) : (
            <div className="row state-row" role="status">
              <span className="spinner" aria-hidden="true" />
              <span>{UI.loading}</span>
            </div>
          )}
        </Section>
      </Page>
    );
  }

  const setEditing = (on: boolean) => setParams(on ? { editar: '1' } : {}, { replace: true });

  return (
    <Page
      title={data.nombre}
      back={back}
      trailing={
        <button type="button" className="toolbar-round" onClick={newCase} aria-label="Nuevo caso">
          <Icon name="plus" size={22} />
        </button>
      }
    >
      <p className="patient-header" data-testid="patient-header">
        <span>{data.registro ? `Registro ${data.registro}` : 'Sin registro'}</span>
        {data.edad != null ? <span>{edadLabel(data.edad)}</span> : null}
        {data.sexo ? <span>{SEXO_LABELS[data.sexo]}</span> : <span className="patient-header__warn">Sexo sin especificar</span>}
      </p>

      {!data.sexo && !editing ? (
        <div className="banner banner--warning" role="alert" data-testid="sexo-warning">
          <Icon name="warning" size={18} />
          <span className="banner__text">{SEXO_UNKNOWN_WARNING}</span>
          <button type="button" className="btn-plain" onClick={() => setEditing(true)}>
            Editar paciente
          </button>
        </div>
      ) : null}

      {detail?.status === 'error' ? (
        <div className="banner" role="alert">
          <Icon name="warning" size={18} />
          <span className="banner__text">No se pudo actualizar: {detail.error}</span>
          <button type="button" className="btn-plain" onClick={() => void patientStore.getState().loadPatient(id)}>
            Reintentar
          </button>
        </div>
      ) : null}

      {editing ? (
        <EditPatient key={data.updated_at} data={data} onDone={() => setEditing(false)} />
      ) : (
        <Section header="Datos del paciente">
          <InfoRow label="Nombre" value={data.nombre} />
          <InfoRow label="Registro" value={data.registro} />
          <InfoRow label="Sexo" value={SEXO_LABELS[data.sexo]} />
          <InfoRow label="Fecha de nacimiento" value={data.fecha_nacimiento ? formatCalendarDateEs(data.fecha_nacimiento) : ''} />
          <InfoRow label="Edad" value={data.edad != null ? edadLabel(data.edad) : ''} />
          <InfoRow label="Grupo sanguíneo" value={data.grupo_sanguineo} />
          <InfoRow label="Rh" value={data.rh} />
          <button type="button" className="row link-row patient-edit" onClick={() => setEditing(true)}>
            <span className="link-row__title">Editar datos del paciente</span>
          </button>
        </Section>
      )}

      <Section
        header={`Casos (${data.cases?.length ?? 0})`}
        footer="Los casos de otros anestesiólogos se abren en modo de solo lectura."
      >
        {(data.cases ?? []).length === 0 ? (
          <EmptyState icon="tray" title="Sin casos" description="Pulse + para iniciar el primer caso de este paciente." />
        ) : (
          (data.cases ?? []).map((c) => (
            <CaseRow key={c.id} c={c} mine={!!user && c.user_id === user.id} patientId={id} />
          ))
        )}
      </Section>
    </Page>
  );
}

/** "25 sept 2026 · Dx · Dr. X" */
function caseLine(c: PatientCaseSummaryDTO): string {
  const parts = [formatDateEs(c.fecha ?? c.created_at)];
  parts.push(c.diagnostico_preop.trim() || 'Sin diagnóstico');
  parts.push(c.author_name?.trim() || 'Autor desconocido');
  return parts.join(' · ');
}

function CaseRow({ c, mine, patientId }: { c: PatientCaseSummaryDTO; mine: boolean; patientId: string }) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const title = `Caso ${c.numero}`;

  const remove = async () => {
    setBusy(true);
    setError(null);
    await caseStore.getState().delete(c.id);
    const fresh = await patientStore.getState().loadPatient(patientId);
    if (fresh?.cases?.some((x) => x.id === c.id)) {
      setBusy(false);
      setConfirming(false);
      setError(caseStore.getState().listError ?? 'No se pudo eliminar el caso.');
    }
  };

  return (
    <div className="encounter-row patient-case" data-testid="patient-case" data-case-id={c.id}>
      <Link to={paths.hub(c.id)} className="encounter-row__link">
        <span className="encounter-row__text">
          <span className="encounter-row__title-line">
            <span className="encounter-row__title">{title}</span>
            <StatusBadge status={c.status} />
            {!mine ? <span className="patient-case__tag">Solo lectura</span> : null}
          </span>
          <span className="encounter-row__subtitle">{caseLine(c)}</span>
          {error ? (
            <span className="patient-case__error" role="alert">
              {error}
            </span>
          ) : null}
        </span>
        <Icon name="chevronRight" size={16} className="encounter-row__chevron" />
      </Link>
      {c.can_edit ? (
        confirming ? (
          <span className="encounter-row__confirm" role="group" aria-label={`Eliminar ${title}`}>
            <button type="button" className="btn-destructive" disabled={busy} onClick={() => void remove()}>
              Eliminar
            </button>
            <button type="button" className="btn-plain" disabled={busy} onClick={() => setConfirming(false)}>
              Cancelar
            </button>
          </span>
        ) : (
          <button
            type="button"
            className="encounter-row__delete"
            aria-label={`Eliminar ${title}`}
            onClick={() => setConfirming(true)}
          >
            <Icon name="trash" size={18} />
          </button>
        )
      ) : (
        <span className="encounter-row__locked" aria-hidden="true">
          <Icon name="lock" size={16} />
        </span>
      )}
    </div>
  );
}

/** "Editar paciente": PATCH only what changed; a taken registro offers the other patient. */
function EditPatient({ data, onDone }: { data: PatientDetailDTO; onDone: () => void }) {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [existing, setExisting] = useState<string | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const initial = valuesOf(data);

  const submit = async (v: PatientFormValues) => {
    const patch = toUpdate(initial, v);
    if (Object.keys(patch).length === 0) {
      onDone();
      return;
    }
    setBusy(true);
    setError(null);
    setExisting(null);
    try {
      const res = await patientStore.getState().updatePatient(data.id, patch);
      if (!mounted.current) return;
      if (res.kind === 'exists') {
        setExisting(res.patientId);
        return;
      }
      void patientStore.getState().loadPatient(data.id);
      onDone();
    } catch (e) {
      if (e instanceof SessionChangedError || !mounted.current) return;
      setError(`No se pudieron guardar los cambios: ${errorMessage(e)}`);
    } finally {
      if (mounted.current) setBusy(false);
    }
  };

  const notice = existing ? (
    <div className="banner banner--warning" role="alert">
      <Icon name="warning" size={18} />
      <span className="banner__text">Ese registro ya pertenece a otro paciente.</span>
      <button type="button" className="btn-plain" onClick={() => navigate(paths.paciente(existing))}>
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
    <PatientForm
      initial={initial}
      submitLabel="Guardar cambios"
      busy={busy}
      onSubmit={(v) => void submit(v)}
      onCancel={onDone}
      notice={notice}
      serverErrors={existing ? { registro: 'Este registro ya pertenece a otro paciente.' } : undefined}
      onEdit={() => {
        if (existing) setExisting(null);
        if (error) setError(null);
      }}
    />
  );
}
