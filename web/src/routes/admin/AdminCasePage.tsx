import { STATUS_LABELS, UI } from '../../lib/wording';
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
  const scope: CaseScope = { ...ADMIN_SCOPE, list: { to: casesListUrl(paths.admin.cases), label: 'Casos' } };
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
      <Section header="Caso">
        <Fact label="Estado" value={<StatusBadge status={c.status} />} />
        <Fact
          label="Paciente"
          value={
            c.patient_id ? (
              <Link className="admin-table__link" to={paths.admin.patient(c.patient_id)}>
                {c.patient.nombre.trim() || 'Sin nombre'}
                {c.patient.registro ? ` · Registro ${c.patient.registro}` : ''}
              </Link>
            ) : (
              c.patient.nombre.trim() || '—'
            )
          }
        />
        <Fact label="Cuenta" value={<OwnerAccount userId={c.user_id} />} />
        <Fact label="Anestesiólogo (formulario)" value={c.owner.trim() || '—'} />
        <Fact label="Creado" value={formatDateTime(c.created_at)} />
        <Fact label="Último cambio" value={formatDateTime(c.updated_at)} />
        {c.status === 'finalized' ? <Fact label={STATUS_LABELS.finalized} value={formatDateTime(c.finalized_at)} /> : null}
        <div className="row">
          <Link className="btn-plain admin-inline-link" to={paths.admin.documentsFor(c.id)}>
            Este caso en el índice de documentos ›
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
  if (q.status === 'loading') return <>{UI.loading}</>;
  return <>Cuenta {userId.slice(0, 8)}…</>;
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
      setError(`No se pudo reabrir: ${errorMessage(e)}`);
      // e.g. 409 "case is not finalized" (reopened elsewhere): show the server's current copy.
      void caseStore.getState().load(c.id, { force: true, discard: true, access: 'admin' });
    } finally {
      if (mounted.current) setBusy(false);
    }
  };

  return (
    <Section
      header="Reabrir"
      footer="Reabrir devuelve el caso a borrador para que su anestesiólogo pueda editarlo de nuevo. Los documentos guardados se conservan; al finalizar de nuevo se guarda un juego nuevo."
    >
      {error ? <InlineAlert>{error}</InlineAlert> : null}
      {confirming ? (
        <div className="row admin-row-actions" role="group" aria-label="Confirmar reapertura">
          <span className="row__label">¿Reabrir «{caseTitle(c)}» como borrador?</span>
          <button type="button" className="btn-plain" onClick={() => setConfirming(false)} disabled={busy}>
            {UI.cancel}
          </button>
          <button
            type="button"
            className="btn-primary btn-primary--compact"
            onClick={() => void reopen()}
            disabled={busy}
            aria-busy={busy}
          >
            {busy ? 'Reabriendo…' : 'Reabrir caso'}
          </button>
        </div>
      ) : (
        <div className="row admin-row-actions">
          <span className="row__label">
            <Icon name="lock" size={14} /> {STATUS_LABELS.finalized} {formatDateTime(c.finalized_at)}
          </span>
          <button
            type="button"
            className="btn-plain"
            onClick={() => {
              setError(null);
              setConfirming(true);
            }}
          >
            Reabrir…
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
        setError(`No se pudo eliminar: ${errorMessage(e)}`);
        setBusy(false);
      }
      return;
    }
    caseStore.getState().forget(c.id);
    const state: CasesNotice = { notice: `Se eliminó el caso «${title}» y sus documentos.` };
    navigate(casesListUrl(paths.admin.cases), { replace: true, state });
  };

  return (
    <Section header="Eliminar caso">
      {error ? <InlineAlert>{error}</InlineAlert> : null}
      {confirming ? (
        <div className="row admin-row-actions" role="group" aria-label="Confirmar eliminación del caso">
          <span className="row__label">
            ¿Eliminar definitivamente «{caseTitle(c)}» y todos sus documentos guardados? No se puede deshacer.
          </span>
          <button type="button" className="btn-plain" onClick={() => setConfirming(false)} disabled={busy}>
            {UI.cancel}
          </button>
          <button type="button" className="btn-destructive" onClick={() => void doDelete()} disabled={busy}>
            {busy ? UI.deleting : 'Eliminar caso'}
          </button>
        </div>
      ) : (
        <div className="row admin-row-actions">
          <span className="row__label">Elimina el caso, finalizado o no, con sus documentos.</span>
          <button
            type="button"
            className="btn-plain btn-plain--destructive"
            onClick={() => {
              setError(null);
              setConfirming(true);
            }}
          >
            Eliminar caso…
          </button>
        </div>
      )}
    </Section>
  );
}
