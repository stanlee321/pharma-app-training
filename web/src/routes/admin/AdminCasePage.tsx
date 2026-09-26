import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, Navigate, Route, Routes, useNavigate, useParams } from 'react-router-dom';
import { adminApi } from '../../api/adminApi';
import { errorMessage } from '../../api/backend';
import { caseTitle } from '../../api/factory';
import type { AnesthesiaCase } from '../../api/types';
import { Icon } from '../../components/Icon';
import { ReadOnlyProvider } from '../../components/ReadOnly';
import type { ReadOnlyState } from '../../components/readOnlyContext';
import { Section } from '../../components/Section';
import { StatusBadge } from '../../components/StatusBadge';
import { formatDateTime } from '../../lib/datetime';
import { ADMIN_SCOPE, CaseScopeContext, type CaseScope } from '../../state/caseScope';
import { caseStore } from '../../state/caseStore';
import { DocumentsPanel } from '../documents/DocumentsPanel';
import { DrugLedgerScreen } from '../drugs/DrugLedgerScreen';
import { EncounterHubView } from '../EncounterHubView';
import { FluidBalanceScreen } from '../fluids/FluidBalanceScreen';
import { MonitoringScreen } from '../monitoring/MonitoringScreen';
import { NewbornScreen } from '../newborn/NewbornScreen';
import { PatientDataScreen } from '../PatientDataScreen';
import { paths } from '../paths';
import { PreanestheticView } from '../PreanestheticView';
import { RecoveryScreen } from '../recovery/RecoveryScreen';
import { ReviewExportScreen } from '../review/ReviewExportScreen';
import { TechniqueScreen } from '../technique/TechniqueScreen';
import { InlineAlert } from './adminUi';
import type { CasesNotice } from './AdminCasesPage';
import { casesListUrl } from './paging';
import { useQuery } from './useQuery';

const VIEWER: ReadOnlyState = { readOnly: true, reason: 'viewer' };

/**
 * An admin's read-only view of one case (`/admin/cases/:id/**`). It reuses the clinical section
 * screens unchanged through two scopes, never per-screen forks:
 * - the case scope (`state/caseScope.ts`): links point under `/admin/cases/{id}` and the case is
 *   read with `GET /admin/cases/{id}` (kept view-only in the store: no edit or save is possible);
 * - the read-only scope (`ReadOnlyProvider`, reason "viewer"): every shared control is disabled,
 *   add/delete affordances are hidden and Save is locked, exactly as for a finalized case.
 * The Hub adds the admin's own actions: case facts, Reopen (finalized cases), the documents
 * panel (generate / view / delete) and Delete case, each with an in-page confirmation.
 */
export function AdminCasePage() {
  const { id = '' } = useParams();
  const scope: CaseScope = { ...ADMIN_SCOPE, list: { to: casesListUrl(paths.admin.cases), label: 'Cases' } };
  return (
    <CaseScopeContext.Provider value={scope}>
      <ReadOnlyProvider value={VIEWER}>
        <Routes>
          <Route index element={<EncounterHubView aside={(c) => <AdminCaseActions c={c} />} />} />
          <Route path="patient" element={<PatientDataScreen />} />
          <Route path="preanesthetic" element={<PreanestheticView />} />
          <Route path="technique" element={<TechniqueScreen />} />
          <Route path="technique/:zone" element={<TechniqueScreen />} />
          <Route path="monitoring" element={<MonitoringScreen />} />
          <Route path="drugs" element={<DrugLedgerScreen />} />
          <Route path="fluids" element={<FluidBalanceScreen />} />
          <Route path="recovery" element={<RecoveryScreen />} />
          <Route path="newborn" element={<NewbornScreen />} />
          <Route path="review" element={<ReviewExportScreen />} />
          <Route path="*" element={<Navigate to={paths.admin.case(id)} replace />} />
        </Routes>
      </ReadOnlyProvider>
    </CaseScopeContext.Provider>
  );
}

function useMounted() {
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  return mounted;
}

/** Facts, Reopen, documents and Delete for the admin (rendered outside the disabled form). */
function AdminCaseActions({ c }: { c: AnesthesiaCase }) {
  const [reloadKey, setReloadKey] = useState(0);
  return (
    <ReadOnlyProvider value={{ readOnly: false, reason: null }}>
      <Section header="Case">
        <Fact label="Status" value={<StatusBadge status={c.status} />} />
        <Fact label="Account" value={<OwnerAccount userId={c.user_id} />} />
        <Fact label="Anesthesiologist (form)" value={c.owner.trim() || '—'} />
        <Fact label="Created" value={formatDateTime(c.created_at)} />
        <Fact label="Last change" value={formatDateTime(c.updated_at)} />
        {c.status === 'finalized' ? <Fact label="Finalized" value={formatDateTime(c.finalized_at)} /> : null}
        <div className="row">
          <Link className="btn-plain admin-inline-link" to={paths.admin.documentsFor(c.id)}>
            This case in the document index ›
          </Link>
        </div>
      </Section>
      {c.status === 'finalized' ? <ReopenSection c={c} onReopened={() => setReloadKey((k) => k + 1)} /> : null}
      <DocumentsPanel caseId={c.id} status={c.status} reloadKey={reloadKey} />
      <DeleteCaseSection c={c} />
    </ReadOnlyProvider>
  );
}

