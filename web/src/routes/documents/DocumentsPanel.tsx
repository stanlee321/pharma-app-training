import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { CaseStatus, DocumentDTO, FormId } from '../../api/types';
import { ConfirmDeleteButton } from '../../components/ConfirmDeleteButton';
import { Icon } from '../../components/Icon';
import { ReadOnlyProvider } from '../../components/ReadOnly';
import { EDITABLE } from '../../components/readOnlyContext';
import { Section } from '../../components/Section';
import { formatDateTime } from '../../lib/datetime';
import { useAuthStore } from '../../state/authStore';
import { useCaseScope } from '../../state/caseScope';
import { caseStore } from '../../state/caseStore';
import { canDeleteDocuments, formatSize, groupDocuments, type DocumentGroup } from '../../state/documents';
import { DEFAULT_FORM, exportErrorMessage, FORM_OPTIONS, formTitle } from '../../state/review';
import '../review/review.css';
import { PdfPreview } from './PdfPreview';
import { usePdfPreview } from './usePdfPreview';
import './documents.css';

export interface DocumentsPanelProps {
  caseId: string;
  status: CaseStatus;
  /** Bump to re-fetch the list (e.g. after finalize stored the 4 forms). */
  reloadKey?: number;
}

const online = () => (typeof navigator === 'undefined' ? true : navigator.onLine);

/**
 * Stored documents of one case (owner or admin): newest first, grouped by form in the known form
 * order (latest shown, older versions expandable); "Generate & store" renders one form server-side
 * and keeps it; View fetches the file through the authenticated HTTP layer into a blob URL (never a
 * bare link to the API, which would lack the token), shown inline with a Download link and revoked
 * when replaced, closed or unmounted. Delete: admin, or the owner while the case is a draft.
 *
 * The panel is not case content, so it resets the read-only scope and applies its own rules.
 */
export function DocumentsPanel({ caseId, status, reloadKey = 0 }: DocumentsPanelProps) {
  const user = useAuthStore((s) => s.user);
  // How this screen reads the case (an admin's copy stays view-only in the store).
  const { access } = useCaseScope();
  const selectId = useId();
  const [docs, setDocs] = useState<DocumentDTO[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [formId, setFormId] = useState<FormId>(DEFAULT_FORM);
  const [generating, setGenerating] = useState(false);
  const {
    preview,
    opening,
    error: actionError,
    setError: setActionError,
    open,
    close: closePreview,
  } = usePdfPreview((docId) => caseStore.getState().backend.documentFile(docId));
  const mounted = useRef(true);
  const canDelete = canDeleteDocuments(user, status);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const refresh = useCallback(async () => {
    try {
      const list = await caseStore.getState().backend.listDocuments(caseId);
      if (!mounted.current) return;
      setDocs(list);
      setListError(null);
    } catch (e) {
      if (!mounted.current) return;
      setListError(exportErrorMessage(e, online(), 'Loading documents'));
    }
  }, [caseId]);

  useEffect(() => {
    void refresh();
  }, [refresh, reloadKey, status]);

  const generate = async () => {
    setGenerating(true);
    setActionError(null);
    try {
      const doc = await caseStore.getState().generateDocument(caseId, formId, { access });
      if (!mounted.current) return;
      await refresh();
      await open(doc); // keep an inline preview of the newest document
    } catch (e) {
      if (mounted.current) setActionError(exportErrorMessage(e, online(), 'Generating the form'));
    } finally {
      if (mounted.current) setGenerating(false);
    }
  };

  const remove = async (d: DocumentDTO) => {
    setActionError(null);
    try {
      await caseStore.getState().backend.deleteDocument(d.id);
      if (!mounted.current) return;
      if (preview?.docId === d.id) closePreview();
      setDocs((list) => (list ? list.filter((x) => x.id !== d.id) : list));
    } catch (e) {
      if (!mounted.current) return;
      setActionError(exportErrorMessage(e, online(), 'Delete'));
      await refresh();
    }
  };

  const groups = docs ? groupDocuments(docs) : [];

  const row = (d: DocumentDTO, label?: string) => (
    <div className="row doc-row" key={d.id} data-testid="document-row" data-doc-id={d.id}>
      <span className="doc-row__text">
        {label ? <span className="doc-row__title">{label}</span> : null}
        <span className="doc-row__meta">
          {formatDateTime(d.created_at)} · {formatSize(d.size_bytes)}
          {d.is_fallback ? <span className="doc-row__fallback"> · summary fallback</span> : null}
        </span>
      </span>
      <button
        type="button"
        className="btn-plain"
        aria-label={`View ${formTitle(d.form_id)} of ${formatDateTime(d.created_at)}`}
        disabled={opening === d.id}
        onClick={() => void open(d)}
      >
        {opening === d.id ? 'Opening…' : 'View'}
      </button>
      {canDelete ? (
        <ConfirmDeleteButton
          label={`Delete ${formTitle(d.form_id)} of ${formatDateTime(d.created_at)}`}
          onDelete={() => void remove(d)}
        />
      ) : null}
    </div>
  );

  const group = (g: DocumentGroup) => (
    <div className="doc-group" key={g.formId} role="group" aria-label={g.title} data-form-id={g.formId}>
      {row(g.latest, g.title)}
      {g.older.length > 0 ? (
        <details className="doc-group__older">
          <summary className="row doc-group__summary">
            Older versions ({g.older.length})
          </summary>
          {g.older.map((d) => row(d))}
        </details>
      ) : null}
    </div>
  );

  return (
    <ReadOnlyProvider value={EDITABLE}>
      <Section
        header="Documents"
        footer={
          status === 'finalized'
            ? 'The four forms were stored when the case was finalized. Generating again adds a new version.'
            : 'Generate & store renders the filled form server-side from the saved case and keeps it with the case.'
        }
      >
        <div className="row">
          <label className="row__label row__label--primary" htmlFor={selectId}>
            Formulario
          </label>
          <select
            id={selectId}
            className="review-select"
            value={formId}
            onChange={(e) => setFormId(e.target.value as FormId)}
          >
            {FORM_OPTIONS.map((f) => (
              <option key={f.id} value={f.id}>
                {f.title}
              </option>
            ))}
          </select>
        </div>
        <div className="row">
          <button
            type="button"
            className="btn-primary review-export"
            onClick={() => void generate()}
            disabled={generating}
            aria-busy={generating}
          >
            <Icon name="doc" size={18} />
            <span>{generating ? 'Generating…' : 'Generate & store'}</span>
            {generating ? <span className="spinner spinner--on-blue" aria-hidden="true" /> : null}
          </button>
        </div>

        {actionError ? (
          <div className="row review-error" role="alert">
            <Icon name="warning" size={16} />
            <span className="review-error__text">{actionError}</span>
          </div>
        ) : null}

        {listError ? (
          <div className="row review-error" role="alert">
            <Icon name="warning" size={16} />
            <span className="review-error__text">{listError}</span>
            <button type="button" className="btn-plain" onClick={() => void refresh()}>
              Retry
            </button>
          </div>
        ) : docs === null ? (
          <div className="row" role="status">
            <span className="spinner" aria-hidden="true" />
            <span className="row__label">Loading documents…</span>
          </div>
        ) : groups.length === 0 ? (
          <div className="row review-empty">No stored documents yet</div>
        ) : (
          <div data-testid="document-groups">{groups.map(group)}</div>
        )}

        {preview ? <PdfPreview preview={preview} onClose={closePreview} /> : null}
      </Section>
    </ReadOnlyProvider>
  );
}
