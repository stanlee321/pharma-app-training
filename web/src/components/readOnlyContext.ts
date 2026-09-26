import { createContext, useContext } from 'react';

/**
 * THE read-only mechanism for case content. `CaseScreen` provides it (true for a finalized case,
 * or when an outer scope, e.g. an admin's case view, is read-only), and every shared form control
 * in `components/` consumes it: inputs, selects, switches, chips and steppers become disabled;
 * add/delete affordances (`ConfirmDeleteButton`, `AddRowButton`, `EditOnly`) disappear; the SaveBar
 * shows the lock instead of Save. Section screens never branch on it themselves. As defence in
 * depth, `CaseScreen` also wraps the form in a disabled <fieldset> (catching any raw control) and
 * the case store refuses edits and saves of a finalized case.
 */
export interface ReadOnlyState {
  readOnly: boolean;
  /**
   * Why (shown in the banner): the case is finalized, the viewer may only read (admin view), or
   * the case belongs to another anesthesiologist (`foreign`).
   */
  reason: 'finalized' | 'viewer' | 'foreign' | null;
}

export const EDITABLE: ReadOnlyState = { readOnly: false, reason: null };

export const ReadOnlyContext = createContext<ReadOnlyState>(EDITABLE);

/** Full read-only state (flag + reason). */
export function useReadOnlyState(): ReadOnlyState {
  return useContext(ReadOnlyContext);
}

/** True when the surrounding case content must not be edited. */
export function useReadOnly(): boolean {
  return useContext(ReadOnlyContext).readOnly;
}
