import { useEffect, useRef, useState } from 'react';
import type { SetURLSearchParams } from 'react-router-dom';
import { withParam } from './paging';

export const SEARCH_DEBOUNCE_MS = 300;

/**
 * A text filter bound to one URL search param: typing updates the box at once and the URL after
 * a debounce (replace, so typing does not flood history); a URL change from elsewhere (Back /
 * Forward, a link) re-syncs the box. Writing the param resets `?page=`.
 */
export function useUrlText(
  sp: URLSearchParams,
  setSp: SetURLSearchParams,
  name: string,
  delay = SEARCH_DEBOUNCE_MS,
): [string, (v: string) => void] {
  const urlValue = sp.get(name) ?? '';
  const [text, setText] = useState(urlValue);
  const written = useRef(urlValue);

  // External URL change → the box follows.
  useEffect(() => {
    if (urlValue !== written.current) {
      written.current = urlValue;
      setText(urlValue);
    }
  }, [urlValue]);

  useEffect(() => {
    const target = text.trim() ? text : '';
    if (target === urlValue) return;
    const t = setTimeout(() => {
      written.current = target;
      setSp((prev) => withParam(prev, name, target), { replace: true });
    }, delay);
    return () => clearTimeout(t);
  }, [text, urlValue, name, delay, setSp]);

  return [text, setText];
}
