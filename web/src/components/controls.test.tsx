import { act, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CheckboxValueRow } from './CheckboxValueRow';
import { CheckRow, ChoiceChips, SegmentedControl, ToggleRow } from './Choice';
import { ConfirmDeleteButton } from './ConfirmDeleteButton';
import { NumberRow, StepperRow, TextRow } from './FormRows';
import { GridNumberCell } from './GridNumberCell';
import { AddRowButton, EditOnly, ReadOnlyBanner, ReadOnlyProvider } from './ReadOnly';
import { SaveBar } from './SaveBar';

function Stepper({ initial = 70 }: { initial?: number }) {
  const [v, setV] = useState(initial);
  return <StepperRow label="Peso" value={v} onChange={setV} unit="kg" step={1} min={0} max={80} />;
}

describe('StepperRow', () => {
  afterEach(() => vi.useRealTimers());

  it('steps on press and accelerates while held, clamped to range', () => {
    vi.useFakeTimers();
    render(<Stepper />);
    const plus = screen.getByRole('button', { name: 'Increase Peso' });
    const value = screen.getByLabelText('Peso');
    fireEvent.pointerDown(plus, { button: 0 });
    expect(value).toHaveValue('71');
    act(() => vi.advanceTimersByTime(300 + 150 * 3)); // hold threshold + 3 slow ticks
    expect(value).toHaveValue('74');
    act(() => vi.advanceTimersByTime(5000));
    expect(value).toHaveValue('80'); // clamped at max
    fireEvent.pointerUp(plus);
  });

  it('keyboard click steps once', () => {
    render(<Stepper />);
    fireEvent.click(screen.getByRole('button', { name: 'Decrease Peso' }), { detail: 0 });
    expect(screen.getByLabelText('Peso')).toHaveValue('69');
  });

  it('focus + blur without typing writes nothing, even for an out-of-range stored value', () => {
    const onChange = vi.fn();
    render(<StepperRow label="Dil" value={0.05} onChange={onChange} step={0.5} min={0.5} max={100} decimals={1} />);
    const input = screen.getByLabelText('Dil');
    fireEvent.focus(input);
    fireEvent.blur(input);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('typing a value commits it on blur', () => {
    render(<Stepper />);
    const input = screen.getByLabelText('Peso');
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '55' } });
    fireEvent.blur(input);
    expect(input).toHaveValue('55');
  });
});

function Num({ initial, max = 250, integer = false }: { initial: number | null; max?: number; integer?: boolean }) {
  const [v, setV] = useState<number | null>(initial);
  return (
    <>
      <NumberRow label="Peso" value={v} onChange={setV} unit="kg" min={0} max={max} integer={integer} />
      <output data-testid="committed">{v === null ? 'null' : String(v)}</output>
    </>
  );
}

describe('NumberRow', () => {
  it('commits valid numbers and null when cleared', () => {
    const onChange = vi.fn();
    render(<NumberRow label="Hb" value={null} onChange={onChange} unit="g/dl" min={0} max={25} />);
    const input = screen.getByLabelText('Hb');
    fireEvent.change(input, { target: { value: '12,5' } });
    expect(onChange).toHaveBeenLastCalledWith(12.5);
    fireEvent.change(input, { target: { value: '99' } });
    expect(input).toHaveAttribute('aria-invalid', 'true');
    fireEvent.change(input, { target: { value: '' } });
    expect(onChange).toHaveBeenLastCalledWith(null);
  });

  it('typing past max never leaves a stale prefix committed; blur makes display == stored', () => {
    render(<Num initial={null} />);
    const input = screen.getByLabelText('Peso');
    fireEvent.focus(input);
    for (const t of ['3', '30', '300']) fireEvent.change(input, { target: { value: t } });
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByTestId('committed')).toHaveTextContent('null'); // not 30
    fireEvent.blur(input);
    expect(input).toHaveValue('');
    expect(input).not.toHaveAttribute('aria-invalid');
    expect(screen.getByTestId('committed')).toHaveTextContent('null');
  });

  it('invalid edit of an existing value reverts to the pre-edit value', () => {
    render(<Num initial={100} />);
    const input = screen.getByLabelText('Peso');
    fireEvent.focus(input);
    for (const t of ['3', '30', '300']) fireEvent.change(input, { target: { value: t } });
    expect(screen.getByTestId('committed')).toHaveTextContent('100');
    fireEvent.blur(input);
    expect(input).toHaveValue('100');
    expect(screen.getByTestId('committed')).toHaveTextContent('100');
  });

  it('integer field: "1.5" does not commit 1', () => {
    render(<Num initial={null} integer max={10} />);
    const input = screen.getByLabelText('Peso');
    fireEvent.focus(input);
    for (const t of ['1', '1.', '1.5']) fireEvent.change(input, { target: { value: t } });
    expect(screen.getByTestId('committed')).toHaveTextContent('null');
    fireEvent.blur(input);
    expect(input).toHaveValue('');
    // A valid edit still commits and is kept on blur.
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '7' } });
    fireEvent.blur(input);
    expect(input).toHaveValue('7');
    expect(screen.getByTestId('committed')).toHaveTextContent('7');
  });
});

describe('read-only context (consumed by every shared control)', () => {
  it('disables inputs, chips, switches, steppers, grid cells; hides add/delete; locks the SaveBar', () => {
    const onChange = vi.fn();
    const all = (
      <>
        <ReadOnlyBanner />
        <TextRow label="Texto" value="a" onChange={onChange} />
        <TextRow label="Notas" value="b" onChange={onChange} multiline />
        <NumberRow label="Numero" value={1} onChange={onChange} />
        <StepperRow label="Paso" value={5} onChange={onChange} step={1} min={0} max={10} />
        <ChoiceChips title="Chips" options={['A', 'B']} selection={['A']} onChange={onChange} />
        <SegmentedControl label="Seg" options={['0', '1']} value="0" onChange={onChange} />
        <ToggleRow label="Switch" checked onChange={onChange} />
        <CheckRow label="Check" checked onChange={onChange} />
        <CheckboxValueRow label="CBV" unit="mg" checked onCheckedChange={onChange} value={2} onValueChange={onChange} />
        <GridNumberCell label="Celda" value={3} onChange={onChange} />
        <ConfirmDeleteButton label="Delete row" onDelete={onChange} />
        <AddRowButton label="Add row" onAdd={onChange} />
        <EditOnly>
          <button type="button">Migrate</button>
        </EditOnly>
        <SaveBar meta={undefined} onSave={onChange} />
      </>
    );
    const view = render(<ReadOnlyProvider value={{ readOnly: true, reason: 'viewer' }}>{all}</ReadOnlyProvider>);
    // No fieldset here: the context alone disables each control.
    for (const el of view.container.querySelectorAll<HTMLInputElement>('input, textarea, select')) {
      expect(el.disabled).toBe(true);
    }
    for (const name of ['A', 'B', 'Increase Paso', 'Decrease Paso']) {
      expect(screen.getByRole('button', { name })).toHaveProperty('disabled', true);
    }
    expect(screen.queryByRole('button', { name: /Delete row|Add row|Migrate/ })).toBeNull();
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    expect(screen.getByTestId('readonly-banner')).toHaveTextContent('Read-only view');
    fireEvent.click(screen.getByRole('button', { name: 'B' }));
    expect(onChange).not.toHaveBeenCalled();

    // The same tree outside the scope is editable.
    view.unmount();
    render(all);
    expect(screen.getByLabelText('Texto')).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Add row' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete row' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Migrate' })).toBeInTheDocument();
    expect(screen.queryByTestId('readonly-banner')).toBeNull();
  });
});
