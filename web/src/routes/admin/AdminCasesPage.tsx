import { plural, UI } from '../../lib/wording';
import { useEffect, useId } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { adminApi, type CaseFilters } from '../../api/adminApi';
import { STATUS_LABELS, type AdminCasePage, type CaseStatus, type CaseSummaryDTO, type UserDTO } from '../../api/types';
import { EmptyState } from '../../components/EmptyState';
import { Section } from '../../components/Section';
import { StatusBadge } from '../../components/StatusBadge';
import { formatDateTime } from '../../lib/datetime';
import { paths } from '../paths';
import { InlineAlert, LoadError, LoadingRow } from './adminUi';
import { Pager } from './Pager';
import { isUuid, isoDay, offsetOf, PAGE_SIZE, pageFrom, rememberCasesSearch, withParam } from './paging';
import { useQuery } from './useQuery';
import { useUrlText } from './useUrlText';

/** Location state left by a case page (e.g. after a delete). */
export interface CasesNotice {
  notice?: string;
}

interface UrlFilters {
  status: CaseStatus | '';
  user_id: string;
  patient_id: string;
  q: string;
  date_from: string;
  date_to: string;
  page: number;
}

/** Filters live in the URL (`?status=&user_id=&patient_id=&q=&date_from=&date_to=&page=`): links, Back and reload keep them. */
function filtersFrom(sp: URLSearchParams): UrlFilters {
  const status = sp.get('status');
  return {
    status: status === 'draft' || status === 'finalized' ? status : '',
    user_id: sp.get('user_id') ?? '',
    patient_id: (sp.get('patient_id') ?? '').trim(),
    q: sp.get('q') ?? '',
    date_from: isoDay(sp.get('date_from')),
    date_to: isoDay(sp.get('date_to')),
    page: pageFrom(sp),
  };
}

const ownerLabel = (u: Pick<UserDTO, 'full_name' | 'username'>) =>
  u.full_name.trim() ? `${u.full_name.trim()} (${u.username})` : u.username;

/**
 * Cases (`GET /admin/cases`): every anesthesiologist's cases, newest first, filterable by status,
 * anesthesiologist, created-date range (inclusive UTC days) and free text, paginated. Each row
 * opens the read-only case view. The dashboard's per-anesthesiologist links land here with
 * `?user_id=`, and a patient's links with `?patient_id=` (shown as a removable "Paciente" chip).
 */
/** The patient's registro, else the case's own snapshot (legacy patients may have none). */
const caseRegistro = (c: CaseSummaryDTO): string => c.patient_registro?.trim() || (c.registro ?? '').trim();

