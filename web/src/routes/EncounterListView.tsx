import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { caseSubtitle, caseTitle } from '../api/factory';
import type { AnesthesiaCase } from '../api/types';
import { EmptyState } from '../components/EmptyState';
import { Icon } from '../components/Icon';
import { Page } from '../components/Page';
import { Section } from '../components/Section';
import { StatusBadge } from '../components/StatusBadge';
import { displayName, useAuthStore } from '../state/authStore';
import { caseStore, useCaseStore, type DraftRestoreReport } from '../state/caseStore';
import { paths } from './paths';
import { UserMenu } from './UserMenu';
import './encounters.css';

/** N1 — the app spine root: lists AnesthesiaCases and creates new ones (Swift EncounterListView). */
export function EncounterListView() {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const cases = useCaseStore((s) => s.cases);
  const listStatus = useCaseStore((s) => s.listStatus);
  const listError = useCaseStore((s) => s.listError);
  const restored = useAuthStore((s) => s.restoredDrafts);

  useEffect(() => {
    void caseStore.getState().refresh();
  }, []);

  const onNew = () => {
    const c = caseStore.getState().createCase(user ? displayName(user) : '');
    navigate(paths.hub(c.id));
  };

  const loadingFirst = cases.length === 0 && (listStatus === 'loading' || listStatus === 'idle');

  return (
    <Page
      title="Encounters"
      leading={<UserMenu />}
      trailing={
        <button type="button" className="toolbar-round" onClick={onNew} aria-label="New encounter">
          <Icon name="plus" size={22} />
        </button>
      }
    >
      {listError ? (
        <div className="banner" role="alert">
          <Icon name="warning" size={18} />
          <span className="banner__text">{listError}</span>
          <button type="button" className="btn-plain" onClick={() => void caseStore.getState().refresh()}>
            Retry
          </button>
        </div>
      ) : null}

      {restored ? <RestoredDraftsBanner report={restored} /> : null}

      <Section header="Encounters">
        {loadingFirst ? (
          <div className="row" role="status">
            <span className="spinner" aria-hidden="true" />
            <span className="row__label">Loading…</span>
          </div>
        ) : cases.length === 0 ? (
          <EmptyState
            icon="tray"
            title="No encounters yet"
            description="Tap + to start a new anaesthesia record."
          />
        ) : (
          cases.map((c) => <EncounterRow key={c.id} c={c} />)
        )}
      </Section>
    </Page>
  );
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** What happened to the previous session's unsaved changes at this sign-in. */
function RestoredDraftsBanner({ report }: { report: DraftRestoreReport }) {
  const lines: string[] = [];
  if (report.saved > 0) {
    lines.push(`Restored unsaved changes to ${plural(report.saved, 'encounter')} from your previous session.`);
  }
  if (report.conflicts.length > 0) {
    lines.push(
      `Not applied — changed on the server since your previous session: ${report.conflicts.join(', ')}. Open the encounter to re-apply or discard your earlier changes.`,
    );
  }
  if (report.deleted.length > 0) {
    lines.push(`Not restored — deleted on the server: ${report.deleted.join(', ')}.`);
  }
  if (report.unsaved.length > 0) {
    lines.push(`Restored but not saved yet: ${report.unsaved.join(', ')}. Open the encounter and save again.`);
  }
  if (report.kept.length > 0) {
    lines.push(
      `${plural(report.kept.length, 'draft')} could not be checked (server unreachable); they will be offered again at your next sign-in.`,
    );
  }
  return (
    <div className="banner banner--info" role="status">
      <Icon name="checkCircle" size={18} />
      <span className="banner__text">
        {lines.map((l) => (
          <span key={l} className="banner__line">
            {l}
          </span>
        ))}
      </span>
      <button type="button" className="btn-plain" onClick={() => useAuthStore.getState().clearRestoredDrafts()}>
        OK
      </button>
    </div>
  );
}

/**
 * One case row: title/subtitle + status badge → hub; trailing delete with inline confirmation
 * (swipe-to-delete). A finalized case is locked (the server answers 409), so it has no delete.
 */
function EncounterRow({ c }: { c: AnesthesiaCase }) {
  const [confirming, setConfirming] = useState(false);
  const title = caseTitle(c);
  return (
    <div className="encounter-row">
      <Link to={paths.hub(c.id)} className="encounter-row__link">
        <span className="encounter-row__text">
          <span className="encounter-row__title-line">
            <span className="encounter-row__title">{title}</span>
            <StatusBadge status={c.status} />
          </span>
          <span className="encounter-row__subtitle">{caseSubtitle(c)}</span>
        </span>
        <Icon name="chevronRight" size={16} className="encounter-row__chevron" />
      </Link>
      {c.status === 'finalized' ? (
        <span className="encounter-row__locked" aria-hidden="true">
          <Icon name="lock" size={16} />
        </span>
      ) : confirming ? (
        <span className="encounter-row__confirm">
          <button type="button" className="btn-destructive" onClick={() => void caseStore.getState().delete(c.id)}>
            Delete
          </button>
          <button type="button" className="btn-plain" onClick={() => setConfirming(false)}>
            Cancel
          </button>
        </span>
      ) : (
        <button
          type="button"
          className="encounter-row__delete"
          aria-label={`Delete ${title}`}
          onClick={() => setConfirming(true)}
        >
          <Icon name="trash" size={18} />
        </button>
      )}
    </div>
  );
}
