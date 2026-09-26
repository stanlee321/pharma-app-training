import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RestAuthApi } from '../api/authApi';
import { HttpClient } from '../api/http';
import { InMemoryBackend } from '../api/inMemoryBackend';
import { RestBackend } from '../api/restBackend';
import { startSessionTimer, useAuthStore } from '../state/authStore';
import { caseStore } from '../state/caseStore';
import { signInAs, signOutState, TEST_TOKEN } from '../test/auth';
import { ANES, fakeAuthServer } from '../test/fakeAuthServer';
import { FUTURE } from '../test/router';
import { AppRoutes } from './AppRoutes';

type Server = ReturnType<typeof fakeAuthServer>;

function renderAt(path: string) {
  const user = userEvent.setup();
  const view = render(
    <MemoryRouter initialEntries={[path]} future={FUTURE}>
      <AppRoutes />
    </MemoryRouter>,
  );
  return { user, view };
}

/** Sign in through the real store against the fake server (as the Login screen does). */
async function loginVia(server: Server, username: string, password: string) {
  vi.stubGlobal('fetch', server.fetch);
  signOutState(new RestAuthApi());
  caseStore.getState().reset();
  caseStore.getState().setBackend(new RestBackend());
  await useAuthStore.getState().login(username, password);
}

describe('auth flow (mocked fetch)', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('401 on any call → logout + redirect to /login with the "session expired" notice', async () => {
    const server = fakeAuthServer([ANES()]);
    await loginVia(server, 'dra.demo', 'Correct-Horse-1');
    server.revoke('tok-1'); // e.g. deactivated or password reset by an admin
    renderAt('/cases');
    expect(await screen.findByRole('heading', { name: 'TivaTrainer' })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Su sesión expiró');
    expect(useAuthStore.getState().token).toBeNull();
    expect(window.localStorage.getItem('auth_session_v1')).toBeNull();
  });

  it('403 "password change required" → redirect to /change-password', async () => {
    const server = fakeAuthServer([ANES()]);
    await loginVia(server, 'dra.demo', 'Correct-Horse-1');
    // The server now demands a change (e.g. an admin reset while this session was open).
    server.override('GET /patients', () =>
      new Response('{"detail":"password change required"}', { status: 403 }),
    );
    renderAt('/cases');
    expect(await screen.findByRole('heading', { name: 'Cambiar contraseña' })).toBeInTheDocument();
    expect(useAuthStore.getState().user?.must_change_password).toBe(true);
    expect(useAuthStore.getState().token).toBe('tok-1');
  });

  it('forced change: login with a temporary password → change → automatic re-login → /pacientes', async () => {
    const server = fakeAuthServer([{ ...ANES({ must_change_password: true }), password: 'Temporal-123' }]);
    vi.stubGlobal('fetch', server.fetch);
    signOutState(new RestAuthApi());
    caseStore.getState().reset();
    caseStore.getState().setBackend(new RestBackend());
    const { user } = renderAt('/login');

    await user.type(screen.getByLabelText('Usuario'), 'dra.demo');
    await user.type(screen.getByLabelText('Contraseña'), 'Temporal-123');
    await user.click(screen.getByRole('button', { name: 'Iniciar sesión' }));
    expect(await screen.findByRole('heading', { name: 'Cambiar contraseña' })).toBeInTheDocument();
    expect(screen.getByText(/Elija una contraseña nueva para continuar/)).toBeInTheDocument();

    // Guard: the clinical area is unreachable while the change is pending.
    expect(screen.queryByRole('button', { name: 'Cancelar' })).not.toBeInTheDocument();

    // The user's OWN new password is the one field the browser may offer to save.
    expect(screen.getByLabelText('Contraseña nueva')).toHaveAttribute('autocomplete', 'new-password');
    expect(screen.getByLabelText('Contraseña nueva')).not.toHaveAttribute('data-1p-ignore');
    await user.type(screen.getByLabelText('Contraseña temporal'), 'Temporal-123');
    await user.type(screen.getByLabelText('Contraseña nueva'), 'Definitiva-456');
    await user.type(screen.getByLabelText('Confirme la contraseña nueva'), 'Definitiva-456');
    await user.click(screen.getByRole('button', { name: 'Cambiar contraseña' }));

    expect(await screen.findByRole('heading', { name: 'Historias clínicas', level: 1 })).toBeInTheDocument();
    const change = server.calls.find((c) => c.path === '/auth/change-password')!;
    expect(change.authorization).toBe('Bearer tok-1');
    expect(change.body).toEqual({ current_password: 'Temporal-123', new_password: 'Definitiva-456' });
    const logins = server.calls.filter((c) => c.path === '/auth/login');
    expect(logins).toHaveLength(2);
    expect(logins[1]!.body).toEqual({ username: 'dra.demo', password: 'Definitiva-456' });
    const s = useAuthStore.getState();
    expect(s.token).toBe('tok-2');
    expect(s.user?.must_change_password).toBe(false);
    // Nothing after the change used the revoked token.
    const after = server.calls.slice(server.calls.indexOf(change) + 1).filter((c) => c.path !== '/auth/login');
    for (const c of after) expect(c.authorization).toBe('Bearer tok-2');
  });

  it('change password validates locally and shows a wrong-current-password 400 without signing out', async () => {
    const server = fakeAuthServer([ANES()]);
    await loginVia(server, 'dra.demo', 'Correct-Horse-1');
    const { user } = renderAt('/change-password');
    expect(await screen.findByText('Sesión iniciada como dra.demo.')).toBeInTheDocument();

    await user.type(screen.getByLabelText('Contraseña actual'), 'wrong-one');
    await user.type(screen.getByLabelText('Contraseña nueva'), 'short');
    await user.type(screen.getByLabelText('Confirme la contraseña nueva'), 'short');
    await user.click(screen.getByRole('button', { name: 'Cambiar contraseña' }));
    expect(screen.getByRole('alert')).toHaveTextContent('al menos 8 caracteres');
    expect(server.calls.some((c) => c.path === '/auth/change-password')).toBe(false);

    await user.clear(screen.getByLabelText('Contraseña nueva'));
    await user.type(screen.getByLabelText('Contraseña nueva'), 'Definitiva-456');
    await user.clear(screen.getByLabelText('Confirme la contraseña nueva'));
    await user.type(screen.getByLabelText('Confirme la contraseña nueva'), 'Definitiva-457');
    await user.click(screen.getByRole('button', { name: 'Cambiar contraseña' }));
    expect(screen.getByRole('alert')).toHaveTextContent('no coinciden');

    await user.clear(screen.getByLabelText('Confirme la contraseña nueva'));
    await user.type(screen.getByLabelText('Confirme la contraseña nueva'), 'Definitiva-456');
    await user.click(screen.getByRole('button', { name: 'Cambiar contraseña' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('La contraseña actual es incorrecta.');
    expect(useAuthStore.getState().token).toBe('tok-1');
  });

  it('voluntary change from the user menu, then back to the patient list', async () => {
    const server = fakeAuthServer([ANES()]);
    await loginVia(server, 'dra.demo', 'Correct-Horse-1');
    const { user } = renderAt('/cases');
    await user.click(await screen.findByRole('button', { name: 'Cuenta: Dra. Demo Sintetica' }));
    expect(screen.getByText(/dra\.demo · Anestesiólogo/)).toBeInTheDocument();
    await user.click(screen.getByRole('link', { name: 'Cambiar contraseña' }));

    await user.type(await screen.findByLabelText('Contraseña actual'), 'Correct-Horse-1');
    await user.type(screen.getByLabelText('Contraseña nueva'), 'Definitiva-456');
    await user.type(screen.getByLabelText('Confirme la contraseña nueva'), 'Definitiva-456');
    await user.click(screen.getByRole('button', { name: 'Cambiar contraseña' }));
    expect(await screen.findByRole('heading', { name: 'Historias clínicas', level: 1 })).toBeInTheDocument();
    expect(useAuthStore.getState().token).toBe('tok-2');
  });

  it('a failed automatic re-login signs out with a "password changed" notice', async () => {
    const server = fakeAuthServer([ANES()]);
    await loginVia(server, 'dra.demo', 'Correct-Horse-1');
    const { user } = renderAt('/change-password');
    server.override('POST /auth/login', () => new Response('boom', { status: 500 }));
    await user.type(await screen.findByLabelText('Contraseña actual'), 'Correct-Horse-1');
    await user.type(screen.getByLabelText('Contraseña nueva'), 'Definitiva-456');
    await user.type(screen.getByLabelText('Confirme la contraseña nueva'), 'Definitiva-456');
    await user.click(screen.getByRole('button', { name: 'Cambiar contraseña' }));
    expect(await screen.findByText(/Su contraseña se cambió/)).toBeInTheDocument();
    expect(useAuthStore.getState().token).toBeNull();
  });

  describe('role gates', () => {
    beforeEach(() => {
      caseStore.getState().reset();
      caseStore.getState().setBackend(new InMemoryBackend([]));
    });

    it('an anesthesiologist hitting /admin/** is sent to /pacientes', async () => {
      signInAs();
      renderAt('/admin/users');
      expect(await screen.findByRole('heading', { name: 'Historias clínicas', level: 1 })).toBeInTheDocument();
    });

    it('an admin hitting /cases/** is sent to /admin', async () => {
      signInAs({ role: 'admin', full_name: 'Admin Demo' });
      renderAt('/cases/aaaaaaaa-0000-4000-8000-000000000001/patient');
      expect(await screen.findByRole('heading', { name: 'Panel', level: 1 })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Cuenta: Admin Demo' })).toBeInTheDocument();
    });

    it('admin sub-routes render inside the shell', async () => {
      signInAs({ role: 'admin' });
      const { user } = renderAt('/admin');
      await user.click(screen.getByRole('link', { name: 'Usuarios' }));
      expect(screen.getByRole('heading', { name: 'Usuarios', level: 1 })).toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'Usuarios' })).toHaveAttribute('aria-current', 'page');
    });

    it('an unknown path goes to the role landing; signed out → /login', async () => {
      signInAs({ role: 'admin' });
      const a = renderAt('/nowhere');
      expect(await screen.findByRole('heading', { name: 'Panel', level: 1 })).toBeInTheDocument();
      a.view.unmount();
      signOutState();
      renderAt('/nowhere');
      expect(screen.getByRole('heading', { name: 'TivaTrainer' })).toBeInTheDocument();
    });

    it('a pending password change blocks every other route', () => {
      signInAs({ must_change_password: true });
      renderAt('/cases');
      expect(screen.getByRole('heading', { name: 'Cambiar contraseña' })).toBeInTheDocument();
    });
  });

  it('token expiry logs out with the "session expired" notice', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-25T10:00:00Z'));
    signInAs();
    useAuthStore.setState({ expiresAt: '2026-09-25T10:00:05Z' });
    startSessionTimer();
    vi.advanceTimersByTime(4_000);
    expect(useAuthStore.getState().token).toBe(TEST_TOKEN);
    vi.advanceTimersByTime(1_500);
    expect(useAuthStore.getState().token).toBeNull();
    expect(useAuthStore.getState().notice).toBe('expired');
  });

  it('an already-expired token is never sent: the request goes out unauthenticated and the session ends', async () => {
    const server = fakeAuthServer([ANES()]);
    signInAs();
    useAuthStore.setState({ expiresAt: '2000-01-01T00:00:00Z' });
    const http = new HttpClient({ baseUrl: () => '/api/v1', fetch: server.fetch });
    await expect(http.json('GET', ['cases'])).rejects.toMatchObject({ status: 401 });
    expect(server.calls[0]!.authorization).toBeNull();
    expect(useAuthStore.getState().token).toBeNull();
    expect(useAuthStore.getState().notice).toBe('expired');
  });

  it('a late 401 for a token that was already replaced does not log the new session out', async () => {
    const server = fakeAuthServer([ANES()]);
    signInAs();
    const stale = new HttpClient({ baseUrl: () => '/api/v1', token: () => 'tok-old', fetch: server.fetch });
    await expect(stale.json('GET', ['cases'])).rejects.toMatchObject({ status: 401 });
    expect(useAuthStore.getState().token).toBe(TEST_TOKEN);
  });

  it('signing out clears the local case copies', async () => {
    const server = fakeAuthServer([ANES(), ANES({ id: 'aaaaaaaa-0000-4000-8000-00000000a002', username: 'dr.otro' })]);
    await loginVia(server, 'dra.demo', 'Correct-Horse-1');
    caseStore.getState().createCase('x');
    await waitFor(() => expect(caseStore.getState().cases).toHaveLength(1));
    useAuthStore.getState().logout();
    expect(caseStore.getState().cases).toHaveLength(0);
  });
});
