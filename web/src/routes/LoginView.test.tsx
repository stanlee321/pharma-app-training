import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RestAuthApi } from '../api/authApi';
import { RestBackend } from '../api/restBackend';
import { useAuthStore } from '../state/authStore';
import { caseStore } from '../state/caseStore';
import { signOutState } from '../test/auth';
import { ADMIN, ANES, fakeAuthServer } from '../test/fakeAuthServer';
import { FUTURE } from '../test/router';
import { AppRoutes } from './AppRoutes';

function setup(server: ReturnType<typeof fakeAuthServer>, path = '/cases') {
  vi.stubGlobal('fetch', server.fetch);
  signOutState(new RestAuthApi());
  caseStore.getState().reset();
  caseStore.getState().setBackend(new RestBackend());
  const user = userEvent.setup();
  render(
    <MemoryRouter initialEntries={[path]} future={FUTURE}>
      <AppRoutes />
    </MemoryRouter>,
  );
  return user;
}

async function signIn(user: ReturnType<typeof userEvent.setup>, username: string, password: string) {
  await user.type(screen.getByLabelText('Usuario'), username);
  await user.type(screen.getByLabelText('Contraseña'), password);
  await user.click(screen.getByRole('button', { name: 'Iniciar sesión' }));
}

describe('LoginView (real auth, mocked fetch)', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders username + password + a collapsed Advanced server field; no role picker', () => {
    setup(fakeAuthServer([ANES()]));
    expect(screen.getByRole('heading', { name: 'TivaTrainer' })).toBeInTheDocument();
    expect(screen.getByLabelText('Usuario')).toHaveAttribute('autocomplete', 'username');
    expect(screen.getByLabelText('Contraseña')).toHaveAttribute('type', 'password');
    expect(screen.queryAllByRole('radio')).toHaveLength(0);
    const server = screen.getByLabelText('Servidor');
    expect(server).toHaveValue('/api/v1');
    expect(server.closest('details')).not.toHaveAttribute('open');
  });

  it('signs an anesthesiologist in, persists the session and sends the Bearer token', async () => {
    const server = fakeAuthServer([ANES()]);
    const user = setup(server);
    await signIn(user, 'Dra.Demo', 'Correct-Horse-1');

    expect(await screen.findByRole('heading', { name: 'Historias clínicas', level: 1 })).toBeInTheDocument();
    const s = useAuthStore.getState();
    expect(s.user?.username).toBe('dra.demo');
    expect(s.token).toBe('tok-1');
    const stored = JSON.parse(window.localStorage.getItem('auth_session_v1')!);
    expect(stored).toMatchObject({ token: 'tok-1', user: { role: 'anesthesiologist' } });
    expect(window.localStorage.getItem('backend_base_url')).toBe('/api/v1');
    expect(window.localStorage.getItem('mock_user_id_v1')).toBeNull();

    // Login itself is unauthenticated; every later call carries the Bearer token.
    await waitFor(() => expect(server.calls.some((c) => c.path === '/patients')).toBe(true));
    const [login, ...rest] = server.calls;
    expect(login).toMatchObject({ method: 'POST', path: '/auth/login', authorization: null });
    expect(login!.body).toEqual({ username: 'Dra.Demo', password: 'Correct-Horse-1' });
    expect(rest.length).toBeGreaterThan(0);
    for (const c of rest) expect(c.authorization).toBe('Bearer tok-1');
  });

  it('an admin lands on /admin (the role comes from the account)', async () => {
    const user = setup(fakeAuthServer([ANES(), ADMIN()]));
    await signIn(user, 'admin.demo', 'Admin-Secret-1');
    expect(await screen.findByRole('heading', { name: 'Panel', level: 1 })).toBeInTheDocument();
    const nav = screen.getByRole('navigation', { name: 'Administración' });
    for (const label of ['Panel', 'Casos', 'Usuarios', 'Documentos']) {
      expect(nav).toContainElement(screen.getByRole('link', { name: label }));
    }
  });

  it('shows the server ErrorDTO detail on a wrong password and stays signed out', async () => {
    const user = setup(fakeAuthServer([ANES()]));
    await signIn(user, 'dra.demo', 'nope-nope');
    expect(await screen.findByRole('alert')).toHaveTextContent('Usuario o contraseña incorrectos.');
    expect(useAuthStore.getState().token).toBeNull();
    expect(screen.getByLabelText('Contraseña')).toHaveValue('nope-nope');
  });

  it('an inactive account gets the same 401 message', async () => {
    const user = setup(fakeAuthServer([ANES({ is_active: false })]));
    await signIn(user, 'dra.demo', 'Correct-Horse-1');
    expect(await screen.findByRole('alert')).toHaveTextContent('Usuario o contraseña incorrectos.');
    expect(useAuthStore.getState().user).toBeNull();
  });

  it('explains an unreachable server', async () => {
    const server = fakeAuthServer([ANES()]);
    server.override('POST /auth/login', () => {
      throw new TypeError('Failed to fetch');
    });
    const user = setup(server);
    await signIn(user, 'dra.demo', 'Correct-Horse-1');
    expect(await screen.findByRole('alert')).toHaveTextContent(/No se pudo conectar con el servidor/);
  });

  it('requires both fields before calling the server', async () => {
    const server = fakeAuthServer([ANES()]);
    const user = setup(server);
    await user.click(screen.getByRole('button', { name: 'Iniciar sesión' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Escriba su usuario y contraseña.');
    expect(server.calls).toHaveLength(0);
  });

  it('the Advanced server value is used for the login call and persisted', async () => {
    const server = fakeAuthServer([ANES()]);
    const user = setup(server);
    await user.click(screen.getByText('Opciones avanzadas'));
    const field = screen.getByLabelText('Servidor');
    await user.clear(field);
    await user.type(field, 'http://10.0.0.5:8000/api/v1');
    await signIn(user, 'dra.demo', 'Correct-Horse-1');
    await screen.findByRole('heading', { name: 'Historias clínicas', level: 1 });
    expect(window.localStorage.getItem('backend_base_url')).toBe('http://10.0.0.5:8000/api/v1');
    expect(String(server.fetch.mock.calls[0]![0])).toBe('http://10.0.0.5:8000/api/v1/auth/login');
  });

  it('a failed login against a new Server value is not saved (only a successful one is)', async () => {
    const server = fakeAuthServer([ANES()]);
    const user = setup(server);
    await user.click(screen.getByText('Opciones avanzadas'));
    const field = screen.getByLabelText('Servidor');
    await user.clear(field);
    await user.type(field, 'http://10.9.9.9:8000/api/v1');
    await signIn(user, 'dra.demo', 'wrong-password');
    expect(await screen.findByRole('alert')).toHaveTextContent('Usuario o contraseña incorrectos.');
    // Tried against the candidate, but never persisted: later requests keep the saved base.
    expect(String(server.fetch.mock.calls[0]![0])).toBe('http://10.9.9.9:8000/api/v1/auth/login');
    expect(window.localStorage.getItem('backend_base_url')).toBeNull();
    expect(useAuthStore.getState().serverUrl).toBe('/api/v1');

    await user.clear(screen.getByLabelText('Contraseña'));
    await user.type(screen.getByLabelText('Contraseña'), 'Correct-Horse-1');
    await user.click(screen.getByRole('button', { name: 'Iniciar sesión' }));
    await screen.findByRole('heading', { name: 'Historias clínicas', level: 1 });
    expect(window.localStorage.getItem('backend_base_url')).toBe('http://10.9.9.9:8000/api/v1');
  });

  it('the remembered page keeps its query string (e.g. the admin case filters)', async () => {
    const user = setup(fakeAuthServer([ANES(), ADMIN()]), '/admin/cases?status=draft&q=sint');
    expect(screen.getByRole('heading', { name: 'TivaTrainer' })).toBeInTheDocument();
    await signIn(user, 'admin.demo', 'Admin-Secret-1');
    expect(await screen.findByRole('heading', { name: 'Casos', level: 1 })).toBeInTheDocument();
    expect(screen.getByLabelText('Estado')).toHaveValue('draft');
    expect(screen.getByLabelText('Buscar')).toHaveValue('sint');
  });

  it('a remembered page of the other role is ignored, query or not', async () => {
    const user = setup(fakeAuthServer([ANES()]), '/admin/cases?status=draft');
    await signIn(user, 'dra.demo', 'Correct-Horse-1');
    expect(await screen.findByRole('heading', { name: 'Historias clínicas', level: 1 })).toBeInTheDocument();
  });

  it('shows the "session expired" notice', () => {
    setup(fakeAuthServer([ANES()]));
    useAuthStore.setState({ notice: 'expired' });
    return waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Su sesión expiró'));
  });

  it('returns to the remembered page after signing in', async () => {
    const user = setup(fakeAuthServer([ANES()]), '/cases/aaaaaaaa-0000-4000-8000-000000000123/patient');
    expect(screen.getByRole('heading', { name: 'TivaTrainer' })).toBeInTheDocument();
    await signIn(user, 'dra.demo', 'Correct-Horse-1');
    // The fake server has no such case → the case screen shows its not-found state.
    expect(await screen.findByText('Caso no encontrado')).toBeInTheDocument();
  });
});
