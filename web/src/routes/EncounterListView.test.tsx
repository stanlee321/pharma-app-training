import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it } from 'vitest';
import { newCase } from '../api/factory';
import { demoCase, InMemoryBackend } from '../api/inMemoryBackend';
import { useAuthStore } from '../state/authStore';
import { signInAs } from '../test/auth';
import { caseStore } from '../state/caseStore';
import { AppRoutes } from './AppRoutes';
import { FUTURE } from '../test/router';

const renderAt = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]} future={FUTURE}>
      <AppRoutes />
    </MemoryRouter>,
  );

describe('EncounterListView', () => {
  beforeEach(() => {
    signInAs({ full_name: 'Dr. Demo' });
    caseStore.getState().reset();
  });

  it('shows the empty state', async () => {
    caseStore.getState().setBackend(new InMemoryBackend([]));
    renderAt('/cases');
    expect(await screen.findByText('No encounters yet')).toBeInTheDocument();
    expect(screen.getByText('Tap + to start a new anaesthesia record.')).toBeInTheDocument();
  });

  it('creates a case with + and opens the hub', async () => {
    caseStore.getState().setBackend(new InMemoryBackend([]));
    const user = userEvent.setup();
    renderAt('/cases');
    await screen.findByText('No encounters yet');
    await user.click(screen.getByRole('button', { name: 'New encounter' }));
    expect(caseStore.getState().cases).toHaveLength(1);
    expect(caseStore.getState().cases[0]!.owner).toBe('Dr. Demo');
    expect(await screen.findByRole('heading', { name: 'Untitled case', level: 1 })).toBeInTheDocument();
  });

  it('deletes a case after inline confirmation', async () => {
    caseStore.getState().setBackend(new InMemoryBackend());
    const user = userEvent.setup();
    renderAt('/cases');
    const title = await screen.findByText('Paciente Demo (sintético)');
    const row = title.closest('.encounter-row') as HTMLElement;
    await user.click(within(row).getByRole('button', { name: /Delete Paciente Demo/ }));
    await user.click(within(row).getByRole('button', { name: 'Delete' }));
    expect(await screen.findByText('No encounters yet')).toBeInTheDocument();
  });

  it('sign out returns to login', async () => {
    caseStore.getState().setBackend(new InMemoryBackend([]));
    const user = userEvent.setup();
    renderAt('/cases');
    await user.click(screen.getByRole('button', { name: 'Account: Dr. Demo' }));
    await user.click(screen.getByRole('button', { name: 'Sign Out' }));
    expect(useAuthStore.getState().user).toBeNull();
    expect(useAuthStore.getState().token).toBeNull();
    expect(screen.getByRole('heading', { name: 'TivaTrainer' })).toBeInTheDocument();
  });

  it('shows a Draft / Finalized badge per row; a finalized case has no delete', async () => {
    const draft = demoCase();
    const locked = newCase('Dr. Demo');
    locked.patient.nombre = 'Paciente Cerrado (sintético)';
    locked.status = 'finalized';
    caseStore.getState().setBackend(new InMemoryBackend([draft, locked]));
    renderAt('/cases');
    const draftRow = (await screen.findByText('Paciente Demo (sintético)')).closest('.encounter-row') as HTMLElement;
    const lockedRow = screen.getByText('Paciente Cerrado (sintético)').closest('.encounter-row') as HTMLElement;
    expect(within(draftRow).getByText('Draft')).toHaveClass('status-badge--draft');
    expect(within(lockedRow).getByText('Finalized')).toHaveClass('status-badge--finalized');
    expect(within(draftRow).getByRole('button', { name: /^Delete / })).toBeInTheDocument();
    expect(within(lockedRow).queryByRole('button', { name: /^Delete / })).toBeNull();
  });
});
