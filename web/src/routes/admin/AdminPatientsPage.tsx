import { useId } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { adminApi } from '../../api/adminApi';
import { EmptyState } from '../../components/EmptyState';
import { Section } from '../../components/Section';
import { formatDateTime } from '../../lib/datetime';
import { plural, UI } from '../../lib/wording';
import { patientFacts } from '../../state/patientForm';
import { paths } from '../paths';
import { InlineAlert, LoadError, LoadingRow } from './adminUi';
import { Pager } from './Pager';
import { offsetOf, PAGE_SIZE, pageFrom, withParam } from './paging';
import { useQuery } from './useQuery';
import { useUrlText } from './useUrlText';

/** Location state a patient page leaves behind (e.g. after a delete). */
export interface PatientsNotice {
  notice?: string;
}

/**
 * Pacientes (`GET /admin/patients`): every patient of the hospital by name, with the number of
 * cases, searchable by nombre or registro (`?q=`) and paginated (`?page=`). A row opens the
 * admin's read-only patient page; the case count opens the case list filtered to the patient.
 */
export function AdminPatientsPage() {
  const [sp, setSp] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const notice = (location.state as PatientsNotice | null)?.notice;
  const urlQ = sp.get('q') ?? '';
  const page = pageFrom(sp);
  const [search, setSearch] = useUrlText(sp, setSp, 'q');
  const searchId = useId();

  const query = { q: urlQ, limit: PAGE_SIZE, offset: offsetOf(page) };
  const q = useQuery(JSON.stringify(query), () => adminApi.listPatients(query));
  const goPage = (n: number) => setSp(withParam(sp, 'page', n > 1 ? String(n) : ''));
  const filtered = !!urlQ;
  const data = q.data;

  return (
    <>
      <div className="admin-head">
        <h1 className="large-title">Pacientes</h1>
      </div>

      {notice ? (
        <InlineAlert tone="success">
          <span>{notice}</span>{' '}
          <button type="button" className="btn-plain" onClick={() => navigate(location, { replace: true, state: null })}>
            {UI.dismiss}
          </button>
        </InlineAlert>
      ) : null}

      <form className="admin-filters" role="search" aria-label="Buscar pacientes" onSubmit={(e) => e.preventDefault()}>
        <div className="admin-filter admin-filter--grow">
          <label htmlFor={searchId}>{UI.search}</label>
          <input
            id={searchId}
            type="search"
            value={search}
            placeholder="Nombre o registro"
            autoComplete="off"
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </form>

      <Section
        header={data ? `${plural(data.total, 'paciente', 'pacientes')}${filtered ? UI.filtered : ''}` : 'Pacientes'}
        footer="Los pacientes se comparten entre todos los anestesiólogos. Solo se puede eliminar un paciente sin casos."
      >
        {!data ? (
          q.status === 'error' ? (
            <LoadError title="No se pudieron cargar los pacientes" error={q.error} onRetry={q.reload} />
          ) : (
            <LoadingRow label="Cargando pacientes…" />
          )
        ) : (
          <div className={q.status === 'loading' ? 'admin-refetching' : undefined} aria-busy={q.status === 'loading'}>
            {q.status === 'error' ? (
              <InlineAlert>
                {UI.couldNotRefresh} {q.error}{' '}
                <button type="button" className="btn-plain" onClick={q.reload}>
                  {UI.retry}
                </button>
              </InlineAlert>
            ) : null}
            {data.items.length === 0 ? (
              data.total > 0 ? (
                <EmptyState
                  icon="tray"
                  title={UI.emptyPage}
                  description={`Solo hay ${plural(data.total, 'paciente', 'pacientes')} que coinciden.`}
                  action={
                    <button type="button" className="btn-plain" onClick={() => goPage(1)}>
                      {UI.firstPage}
                    </button>
                  }
                />
              ) : (
                <EmptyState
                  icon="person"
                  title={filtered ? 'Ningún paciente coincide' : 'Aún no hay pacientes'}
                  description={
                    filtered
                      ? 'Pruebe con otro nombre o registro.'
                      : 'Los pacientes aparecen aquí cuando un anestesiólogo registra uno.'
                  }
                />
              )
            ) : (
              <div className="admin-table-scroll">
                <table className="admin-table">
                  <caption className="visually-hidden">Pacientes</caption>
                  <thead>
                    <tr>
                      <th scope="col">Paciente</th>
                      <th scope="col" className="hide-narrow">
                        Edad y sexo
                      </th>
                      <th scope="col">Casos</th>
                      <th scope="col" className="hide-narrow">
                        Actualizado
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.items.map((p) => (
                      <tr key={p.id} data-testid="patient-row" data-patient-id={p.id}>
                        <th scope="row">
                          <Link to={paths.admin.patient(p.id)} className="admin-table__link">
                            {p.nombre.trim() || 'Sin nombre'}
                          </Link>
                          <span className="admin-table__sub">{p.registro ? `Registro ${p.registro}` : 'Sin registro'}</span>
                        </th>
                        <td className="hide-narrow">{patientFacts(p)}</td>
                        <td>
                          {p.cases_count > 0 ? (
                            <Link
                              to={paths.admin.casesForPatient(p.id)}
                              aria-label={`${plural(p.cases_count, 'caso', 'casos')} de ${p.nombre}`}
                            >
                              {plural(p.cases_count, 'caso', 'casos')}
                            </Link>
                          ) : (
                            'Sin casos'
                          )}
                        </td>
                        <td className="hide-narrow">{formatDateTime(p.updated_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {data.total > 0 ? (
              <Pager
                page={page}
                pageSize={PAGE_SIZE}
                total={data.total}
                shown={data.items.length}
                label="Páginas de pacientes"
                onPage={goPage}
              />
            ) : null}
          </div>
        )}
      </Section>
    </>
  );
}