export function AdminCasesPage() {
  const [sp, setSp] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const notice = (location.state as CasesNotice | null)?.notice;
  const f = filtersFrom(sp);
  const [search, setSearch] = useUrlText(sp, setSp, 'q');
  const badRange = !!(f.date_from && f.date_to && f.date_from > f.date_to);
  // A malformed ?patient_id= is reported locally (the server would 422) and not requested.
  const badPatient = !!f.patient_id && !isUuid(f.patient_id);
  const invalid = badRange || badPatient;
  const ids = { q: useId(), status: useId(), owner: useId(), from: useId(), to: useId() };

  useEffect(() => {
    rememberCasesSearch(location.search);
  }, [location.search]);

  const query: CaseFilters = {
    status: f.status,
    user_id: f.user_id,
    patient_id: f.patient_id,
    q: f.q,
    date_from: f.date_from,
    date_to: f.date_to,
    limit: PAGE_SIZE,
    offset: offsetOf(f.page),
  };
  const key = JSON.stringify(query) + (invalid ? '!' : '');
  // An impossible date range is reported locally (the server would 422) and not requested.
  const q = useQuery<AdminCasePage | null>(key, () => (invalid ? Promise.resolve(null) : adminApi.listCases(query)));
  // The patient of a ?patient_id= filter, for its chip (the filter works even if this fails).
  const filterPatient = useQuery(`filter-patient:${badPatient ? '' : f.patient_id}`, () =>
    f.patient_id && !badPatient ? adminApi.getPatient(f.patient_id) : Promise.resolve(null),
  );
  const chipPatient = filterPatient.data && filterPatient.data.id === f.patient_id ? filterPatient.data : null;
  // Only anesthesiologists own cases; an unknown ?user_id= still gets its own "Account …" option.
  const owners = useQuery('owners', () => adminApi.listUsers({ role: 'anesthesiologist' }));

  const set = (name: string, value: string) => setSp(withParam(sp, name, value), { replace: true });
  const goPage = (page: number) => setSp(withParam(sp, 'page', page > 1 ? String(page) : ''));
  const filtered = !!(f.status || f.user_id || f.patient_id || f.q || f.date_from || f.date_to);

  const ownerOptions = [...(owners.data ?? [])].sort((a, b) => ownerLabel(a).localeCompare(ownerLabel(b)));
  const knownOwner = !f.user_id || ownerOptions.some((u) => u.id === f.user_id);

  const page = q.data ?? undefined;

  return (
    <>
      <div className="admin-head">
        <h1 className="large-title">Casos</h1>
      </div>

      {notice ? (
        <InlineAlert tone="success">
          <span>{notice}</span>{' '}
          <button type="button" className="btn-plain" onClick={() => navigate(location, { replace: true, state: null })}>
            {UI.dismiss}
          </button>
        </InlineAlert>
      ) : null}

      <form className="admin-filters" role="search" aria-label="Filtrar casos" onSubmit={(e) => e.preventDefault()}>
        <div className="admin-filter admin-filter--grow">
          <label htmlFor={ids.q}>{UI.search}</label>
          <input
            id={ids.q}
            type="search"
            value={search}
            placeholder="Paciente, registro, diagnóstico, autor, id del caso"
            autoComplete="off"
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="admin-filter">
          <label htmlFor={ids.status}>Estado</label>
          <select id={ids.status} value={f.status} onChange={(e) => set('status', e.target.value)}>
            <option value="">Cualquier estado</option>
            {(Object.keys(STATUS_LABELS) as CaseStatus[]).map((s) => (
              <option key={s} value={s}>
                {STATUS_LABELS[s]}
              </option>
            ))}
          </select>
        </div>
        <div className="admin-filter">
          <label htmlFor={ids.owner}>Anestesiólogo</label>
          <select id={ids.owner} value={f.user_id} onChange={(e) => set('user_id', e.target.value)}>
            <option value="">Todos</option>
            {knownOwner ? null : <option value={f.user_id}>Cuenta {f.user_id.slice(0, 8)}…</option>}
            {ownerOptions.map((u) => (
              <option key={u.id} value={u.id}>
                {ownerLabel(u)}
              </option>
            ))}
          </select>
        </div>
        <div className="admin-filter">
          <label htmlFor={ids.from}>Creado desde</label>
          <input
            id={ids.from}
            type="date"
            value={f.date_from}
            max={f.date_to || undefined}
            aria-invalid={badRange || undefined}
            onChange={(e) => set('date_from', isoDay(e.target.value))}
          />
        </div>
        <div className="admin-filter">
          <label htmlFor={ids.to}>Creado hasta</label>
          <input
            id={ids.to}
            type="date"
            value={f.date_to}
            min={f.date_from || undefined}
            aria-invalid={badRange || undefined}
            onChange={(e) => set('date_to', isoDay(e.target.value))}
          />
        </div>
        {filtered ? (
          <button
            type="button"
            className="btn-plain admin-filters__clear"
            onClick={() => {
              setSearch('');
              setSp(new URLSearchParams(), { replace: true });
            }}
          >
            {UI.clearFilters}
          </button>
        ) : null}
      </form>

      {f.patient_id ? (
        <p className="admin-filter-chip" data-testid="patient-filter">
          <span>
            Paciente:{' '}
            {badPatient ? (
              'identificador no válido'
            ) : chipPatient ? (
              <Link to={paths.admin.patient(chipPatient.id)}>
                {chipPatient.nombre.trim() || 'Sin nombre'}
                {chipPatient.registro ? ` · Registro ${chipPatient.registro}` : ''}
              </Link>
            ) : (
              `${f.patient_id.slice(0, 8)}…`
            )}
          </span>
          <button type="button" className="btn-plain" onClick={() => set('patient_id', '')}>
            Quitar filtro de paciente
          </button>
        </p>
      ) : null}

      {badPatient ? (
        <InlineAlert>El filtro de paciente no es un identificador válido. Quítelo para ver los casos.</InlineAlert>
      ) : null}

      {badRange ? (
        <InlineAlert>«Creado desde» es posterior a «Creado hasta». Elija un día inicial igual o anterior al final.</InlineAlert>
      ) : null}

      <Section
        header={
          page
            ? `${plural(page.total, 'caso', 'casos')}${filtered ? UI.filtered : ''}`
            : 'Casos'
        }
        footer="Las fechas son días de creación en UTC, inclusive."
      >
        {badRange ? (
          <EmptyState icon="warning" title="Rango de fechas no válido" description="No se solicitaron casos." />
        ) : badPatient ? (
          <EmptyState icon="warning" title="Filtro de paciente no válido" description="No se solicitaron casos." />
        ) : !page ? (
          q.status === 'error' ? (
            <LoadError title="No se pudieron cargar los casos" error={q.error} onRetry={q.reload} />
          ) : (
            <LoadingRow label="Cargando casos…" />
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
            {page.items.length === 0 ? (
              page.total > 0 ? (
                <EmptyState
                  icon="tray"
                  title={UI.emptyPage}
                  description={`Solo hay ${plural(page.total, 'caso', 'casos')} que coinciden.`}
                  action={
                    <button type="button" className="btn-plain" onClick={() => goPage(1)}>
                      {UI.firstPage}
                    </button>
                  }
                />
              ) : (
                <EmptyState
                  icon="tray"
                  title={filtered ? 'Ningún caso coincide' : 'Aún no hay casos'}
                  description={
                    filtered
                      ? 'Pruebe otra búsqueda o limpie los filtros.'
                      : 'Los casos aparecen aquí cuando un anestesiólogo crea uno.'
                  }
                />
              )
            ) : (
              <>
                <div className="admin-table-scroll">
                  <table className="admin-table">
                    <caption className="visually-hidden">Casos</caption>
                    <thead>
                      <tr>
                        <th scope="col">Paciente</th>
                        <th scope="col">Anestesiólogo</th>
                        <th scope="col">Estado</th>
                        <th scope="col" className="hide-narrow">
                          Creado
                        </th>
                        <th scope="col" className="hide-narrow">
                          Actualizado
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {page.items.map((c) => (
                        <tr key={c.id} data-testid="case-row" data-case-id={c.id}>
                          <th scope="row">
                            <Link to={paths.admin.case(c.id)} className="admin-table__link">
                              {(c.patient_nombre ?? c.nombre).trim() || 'Sin nombre'}
                            </Link>
                            <span className="admin-table__sub" data-testid="case-row-registro">
                              {caseRegistro(c) ? `Registro ${caseRegistro(c)}` : 'Sin registro'}
                            </span>
                            <span className="admin-table__sub">{c.diagnostico_preop.trim() || '—'}</span>
                            {c.patient_id && !f.patient_id ? (
                              <Link to={paths.admin.casesForPatient(c.patient_id)} className="admin-table__sub">
                                Solo este paciente
                              </Link>
                            ) : null}
                          </th>
                          <td>
                            {c.owner_name?.trim() || c.owner || '—'}
                            {c.user_id && !f.user_id ? (
                              <Link to={paths.admin.casesFor(c.user_id)} className="admin-table__sub">
                                Solo este anestesiólogo
                              </Link>
                            ) : null}
                          </td>
                          <td>
                            <StatusBadge status={c.status ?? 'draft'} />
                          </td>
                          <td className="hide-narrow">{formatDateTime(c.created_at)}</td>
                          <td className="hide-narrow">{formatDateTime(c.updated_at)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
            {page.total > 0 ? (
              <Pager
                page={f.page}
                pageSize={PAGE_SIZE}
                total={page.total}
                shown={page.items.length}
                label="Páginas de casos"
                onPage={goPage}
              />
            ) : null}
          </div>
        )}
      </Section>
    </>
  );
}
