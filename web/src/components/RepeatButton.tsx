import { Icon } from './Icon';
import { useReadOnly } from './readOnlyContext';
import { useAcceleratingRepeat } from './useAcceleratingRepeat';

/** ± button with hold-to-accelerate (port of Swift AcceleratingRepeatButton). */
export function RepeatButton({
  kind,
  label,
  onStep,
  disabled: disabledProp = false,
}: {
  kind: 'plus' | 'minus';
  /** Accessible name, e.g. "Increase Peso". */
  label: string;
  onStep: () => void;
  disabled?: boolean;
}) {
  const disabled = useReadOnly() || disabledProp;
  const handlers = useAcceleratingRepeat(onStep, disabled);
  return (
    <button type="button" className="repeat-button" aria-label={label} disabled={disabled} {...handlers}>
      <Icon name={kind} size={20} />
    </button>
  );
}