/**
 * The account that owns the case (`user_id`), resolved through `GET /admin/users/{id}` and linked
 * to it. This is who the case belongs to; `owner` is only the free-text name typed in the form.
 */
function OwnerAccount({ userId }: { userId: string | null }) {
  const q = useQuery(`case-account:${userId ?? ''}`, () =>
    userId ? adminApi.getUser(userId) : Promise.resolve(null),
  );
  // useQuery keeps the previous data while a new key loads: never show another case's account.
  const u = q.data && q.data.id === userId ? q.data : null;
  if (u) {
    const name = u.full_name.trim();
    return (
      <Link className="admin-table__link" to={paths.admin.user(u.id)}>
        {name ? `${name} (${u.username})` : u.username}
      </Link>
    );
  }
  if (!userId) return <>—</>;
  if (q.status === 'loading') return <>Loading…</>;
  return <>Account {userId.slice(0, 8)}…</>;
}

function Fact({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="row review-row">
      <span className="row__label">{label}</span>
      <span className="review-row__value">{value}</span>
    </div>
  );
}

/** Reopen (finalized → draft) so the owner can edit again; the stored documents are kept. */
function ReopenSection({ c, onReopened }: { c: AnesthesiaCase; onReopened: () => void }) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mounted = useMounted();

  const reopen = async () => {
    setBusy(true);
    setError(null);
    try {
      await adminApi.reopenCase(c.id);
      await caseStore.getState().load(c.id, { force: true, discard: true, access: 'admin' });
      if (!mounted.current) return;
      setConfirming(false);
      onReopened();
    } catch (e) {
      if (!mounted.current) return;
      setError(`Reopen failed: ${errorMessage(e)}`);
      // e.g. 409 "case is not finalized" (reopened elsewhere): show the server's current copy.
      void caseStore.getState().load(c.id, { force: true, discard: true, access: 'admin' });
    } finally {
      if (mounted.current) setBusy(false);
    }
  };

  return (
    <Section
      header="Reopen"
      footer="Reopening turns the case back into a draft so its anesthesiologist can edit it again. The stored documents are kept; finalizing again stores a new set."
    >
      {error ? <InlineAlert>{error}</InlineAlert> : null}
      {confirming ? (
        <div className="row admin-row-actions" role="group" aria-label="Confirm reopen">
          <span className="row__label">Reopen “{caseTitle(c)}” as a draft?</span>
          <button type="button" className="btn-plain" onClick={() => setConfirming(false)} disabled={busy}>
            Cancel
          </button>
          <button
            type="button"
            className="btn-primary btn-primary--compact"
            onClick={() => void reopen()}
            disabled={busy}
            aria-busy={busy}
          >
            {busy ? 'Reopening…' : 'Reopen case'}
          </button>
        </div>
      ) : (
        <div className="row admin-row-actions">
          <span className="row__label">
            <Icon name="lock" size={14} /> Finalized {formatDateTime(c.finalized_at)}
          </span>
          <button
            type="button"
            className="btn-plain"
            onClick={() => {
              setError(null);
              setConfirming(true);
            }}
          >
            Reopen…
          </button>
        </div>
      )}
    </Section>
  );
}

/** Delete the case and every stored document of it (any status). */
function DeleteCaseSection({ c }: { c: AnesthesiaCase }) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();
  const mounted = useMounted();

  const doDelete = async () => {
    setBusy(true);
    setError(null);
    const title = caseTitle(c);
    try {
      await adminApi.deleteCase(c.id);
    } catch (e) {
      if (mounted.current) {
        setError(`Delete failed: ${errorMessage(e)}`);
        setBusy(false);
      }
      return;
    }
    caseStore.getState().forget(c.id);
    const state: CasesNotice = { notice: `Deleted case “${title}” and its documents.` };
    navigate(casesListUrl(paths.admin.cases), { replace: true, state });
  };

  return (
    <Section header="Delete case">
      {error ? <InlineAlert>{error}</InlineAlert> : null}
      {confirming ? (
        <div className="row admin-row-actions" role="group" aria-label="Confirm deleting the case">
          <span className="row__label">
            Delete “{caseTitle(c)}” and all its stored documents permanently? This can’t be undone.
          </span>
          <button type="button" className="btn-plain" onClick={() => setConfirming(false)} disabled={busy}>
            Cancel
          </button>
          <button type="button" className="btn-destructive" onClick={() => void doDelete()} disabled={busy}>
            {busy ? 'Deleting…' : 'Delete case'}
          </button>
        </div>
      ) : (
        <div className="row admin-row-actions">
          <span className="row__label">Removes the case, finalized or not, with its documents.</span>
          <button
            type="button"
            className="btn-plain btn-plain--destructive"
            onClick={() => {
              setError(null);
              setConfirming(true);
            }}
          >
            Delete case…
          </button>
        </div>
      )}
    </Section>
  );
}
