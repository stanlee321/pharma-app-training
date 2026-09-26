import { plural, UI } from '../../lib/wording';
import { useId } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { adminApi, type DocumentFilters } from '../../api/adminApi';
import { FORM_IDS, type AdminDocumentPage, type FormId } from '../../api/types';
import { EmptyState } from '../../components/EmptyState';
import { Section } from '../../components/Section';
import { formatDateTime } from '../../lib/datetime';
import { formatSize, storageInfo } from '../../state/documents';
import { FORM_OPTIONS, formTitle } from '../../state/review';
import { PdfPreview } from '../documents/PdfPreview';
import { usePdfPreview } from '../documents/usePdfPreview';
import { paths } from '../paths';
import { InlineAlert, LoadError, LoadingRow } from './adminUi';
import { Pager } from './Pager';
import { isUuid, offsetOf, PAGE_SIZE, pageFrom, withParam } from './paging';
import { useQuery } from './useQuery';
import { useUrlText } from './useUrlText';
import '../documents/documents.css';

const isFormId = (v: string | null): v is FormId => !!v && (FORM_IDS as readonly string[]).includes(v);

/**
 * Documents (`GET /admin/documents`): every stored PDF, newest first, filterable by form and by
 * case (a case id; the case page links here with `?case_id=`), paginated. "Open" fetches the file
 * through the authenticated HTTP layer and shows it inline with a Download link (a blob URL,
 * revoked when replaced, closed or the page is left); a bare link to the API would lack the token.
 */
