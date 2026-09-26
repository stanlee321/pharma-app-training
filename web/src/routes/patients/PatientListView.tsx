import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { EmptyState } from '../../components/EmptyState';
import { TextRow } from '../../components/FormRows';
import { Icon } from '../../components/Icon';
import { Page } from '../../components/Page';
import { Section } from '../../components/Section';
import { useAuthStore } from '../../state/authStore';
import { patientSubtitle, SEARCH_DEBOUNCE_MS } from '../../state/patientForm';
import { patientStore, usePatientStore } from '../../state/patientStore';
import { paths } from '../paths';
import { RestoredDraftsBanner } from '../RestoredDraftsBanner';
import { UserMenu } from '../UserMenu';
import '../encounters.css';
import './patients.css';

/**
 * Historias clínicas — the anesthesiologist's landing: every patient of the hospital (shared),
 * searchable by nombre or registro (the search is kept in `?q=`). "+" registers a new patient;
 * a row opens the patient screen (identity + their cases).
 */
export function PatientListView() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const urlQ = params.get('q') ?? '';
  const [text, setText] = useState(urlQ);
  const list = usePatientStore((s) => s.list);
  const restored = useAuthStore((s) => s.restoredDrafts);

  // The URL is the source of truth for the search (Back / reload keep it).
  useEffect(() => {
    void patientStore.getState().search(urlQ);
  }, [urlQ]);

  // The URL changed elsewhere (Back, a link): show its search in the box.
  useEffect(() => {
    setText((t) => (t.trim() === urlQ ? t : urlQ));
  }, [urlQ]);

  // Typing updates the URL after a pause.
  useEffect(() => {
    const t = setTimeout(() => {
      const q = text.trim();
      if (q === urlQ) return;
      setParams(q ? { q } : {}, { replace: true });
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [text, urlQ, setParams]);

  const current = list.q === urlQ;
  const loading = list.status === 'loading' || list.status === 'idle' || (!current && list.status !== 'error');

  return (
    <Page
      title="Historias clínicas"
      leading={<UserMenu />}
      trailing={
        <button type="button" className="toolbar-round" onClick={() => navigate(paths.pacienteNuevo)} aria-label="Nuevo paciente">
          <Icon name="plus" size={22} />
        </button>
      }
    >
      {restored ? <RestoredDraftsBanner report={restored} /> : null}

      <Section>
        <TextRow label="Buscar" type="search" value={text} onChange={setText} placeholder="Nombre o registro" noAutoCorrect />
      </Section>

      {list.status === 'error' ? (
        <div className="banner" role="alert">
          <Icon name="warning" size={18} />
          <span className="banner__text">No se pudo cargar la lista de pacientes: {list.error}</span>
          <button type="button" className="btn-plain" onClick={() => void patientStore.getState().search(urlQ)}>
            Reintentar
          </button>
        </div>
      ) : null}

      <Section
        header="Pacientes"
        footer={
          current && list.total > list.items.length
            ? `Mostrando ${list.items.length} de ${list.total}. Refine la búsqueda para ver los demás.`
            : undefined
        }
      >
        {loading && (list.items.length === 0 || !current) ? (
          <div className="row" role="status">
            <span className="spinner" aria-hidden="true" />
            <span className="row__label">Cargando…</span>
          </div>
        ) : list.status === 'error' && list.items.length === 0 ? (
          <EmptyState icon="warning" title="Sin datos" description="La lista no está disponible." />
        ) : list.items.length === 0 ? (
          urlQ ? (
            <EmptyState icon="tray" title="Sin resultados" description={`Ningún paciente coincide con «${urlQ}».`} />
          ) : (
            <EmptyState
              icon="tray"
              title="Aún no hay pacientes"
              description="Pulse + para registrar al primer paciente."
            />
          )
        ) : (
          list.items.map((p) => (
            <div className="encounter-row" key={p.id}>
              <Link to={paths.paciente(p.id)} className="encounter-row__link">
                <span className="encounter-row__text">
                  <span className="encounter-row__title">{p.nombre}</span>
                  <span className="encounter-row__subtitle">{patientSubtitle(p)}</span>
                </span>
                <Icon name="chevronRight" size={16} className="encounter-row__chevron" />
              </Link>
            </div>
          ))
        )}
      </Section>
    </Page>
  );
}
