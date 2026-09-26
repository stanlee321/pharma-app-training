import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeUser } from '../../api/authApi';
import type { UserDTO } from '../../api/types';
import { useAuthStore } from '../../state/authStore';
import { caseStore } from '../../state/caseStore';
import { signInAs } from '../../test/auth';
import { fakeAdminServer, ME_ADMIN } from '../../test/fakeAdminServer';
import { FUTURE } from '../../test/router';
import { AppRoutes } from '../AppRoutes';

/** Synthetic accounts (no real people). */
const ANA = fakeUser({
  id: 'cccccccc-0000-4000-8000-000000000001',
  username: 'wf-ana',
  full_name: 'Dra. Ana Sintetica',
  clave: 'SIN-01',
});
const BETO = fakeUser({
  id: 'cccccccc-0000-4000-8000-000000000002',
  username: 'wf-beto',
  full_name: 'Dr. Beto Prueba',
  clave: 'PRU-02',
  is_active: false,
});

type Server = ReturnType<typeof fakeAdminServer>;

function setup(server: Server, path: string, me: UserDTO = ME_ADMIN()) {
  vi.stubGlobal('fetch', server.fetch);
  caseStore.getState().reset();
  signInAs(me);
  const user = userEvent.setup();
  const view = render(
    <MemoryRouter initialEntries={[path]} future={FUTURE}>
      <AppRoutes />
    </MemoryRouter>,
  );
  return { user, view };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('Users list', () => {
  it('lists accounts with role / status badges, each linking to the account', async () => {
    const server = fakeAdminServer({ me: ME_ADMIN(), users: [ANA, BETO] });
    setup(server, '/admin/users');
    expect(await screen.findByRole('link', { name: 'Dra. Ana Sintetica' })).toHaveAttribute(
      'href',
      `/admin/users/${ANA.id}`,
    );
    const beto = screen.getByRole('link', { name: 'Dr. Beto Prueba' }).closest('tr')!;
    expect(within(beto).getByText('Inactiva')).toBeInTheDocument();
    expect(within(beto).getByText('Anestesiólogo')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '3 cuentas' })).toBeInTheDocument();
  });

  it('search (debounced), role and status filters go to the server as query params', async () => {
    const server = fakeAdminServer({ me: ME_ADMIN(), users: [ANA, BETO] });
    const { user } = setup(server, '/admin/users');
    await screen.findByRole('link', { name: 'Dra. Ana Sintetica' });

    await user.type(screen.getByLabelText('Buscar'), 'sin-01');
    await waitFor(() => expect(server.calls.at(-1)?.query).toEqual({ q: 'sin-01' }));
    expect(server.callsTo('GET', '/admin/users').filter((c) => c.query.q?.startsWith('s')).length).toBeLessThanOrEqual(
      2,
    );
    expect(await screen.findByRole('heading', { name: '1 cuenta (filtrado)' })).toBeInTheDocument();

    await user.clear(screen.getByLabelText('Buscar'));
    await user.selectOptions(screen.getByLabelText('Rol'), 'admin');
    await waitFor(() => expect(server.calls.at(-1)?.query).toEqual({ role: 'admin' }));
    expect(await screen.findByRole('link', { name: 'Admin Demo' })).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText('Rol'), '');
    await user.selectOptions(screen.getByLabelText('Estado'), 'false');
    await waitFor(() => expect(server.calls.at(-1)?.query).toEqual({ is_active: 'false' }));
    expect(await screen.findByRole('link', { name: 'Dr. Beto Prueba' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Dra. Ana Sintetica' })).toBeNull();
  });

  it('empty result and load error states (with Retry)', async () => {
    const server = fakeAdminServer({ me: ME_ADMIN() });
    server.override('GET /admin/users', () => json({ detail: 'database unavailable' }, 503));
    const { user } = setup(server, '/admin/users?q=nobody');
    expect(await screen.findByText('No se pudieron cargar los usuarios')).toBeInTheDocument();
    expect(screen.getByText(/database unavailable/)).toBeInTheDocument();
    server.clearOverride('GET /admin/users');
    await user.click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(await screen.findByText('Ninguna cuenta coincide')).toBeInTheDocument();
  });
});

describe('Create user', () => {
  it('validates locally (username rules, password length) without calling the server', async () => {
    const server = fakeAdminServer({ me: ME_ADMIN() });
    const { user } = setup(server, '/admin/users/new');
    await user.click(await screen.findByRole('button', { name: 'Crear cuenta' }));
    expect(screen.getByLabelText('Usuario')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByText('Escriba un nombre de usuario.')).toBeInTheDocument();
    expect(screen.getByText('Al menos 8 caracteres.')).toBeInTheDocument();

    await user.type(screen.getByLabelText('Usuario'), '.bad name');
    await user.click(screen.getByRole('button', { name: 'Crear cuenta' }));
    // The rule now shows as the field's error (role=alert), not only as helper text.
    const usernameNote = document.getElementById(screen.getByLabelText('Usuario').getAttribute('aria-describedby')!)!;
    expect(usernameNote).toHaveAttribute('role', 'alert');
    expect(usernameNote).toHaveTextContent('Solo letras, dígitos y . _ @ -; debe empezar con una letra o un dígito.');
    expect(server.callsTo('POST', '/admin/users')).toHaveLength(0);
  });

  it('the new account’s username and password are kept away from the browser / password managers', async () => {
    const server = fakeAdminServer({ me: ME_ADMIN() });
    setup(server, '/admin/users/new');
    for (const label of ['Usuario', 'Contraseña']) {
      const field = await screen.findByLabelText(label);
      expect(field).toHaveAttribute('autocomplete', 'off');
      expect(field).toHaveAttribute('data-1p-ignore');
      expect(field).toHaveAttribute('data-lpignore', 'true');
    }
    // Other rows are untouched (the attributes are only for credential-like fields).
    expect(screen.getByLabelText('Nombre completo')).not.toHaveAttribute('data-1p-ignore');
  });

  it('shows the server’s reserved "gw-" prefix error (422) on the username field', async () => {
    const server = fakeAdminServer({ me: ME_ADMIN() });
    const { user } = setup(server, '/admin/users/new');
    await user.type(await screen.findByLabelText('Usuario'), 'GW-legacy');
    await user.type(screen.getByLabelText('Contraseña'), 'Temporal-123');
    await user.click(screen.getByRole('button', { name: 'Crear cuenta' }));
    expect(await screen.findByText('Los nombres de usuario que empiezan con «gw-» están reservados.')).toBeInTheDocument();
    expect(screen.getByLabelText('Usuario')).toHaveAttribute('aria-invalid', 'true');
    expect(server.callsTo('POST', '/admin/users')).toHaveLength(1);
    expect(server.users.size).toBe(1);
  });

  it('a taken username (409) is shown on the field', async () => {
    const server = fakeAdminServer({ me: ME_ADMIN(), users: [ANA] });
    const { user } = setup(server, '/admin/users/new');
    await user.type(await screen.findByLabelText('Usuario'), 'WF-Ana');
    await user.type(screen.getByLabelText('Contraseña'), 'Temporal-123');
    await user.click(screen.getByRole('button', { name: 'Crear cuenta' }));
    expect(await screen.findByText('Ese nombre de usuario ya está en uso.')).toBeInTheDocument();
  });

  it('creates with a generated password and shows it ONCE', async () => {
    const server = fakeAdminServer({ me: ME_ADMIN() });
    const { user } = setup(server, '/admin/users/new');
    await user.type(await screen.findByLabelText('Usuario'), 'wf-nueva');
    await user.type(screen.getByLabelText('Nombre completo'), 'Dra. Nueva Sintetica');
    await user.type(screen.getByLabelText('Clave'), 'NUE-03');
    await user.click(screen.getByRole('radio', { name: 'Administrador' }));
    const pwField = screen.getByLabelText('Contraseña');
    expect(pwField).toHaveAttribute('type', 'password');
    await user.click(screen.getByRole('button', { name: 'Generar una contraseña' }));
    const generated = (pwField as HTMLInputElement).value;
    expect(generated).toMatch(/^[A-Za-z2-9]{4}-[A-Za-z2-9]{4}-[A-Za-z2-9]{4}$/);
    expect(pwField).toHaveAttribute('type', 'text'); // revealed after generating
    await user.click(screen.getByRole('button', { name: 'Crear cuenta' }));

    expect(await screen.findByRole('heading', { name: 'Cuenta creada' })).toBeInTheDocument();
    expect(server.callsTo('POST', '/admin/users')[0]!.body).toEqual({
      username: 'wf-nueva',
      full_name: 'Dra. Nueva Sintetica',
      clave: 'NUE-03',
      role: 'admin',
      password: generated,
    });
    expect(screen.getByLabelText('Contraseña temporal')).toHaveValue(generated);
    expect(screen.getByText(/Solo se muestra una vez/)).toBeInTheDocument();
    // Never persisted anywhere the browser keeps.
    for (let i = 0; i < window.localStorage.length; i++) {
      expect(window.localStorage.getItem(window.localStorage.key(i)!)).not.toContain(generated);
    }
    expect(window.location.href).not.toContain(generated);

    // Done → the list; coming back to "Nuevo usuario" shows an empty form, not the password.
    await user.click(screen.getByRole('button', { name: 'Listo' }));
    expect(await screen.findByRole('heading', { name: 'Usuarios', level: 1 })).toBeInTheDocument();
    expect(screen.queryByText(generated)).toBeNull();
    await user.click(screen.getByRole('link', { name: 'Nuevo usuario' }));
    expect(await screen.findByLabelText('Contraseña')).toHaveValue('');
    expect(screen.queryByDisplayValue(generated)).toBeNull();
  });

  it('"Crear otra" clears the secret and the form', async () => {
    const server = fakeAdminServer({ me: ME_ADMIN() });
    const { user } = setup(server, '/admin/users/new');
    await user.type(await screen.findByLabelText('Usuario'), 'wf-otra');
    await user.type(screen.getByLabelText('Contraseña'), 'Temporal-123');
    await user.click(screen.getByRole('button', { name: 'Crear cuenta' }));
    await screen.findByRole('heading', { name: 'Cuenta creada' });
    await user.click(screen.getByRole('button', { name: 'Crear otra' }));
    expect(screen.queryByDisplayValue('Temporal-123')).toBeNull();
    expect(screen.getByLabelText('Usuario')).toHaveValue('');
  });
});

describe('Edit, reset, delete', () => {
  it('edit sends only the changed keys', async () => {
    const server = fakeAdminServer({ me: ME_ADMIN(), users: [ANA] });
    const { user } = setup(server, `/admin/users/${ANA.id}`);
    const name = await screen.findByLabelText('Nombre completo');
    expect(screen.getByRole('button', { name: 'Guardar cambios' })).toBeDisabled();
    await user.clear(name);
    await user.type(name, 'Dra. Ana Editada');
    await user.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    expect(await screen.findByText('Cambios guardados.')).toBeInTheDocument();
    expect(server.callsTo('PATCH', `/admin/users/${ANA.id}`)[0]!.body).toEqual({ full_name: 'Dra. Ana Editada' });
    expect(screen.getByRole('heading', { name: 'Dra. Ana Editada', level: 1 })).toBeInTheDocument();
  });

  it('deactivate via the Active switch; the badge follows', async () => {
    const server = fakeAdminServer({ me: ME_ADMIN(), users: [ANA] });
    const { user } = setup(server, `/admin/users/${ANA.id}`);
    await user.click(await screen.findByRole('switch', { name: 'Activa (puede iniciar sesión)' }));
    await user.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    await screen.findByText('Cambios guardados.');
    expect(server.callsTo('PATCH', `/admin/users/${ANA.id}`)[0]!.body).toEqual({ is_active: false });
    expect(screen.getByText('Inactiva')).toBeInTheDocument();
  });

  it('demoting the last active admin → the 409 guard is explained inline', async () => {
    const other = fakeUser({
      id: 'cccccccc-0000-4000-8000-0000000000ad',
      username: 'wf-admin2',
      full_name: 'Admin Dos',
      role: 'admin',
    });
    // The server sees `other` as the only ACTIVE admin (the caller's row is marked inactive there).
    const me = { ...ME_ADMIN(), is_active: false };
    const server = fakeAdminServer({ me, users: [other] });
    const { user } = setup(server, `/admin/users/${other.id}`, ME_ADMIN());
    await user.click(await screen.findByRole('radio', { name: 'Anestesiólogo' }));
    await user.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Es el último administrador activo: no se puede eliminar, desactivar ni cambiar de rol.');
    expect(server.users.get(other.id)?.role).toBe('admin');
  });

  it('su propia cuenta: role/active locked, no reset or delete; a server self-guard is still shown inline', async () => {
    const me = ME_ADMIN();
    const server = fakeAdminServer({ me });
    const { user } = setup(server, `/admin/users/${me.id}`, me);
    expect(await screen.findByText('Usted')).toBeInTheDocument();
    expect(screen.queryByRole('radio', { name: 'Anestesiólogo' })).toBeNull();
    expect(screen.getByRole('switch', { name: 'Activa (puede iniciar sesión)' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Restablecer contraseña…' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Eliminar cuenta…' })).toBeNull();

    // A save the server refuses with the self guard (e.g. a stale page) is explained inline.
    server.override(`PATCH /admin/users/${me.id}`, () =>
      json({ detail: 'admins cannot delete, deactivate or demote themselves' }, 409),
    );
    await user.type(screen.getByLabelText('Clave'), 'X');
    await user.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'No puede eliminar, desactivar ni quitar el rol de administrador a su propia cuenta.',
    );
  });

  it('saving su propia cuenta updates the signed-in user and the stored session', async () => {
    const me = ME_ADMIN();
    const server = fakeAdminServer({ me });
    const { user } = setup(server, `/admin/users/${me.id}`, me);
    const name = await screen.findByLabelText('Nombre completo');
    await user.clear(name);
    await user.type(name, 'Admin Renombrado');
    await user.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    await screen.findByText('Cambios guardados.');
    expect(useAuthStore.getState().user).toMatchObject({ id: me.id, full_name: 'Admin Renombrado' });
    expect(JSON.parse(window.localStorage.getItem('auth_session_v1')!).user.full_name).toBe('Admin Renombrado');
  });

  it('saving ANOTHER account leaves the signed-in user alone', async () => {
    const me = ME_ADMIN();
    const server = fakeAdminServer({ me, users: [ANA] });
    const { user } = setup(server, `/admin/users/${ANA.id}`, me);
    const name = await screen.findByLabelText('Nombre completo');
    await user.clear(name);
    await user.type(name, 'Dra. Ana Editada');
    await user.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    await screen.findByText('Cambios guardados.');
    expect(useAuthStore.getState().user).toMatchObject({ id: me.id, full_name: me.full_name });
  });

  it('the reset-password field is kept away from the browser / password managers', async () => {
    const server = fakeAdminServer({ me: ME_ADMIN(), users: [ANA] });
    const { user } = setup(server, `/admin/users/${ANA.id}`);
    await user.click(await screen.findByRole('button', { name: 'Restablecer contraseña…' }));
    const field = screen.getByLabelText('Contraseña temporal nueva');
    expect(field).toHaveAttribute('autocomplete', 'off');
    expect(field).toHaveAttribute('data-1p-ignore');
    expect(field).toHaveAttribute('data-lpignore', 'true');
  });

  it('reset password shows the new temporary password once', async () => {
    const server = fakeAdminServer({ me: ME_ADMIN(), users: [ANA] });
    const { user } = setup(server, `/admin/users/${ANA.id}`);
    await user.click(await screen.findByRole('button', { name: 'Restablecer contraseña…' }));
    const field = screen.getByLabelText('Contraseña temporal nueva') as HTMLInputElement;
    const proposed = field.value;
    expect(proposed).toMatch(/^[A-Za-z2-9]{4}(-[A-Za-z2-9]{4}){2}$/);
    await user.click(screen.getByRole('button', { name: 'Restablecer contraseña' }));
    expect(await screen.findByRole('heading', { name: 'Contraseña restablecida' })).toBeInTheDocument();
    expect(server.callsTo('POST', `/admin/users/${ANA.id}/reset-password`)[0]!.body).toEqual({ password: proposed });
    expect(screen.getByLabelText('Contraseña temporal')).toHaveValue(proposed);
    expect(screen.getByText('Debe cambiar la contraseña')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Listo' }));
    expect(screen.queryByDisplayValue(proposed)).toBeNull();
    expect(screen.getByRole('button', { name: 'Restablecer contraseña…' })).toBeInTheDocument();
  });

  it('reset password: a too-short password is refused locally', async () => {
    const server = fakeAdminServer({ me: ME_ADMIN(), users: [ANA] });
    const { user } = setup(server, `/admin/users/${ANA.id}`);
    await user.click(await screen.findByRole('button', { name: 'Restablecer contraseña…' }));
    const field = screen.getByLabelText('Contraseña temporal nueva');
    await user.clear(field);
    await user.type(field, 'short');
    await user.click(screen.getByRole('button', { name: 'Restablecer contraseña' }));
    expect(screen.getByText('Al menos 8 caracteres.')).toBeInTheDocument();
    expect(server.callsTo('POST', `/admin/users/${ANA.id}/reset-password`)).toHaveLength(0);
  });

  it('delete (in-page confirm) → back to the list with a notice', async () => {
    const server = fakeAdminServer({ me: ME_ADMIN(), users: [ANA] });
    const { user } = setup(server, `/admin/users/${ANA.id}`);
    await user.click(await screen.findByRole('button', { name: 'Eliminar cuenta…' }));
    await user.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(server.callsTo('DELETE', `/admin/users/${ANA.id}`)).toHaveLength(0);
    await user.click(screen.getByRole('button', { name: 'Eliminar cuenta…' }));
    const group = screen.getByRole('group', { name: `Confirmar eliminación de ${ANA.username}` });
    await user.click(within(group).getByRole('button', { name: 'Eliminar' }));
    expect(await screen.findByRole('heading', { name: 'Usuarios', level: 1 })).toBeInTheDocument();
    expect(screen.getByText(`Se eliminó la cuenta ${ANA.username}.`)).toBeInTheDocument();
    expect(server.users.has(ANA.id)).toBe(false);
  });

  it('delete of a user who owns cases (409) explains and offers Deactivate instead', async () => {
    const server = fakeAdminServer({ me: ME_ADMIN(), users: [ANA], caseCounts: { [ANA.id]: 3 } });
    const { user } = setup(server, `/admin/users/${ANA.id}`);
    await user.click(await screen.findByRole('button', { name: 'Eliminar cuenta…' }));
    await user.click(screen.getByRole('button', { name: 'Eliminar' }));
    expect(await screen.findByText(/tiene 3 casos, así que la cuenta no/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Desactivar en su lugar' }));
    expect(await screen.findByText(/ya no puede iniciar sesión/)).toBeInTheDocument();
    expect(server.callsTo('PATCH', `/admin/users/${ANA.id}`)[0]!.body).toEqual({ is_active: false });
    expect(server.users.get(ANA.id)?.is_active).toBe(false);
    expect(screen.getByRole('switch', { name: 'Activa (puede iniciar sesión)' })).not.toBeChecked();
  });

  it('delete of the last active admin (409) shows the guard inline', async () => {
    const other = fakeUser({ id: 'cccccccc-0000-4000-8000-0000000000ad', username: 'wf-admin2', role: 'admin' });
    const server = fakeAdminServer({ me: { ...ME_ADMIN(), is_active: false }, users: [other] });
    const { user } = setup(server, `/admin/users/${other.id}`, ME_ADMIN());
    await user.click(await screen.findByRole('button', { name: 'Eliminar cuenta…' }));
    await user.click(screen.getByRole('button', { name: 'Eliminar' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Es el último administrador activo');
    expect(server.users.has(other.id)).toBe(true);
  });

  it('an unknown account shows "Cuenta no encontrada"', async () => {
    const server = fakeAdminServer({ me: ME_ADMIN() });
    setup(server, '/admin/users/dddddddd-0000-4000-8000-000000000000');
    expect(await screen.findByText('Cuenta no encontrada')).toBeInTheDocument();
  });
});
