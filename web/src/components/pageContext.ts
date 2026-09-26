import { createContext, useContext } from 'react';

/**
 * True inside a layout that already provides the page's `<main>` landmark (the admin shell):
 * a nested `Page` then renders its body as a plain `<div>`, so there is exactly one `main`.
 */
export const InsideMainContext = createContext(false);

export function useInsideMain(): boolean {
  return useContext(InsideMainContext);
}