export function AdminDocumentsPage() {
  const [sp, setSp] = useSearchParams();
  const formParam = sp.get('form_id');
  const formId: FormId | '' = isFormId(formParam) ? formParam : '';
  const page = pageFrom(sp);
  const [caseText, setCaseText] = useUrlText(sp, setSp, 'case_id');
  const urlCase = (sp.get('case_id') ?? '').trim();
  const caseInvalid = !!urlCase && !isUuid(urlCase);
  const typedInvalid = !!caseText.trim() && !isUuid(caseText);
  const ids = { form: useId(), caseId: useId(), caseErr: useId() };

  const query: DocumentFilters = {
    form_id: formId,
    case_id: urlCase.toLowerCase(),
    limit: PAGE_SIZE,
    offset: offsetOf(page),
  };
  // A malformed case id is flagged on the field (the server would 422) and not requested.
  const q = useQuery<AdminDocumentPage | null>(JSON.stringify(query) + (caseInvalid ? '!' : ''), () =>
    caseInvalid ? Promise.resolve(null) : adminApi.listDocuments(query),
  );
  const users = useQuery('doc-users', () => adminApi.listUsers({}));
  const nameOf = (id: string | null) => {
    if (!id) return '—';
    const u = users.data?.find((x) => x.id === id);
    return u ? u.full_name.trim() || u.username : `${id.slice(0, 8)}…`;
  };
  const { preview, opening, error: openError, open, close } = usePdfPreview((id) => adminApi.documentFile(id));

  const goPage = (n: number) => setSp(withParam(sp, 'page', n > 1 ? String(n) : ''));
  const filtered = !!(formId || urlCase);
  const data = q.data ?? undefined;

  return (
    <>
      <div className="admin-head">
        <h1 className="large-title">Documentos</h1>
      </div>

      <form className="admin-filters" role="search" aria-label="Filtrar documentos" onSubmit={(e) => e.preventDefault()}>
        <div className="admin-filter">
          <label htmlFor={ids.form}>Formulario</label>
          <select
            id={ids.form}
            value={formId}
            onChange={(e) => setSp(withParam(sp, 'form_id', e.target.value), { replace: true })}
          >
            <option value="">Todos los formularios</option>
            {FORM_OPTIONS.map((f) => (
              <option key={f.id} value={f.id}>
                {f.title}
              </option>
            ))}
          </select>
        </div>
        <div className="admin-filter admin-filter--grow">
          <label htmlFor={ids.caseId}>Id del caso</label>
          <input
            id={ids.caseId}
            type="search"
            value={caseText}
            placeholder="p. ej. 6f6e01f7-26e9-4684-…"
            autoComplete="off"
            spellCheck={false}
            aria-invalid={typedInvalid || undefined}
            aria-describedby={typedInvalid ? ids.caseErr : undefined}
            onChange={(e) => setCaseText(e.target.value)}
          />
          {typedInvalid ? (
            <span id={ids.caseErr} className="admin-filter__error">
              Pegue el id completo del caso (un UUID).
            </span>
          ) : null}
        </div>
        {filtered ? (
          <button
            type="button"
            className="btn-plain admin-filters__clear"
            onClick={() => {
              setCaseText('');
              setSp(new URLSearchParams(), { replace: true });
            }}
          >
            {UI.clearFilters}
          </button>
        ) : null}
      </form>

      {openError ? <InlineAlert>{openError}</InlineAlert> : null}
      {preview ? (
        <Section header="Vista previa">
          <PdfPreview preview={preview} onClose={close} />
        </Section>
      ) : null}

      <Section
        header={
          data
            ? `${plural(data.total, 'documento', 'documentos')}${filtered ? UI.filtered : ''}`
            : 'Documentos'
        }
      >
        {caseInvalid ? (
          <EmptyState icon="warning" title="No es un id de caso" description="Pegue el id completo del caso (un UUID) para filtrar por caso." />
        ) : !data ? (
          q.status === 'error' ? (
            <LoadError title="No se pudieron cargar los documentos" error={q.error} onRetry={q.reload} />
          ) : (
            <LoadingRow label="Cargando documentos…" />
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
                  description={`Solo hay ${plural(data.total, 'documento', 'documentos')} que coinciden.`}
                  action={
                    <button type="button" className="btn-plain" onClick={() => goPage(1)}>
                      {UI.firstPage}
                    </button>
                  }
                />
              ) : (
                <EmptyState
                  icon="doc"
                  title={filtered ? 'Ningún documento coincide' : 'Aún no hay documentos guardados'}
                  description={
                    filtered
                      ? 'Pruebe otro formulario o caso, o limpie los filtros.'
                      : 'Los documentos aparecen aquí cuando se guarda un formulario o se finaliza un caso.'
                  }
                />
              )
            ) : (
              <div className="admin-table-scroll">
                <table className="admin-table">
                  <caption className="visually-hidden">Documentos guardados</caption>
                  <thead>
                    <tr>
                      <th scope="col">Formulario</th>
                      <th scope="col">Caso</th>
                      <th scope="col">Guardado</th>
                      <th scope="col" className="hide-narrow">
                        Por
                      </th>
                      <th scope="col" className="num hide-narrow">
                        Tamaño
                      </th>
                      <th scope="col">
                        <span className="visually-hidden">Acciones</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.items.map((d) => (
                      <tr key={d.id} data-testid="document-row" data-doc-id={d.id}>
                        <th scope="row">
                          {formTitle(d.form_id)}
                          {d.is_fallback ? <span className="admin-table__sub doc-row__fallback">resumen de respaldo</span> : null}
                          <span
                            className="admin-table__sub admin-mono hide-narrow"
                            data-testid="document-storage"
                            title={storageInfo(d).title}
                          >
                            {storageInfo(d).label}
                          </span>
                        </th>
                        <td>
                          <Link to={paths.admin.case(d.case_id)} className="admin-table__link admin-mono">
                            {d.case_id.slice(0, 8)}
                          </Link>
                        </td>
                        <td>{formatDateTime(d.created_at)}</td>
                        <td className="hide-narrow">{nameOf(d.generated_by ?? null)}</td>
                        <td className="num hide-narrow">{formatSize(d.size_bytes)}</td>
                        <td>
                          <button
                            type="button"
                            className="btn-plain"
                            aria-label={`Abrir ${formTitle(d.form_id)} del ${formatDateTime(d.created_at)}`}
                            disabled={opening === d.id}
                            onClick={() => void open(d)}
                          >
                            {opening === d.id ? 'Abriendo…' : preview?.docId === d.id ? 'Mostrado' : 'Abrir'}
                          </button>
                        </td>
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
                label="Páginas de documentos"
                onPage={goPage}
              />
            ) : null}
          </div>
        )}
      </Section>
    </>
  );
}
