import type { ReactNode } from 'react';
import { useParams } from 'react-router-dom';
import type { AnesthesiaCase } from '../api/types';
import { EmptyState } from '../components/EmptyState';
import { Icon } from '../components/Icon';
import { Page, type BackLinkProps } from '../components/Page';
import { ReadOnlyBanner, ReadOnlyProvider } from '../components/ReadOnly';
import { useReadOnlyState, type ReadOnlyState } from '../components/readOnlyContext';
import { SaveBar } from '../components/SaveBar';
import { Section } from '../components/Section';
import { StatusBadge } from '../components/StatusBadge';
import { caseStore, useCaseStore } from '../state/caseStore';
import { useCaseScope } from '../state/caseScope';
import { useCase } from '../state/useCase';
import { useSaveOnLeave } from '../state/useSaveOnLeave';

export type CaseUpdate = (recipe: (draft: AnesthesiaCase) => AnesthesiaCase | void) => void;

export interface CaseScreenProps {
  /** Inline nav-bar title (Swift `.navigationBarTitleDisplayMode(.inline)`); may use the case. */
  title: string | ((c: AnesthesiaCase) => string);
  /** Defaults to "‹ Encounter" (the Hub of the current case scope). */
  back?: (id: string) => BackLinkProps;
  /** The case form. Rendered inside the read-only scope (see `readOnlyContext.ts`). */
  children: (c: AnesthesiaCase, update: CaseUpdate) => ReactNode;
  /**
   * Content that is NOT case data and stays usable on a locked case (finalize, documents): it
   * is rendered after the form, outside the disabled fieldset, and handles its own permissions.
   */
  aside?: (c: AnesthesiaCase) => ReactNode;
}

/**
 * Shared scaffold for every case-scoped screen (the port of Swift's
 * `if let idx = store.index(of: caseID) { … } else { ContentUnavailableView("Case not found") }`):
 * loads the full aggregate, shows loading / not-found states, renders the form with the store's
 * copy as the editable draft, a sticky SaveBar (explicit Save, as the Swift toolbar), and saves
 * unsaved edits when the screen is left (Swift Hub `.onDisappear`).
 *
 * Lifecycle: the nav bar shows the case's status badge. A finalized case (or an outer read-only
 * scope, e.g. an admin's view) makes the whole form read-only through ONE mechanism: the
 * `ReadOnlyProvider` consumed by the shared controls, a disabled <fieldset> around the form for
 * anything else, the "Finalized — read-only" banner, and a disabled Save.
 */
export function CaseScreen({ title, back, children, aside }: CaseScreenProps) {
  const { id = '' } = useParams();
  const { data, status, error, meta, update, save, reload } = useCase(id);
  const outer = useReadOnlyState();
  const scope = useCaseScope();
  useSaveOnLeave(id);
  const backLink = back ? back(id) : { to: scope.paths.hub(id), label: 'Encounter' };

  if (status !== 'ready' || !data) {
    const t = typeof title === 'string' ? title : 'Encounter';
    // Same element tree root as the loaded state, so the Page is updated in place, not remounted.
    return (
      <ReadOnlyProvider value={outer}>
        <Page title={t} back={backLink} titleDisplay="inline">
          <Section>
            {status === 'error' ? (
              <EmptyState
                icon="warning"
                title="Case not found"
                description={error ?? undefined}
                action={
                  <button type="button" className="btn-plain" onClick={reload}>
                    Retry
                  </button>
                }
              />
            ) : (
              <div className="row state-row" role="status">
                <span className="spinner" aria-hidden="true" />
                <span>Loading…</span>
              </div>
            )}
          </Section>
        </Page>
      </ReadOnlyProvider>
    );
  }

  const readOnly: ReadOnlyState =
    data.status === 'finalized'
      ? { readOnly: true, reason: 'finalized' }
      : outer.readOnly
        ? outer
        : meta?.viewOnly
          ? { readOnly: true, reason: 'viewer' }
          : { readOnly: false, reason: null };

  return (
    <ReadOnlyProvider value={readOnly}>
      <Page
        title={typeof title === 'string' ? title : title(data)}
        back={backLink}
        titleDisplay="inline"
        trailing={<StatusBadge status={data.status} />}
        footer={<SaveBar meta={meta} onSave={() => void save()} />}
      >
        {meta?.notice ? (
          <div className="banner" role="alert">
            <Icon name="warning" size={18} />
            <span className="banner__text">{meta.notice}</span>
            <button type="button" className="btn-plain" onClick={() => caseStore.getState().clearNotice(id)}>
              Dismiss
            </button>
          </div>
        ) : null}
        <DraftConflictBanner id={id} />
        <ReadOnlyBanner />
        <fieldset className="readonly-scope" disabled={readOnly.readOnly}>
          {children(data, update)}
        </fieldset>
        {aside ? aside(data) : null}
      </Page>
    </ReadOnlyProvider>
  );
}

/**
 * A draft from the previous session that was NOT applied because the server copy changed (or
 * was finalized) since: the screen shows the server copy; the user re-applies or discards.
 */
function DraftConflictBanner({ id }: { id: string }) {
  const conflict = useCaseStore((s) => s.draftConflicts[id]);
  const outer = useReadOnlyState();
  if (!conflict || outer.readOnly) return null;
  const finalized = conflict.reason === 'finalized';
  return (
    <div className="banner banner--warning" role="alert">
      <Icon name="warning" size={18} />
      <span className="banner__text">
        {finalized
          ? 'You had unsaved changes to this case from your previous session, but it has been finalized since, so they can no longer be applied. The locked version is shown.'
          : 'You had unsaved changes to this case from your previous session, but it was changed on the server since (another device, tab or an admin). The current server version is shown. Re-applying replaces it with your earlier changes.'}
      </span>
      <span className="banner__actions">
        {finalized ? null : (
          <button type="button" className="btn-plain" onClick={() => caseStore.getState().reapplyDraft(id)}>
            Re-apply my changes
          </button>
        )}
        <button type="button" className="btn-plain" onClick={() => caseStore.getState().discardDraft(id)}>
          {finalized ? 'Dismiss' : 'Discard them'}
        </button>
      </span>
    </div>
  );
}
