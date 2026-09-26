import { useCallback, useEffect, useRef, useState } from 'react';
import { errorMessage } from '../../api/backend';

export interface Query<T> {
  status: 'loading' | 'ready' | 'error';
  /** The last successful result (kept while reloading or after a failed reload). */
  data: T | undefined;
  error: string | null;
  reload(): void;
  /** Replace the data locally (after a mutation that returned the new value). */
  setData(data: T): void;
}

/**
 * Load `fetcher()` whenever `key` changes (or on `reload()`); a stale response for an older key
 * never overwrites a newer one. The previous data is kept while reloading ("refetch keeps the
 * frame").
 */
export function useQuery<T>(key: string, fetcher: () => Promise<T>): Query<T> {
  const [state, setState] = useState<{ status: Query<T>['status']; data: T | undefined; error: string | null }>({
    status: 'loading',
    data: undefined,
    error: null,
  });
  const [nonce, setNonce] = useState(0);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  useEffect(() => {
    let alive = true;
    setState((s) => ({ ...s, status: 'loading', error: null }));
    fetcherRef.current().then(
      (data) => {
        if (alive) setState({ status: 'ready', data, error: null });
      },
      (e: unknown) => {
        if (alive) setState((s) => ({ status: 'error', data: s.data, error: errorMessage(e) }));
      },
    );
    return () => {
      alive = false;
    };
  }, [key, nonce]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  const setData = useCallback((data: T) => setState({ status: 'ready', data, error: null }), []);
  return { ...state, reload, setData };
}
