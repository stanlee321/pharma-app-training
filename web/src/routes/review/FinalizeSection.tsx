import { useEffect, useRef, useState } from 'react';
import type { AnesthesiaCase } from '../../api/types';
import { Icon } from '../../components/Icon';
import { Section } from '../../components/Section';
import { formatDateTime } from '../../lib/datetime';
import { caseStore } from '../../state/caseStore';
import { finalizeErrorMessage } from '../../state/review';

/**
 * Finalize (owner, draft only): an in-page confirmation step (never window.confirm), then
 * `caseStore.finalize` (save pending edits → POST /cases/{id}/finalize). On success the case turns
 * read-only everywhere and `onFinalized` lets the page show the 4 stored documents.
 */
export function FinalizeSection({ c, onFinalized }: { c: AnesthesiaCase; onFinalized: () => void }) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  if (c.status === 'finalized') {
    return (
      <Section header="Case status">
        <div className="row review-row">
          <span className="row__label">
            <Icon name="lock" size={14} /> Finalized
          </span>
          <span className="review-row__value">{formatDateTime(c.finalized_at)}</span>
        </div>
      </Section>
    );
  }

  const finalize = async () => {
    setBusy(true);
    setError(null);
    try {
      await caseStore.getState().finalize(c.id);
      if (!mounted.current) return;
      setConfirming(false);
      onFinalized();
    } catch (e) {
      if (mounted.current) setError(finalizeErrorMessage(e));
    } finally {
      if (mounted.current) setBusy(false);
    }
  };

  return (
    <Section
      header="Finalize"
      footer="Finalizing locks the case: every section becomes read-only and the four filled forms are stored with it. Only an admin can reopen it."
    >
      {confirming ? (
        <div className="finalize-confirm" role="group" aria-label="Confirm finalize">
          <p className="finalize-confirm__text">
            Finalize this case? Unsaved changes are saved first. After this the case can no longer be edited.
          </p>
          <div className="finalize-confirm__actions">
            <button
              type="button"
              className="btn-primary btn-primary--compact"
              onClick={() => void finalize()}
              disabled={busy}
              aria-busy={busy}
            >
              {busy ? 'Finalizing…' : 'Finalize and lock'}
            </button>
            <button type="button" className="btn-plain" onClick={() => setConfirming(false)} disabled={busy}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="row">
          <button
            type="button"
            className="btn-primary review-export"
            onClick={() => {
              setError(null);
              setConfirming(true);
            }}
          >
            <Icon name="lock" size={18} />
            <span>Finalize case…</span>
          </button>
        </div>
      )}
      {error ? (
        <div className="row review-error" role="alert">
          <Icon name="warning" size={16} />
          <span className="review-error__text">{error}</span>
        </div>
      ) : null}
    </Section>
  );
}
