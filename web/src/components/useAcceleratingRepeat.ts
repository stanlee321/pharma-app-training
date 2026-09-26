import { useCallback, useEffect, useRef } from 'react';

/** Hold-to-accelerate schedule from Swift AcceleratingRepeatButton: after a 300 ms hold,
 *  5 ticks every 150 ms, then 10 every 80 ms, then every 50 ms until release. */
export const REPEAT_SCHEDULE = { holdMs: 300, slow: [5, 150], medium: [10, 80], fastMs: 50 } as const;

/**
 * Pointer handlers for a ± button that fires once on press and keeps firing, accelerating,
 * while held. Keyboard activation (Enter/Space → click with detail 0) fires a single step.
 */
export function useAcceleratingRepeat(onStep: () => void, disabled = false) {
  const stepRef = useRef(onStep);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    stepRef.current = onStep;
  }, [onStep]);

  const stop = useCallback(() => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
  }, []);

  useEffect(() => stop, [stop]);
  // A button that becomes disabled mid-hold (limit reached) never gets pointerup: stop here.
  useEffect(() => {
    if (disabled) stop();
  }, [disabled, stop]);

  const start = useCallback(() => {
    stop();
    let n = 0;
    const schedule = (delay: number) => {
      timer.current = setTimeout(() => {
        stepRef.current();
        n += 1;
        const [slowN, slowMs] = REPEAT_SCHEDULE.slow;
        const [medN, medMs] = REPEAT_SCHEDULE.medium;
        schedule(n < slowN ? slowMs : n < slowN + medN ? medMs : REPEAT_SCHEDULE.fastMs);
      }, delay);
    };
    // First accelerated tick lands one "slow" interval after the hold threshold.
    timer.current = setTimeout(() => schedule(REPEAT_SCHEDULE.slow[1]), REPEAT_SCHEDULE.holdMs);
  }, [stop]);

  return {
    onPointerDown: (e: React.PointerEvent<HTMLButtonElement>) => {
      if (disabled || e.button !== 0) return;
      e.preventDefault(); // keep focus/selection stable on touch
      stepRef.current();
      start();
    },
    onPointerUp: stop,
    onPointerLeave: stop,
    onPointerCancel: stop,
    onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
    onClick: (e: React.MouseEvent<HTMLButtonElement>) => {
      // Pointer presses are handled on pointerdown; only keyboard clicks (detail 0) step here.
      if (!disabled && e.detail === 0) stepRef.current();
    },
  };
}
