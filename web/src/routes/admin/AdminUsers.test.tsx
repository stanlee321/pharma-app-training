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
    expect(within(beto).getByText('Inactive')).toBeInTheDocument();
    expect(within(beto).getByText('Anesthesiologist')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '3 accounts' })).toBeInTheDocument();
  });

  it('search (debounced), role and status filters go to the server as query params', async () => {
    const server = fakeAdminServer({ me: ME_ADMIN(), users: [ANA, BETO] });
    const { user } = setup(server, '/admin/users');
    await screen.findByRole('link', { name: 'Dra. Ana Sintetica' });

    await user.type(screen.getByLabelText('Search'), 'sin-01');
    await waitFor(() => expect(server.calls.at(-1)?.query).toEqual({ q: 'sin-01' }));
    expect(server.callsTo('GET', '/admin/users').filter((c) => c.query.q?.startsWith('s')).length).toBeLessThanOrEqual(
      2,
    );
    expect(await screen.findByRole('heading', { name: '1 account (filtered)' })).toBeInTheDocument();

    await user.clear(screen.getByLabelText('Search'));
    await user.selectOptions(screen.getByLabelText('Role'), 'admin');
    await waitFor(() => expect(server.calls.at(-1)?.query).toEqual({ role: 'admin' }));
    expect(await screen.findByRole('link', { name: 'Admin Demo' })).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText('Role'), '');
    await user.selectOptions(screen.getByLabelText('Status'), 'false');
    await waitFor(() => expect(server.calls.at(-1)?.query).toEqual({ is_active: 'false' }));
    expect(await screen.findByRole('link', { name: 'Dr. Beto Prueba' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Dra. Ana Sintetica' })).toBeNull();
  });

  it('empty result and load error states (with Retry)', async () => {
    const server = fakeAdminServer({ me: ME_ADMIN() });
    server.override('GET /admin/users', () => json({ detail: 'database unavailable' }, 503));
    const { user } = setup(server, '/admin/users?q=nobody');
    expect(await screen.findByText('Couldn’t load users')).toBeInTheDocument();
    expect(screen.getByText(/database unavailable/)).toBeInTheDocument();
    server.clearOverride('GET /admin/users');
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('No matching accounts')).toBeInTheDocument();
  });
});

describe('Create user', () => {
  it('validates locally (username rules, password length) without calling the server', async () => {
    const server = fakeAdminServer({ me: ME_ADMIN() });
    const { user } = setup(server, '/admin/users/new');
    await user.click(await screen.findByRole('button', { name: 'Create account' }));
    expect(screen.getByLabelText('Username')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByText('Enter a username.')).toBeInTheDocument();
    expect(screen.getByText('At least 8 characters.')).toBeInTheDocument();

    await user.type(screen.getByLabelText('Username'), '.bad name');
    await user.click(screen.getByRole('button', { name: 'Create account' }));
    // The rule now shows as the field's error (role=alert), not only as helper text.
    const usernameNote = document.getElementById(screen.getByLabelText('Username').getAttribute('aria-describedby')!)!;
    expect(usernameNote).toHaveAttribute('role', 'alert');
    expect(usernameNote).toHaveTextContent('Letters, digits and . _ @ - only; must start with a letter or digit.');
    expect(server.callsTo('POST', '/admin/users')).toHaveLength(0);
  });

  it('the new account’s username and password are kept away from the browser / password managers', async () => {
    const server = fakeAdminServer({ me: ME_ADMIN() });
    setup(server, '/admin/users/new');
    for (const label of ['Username', 'Password']) {
      const field = await screen.findByLabelText(label);
      expect(field).toHaveAttribute('autocomplete', 'off');
      expect(field).toHaveAttribute('data-1p-ignore');
      expect(field).toHaveAttribute('data-lpignore', 'true');
    }
    // Other rows are untouched (the attributes are only for credential-like fields).
    expect(screen.getByLabelText('Full name')).not.toHaveAttribute('data-1p-ignore');
  });

  it('shows the server’s reserved "gw-" prefix error (422) on the username field', async () => {
    const server = fakeAdminServer({ me: ME_ADMIN() });
    const { user } = setup(server, '/admin/users/new');
    await user.type(await screen.findByLabelText('Username'), 'GW-legacy');
    await user.type(screen.getByLabelText('Password'), 'Temporal-123');
    await user.click(screen.getByRole('button', { name: 'Create account' }));
    expect(await screen.findByText("Usernames starting with 'gw-' are reserved.")).toBeInTheDocument();
    expect(screen.getByLabelText('Username')).toHaveAttribute('aria-invalid', 'true');
    expect(server.callsTo('POST', '/admin/users')).toHaveLength(1);
    expect(server.users.size).toBe(1);
  });

  it('a taken username (409) is shown on the field', async () => {
    const server = fakeAdminServer({ me: ME_ADMIN(), users: [ANA] });
    const { user } = setup(server, '/admin/users/new');
    await user.type(await screen.findByLabelText('Username'), 'WF-Ana');
    await user.type(screen.getByLabelText('Password'), 'Temporal-123');
    await user.click(screen.getByRole('button', { name: 'Create account' }));
    expect(await screen.findByText('This username is already taken.')).toBeInTheDocument();
  });

  it('creates with a generated password and shows it ONCE', async () => {
    const server = fakeAdminServer({ me: ME_ADMIN() });
    const { user } = setup(server, '/admin/users/new');
    await user.type(await screen.findByLabelText('Username'), 'wf-nueva');
    await user.type(screen.getByLabelText('Full name'), 'Dra. Nueva Sintetica');
    await user.type(screen.getByLabelText('Clave'), 'NUE-03');
    await user.click(screen.getByRole('radio', { name: 'Admin' }));
    const pwField = screen.getByLabelText('Password');
    expect(pwField).toHaveAttribute('type', 'password');
    await user.click(screen.getByRole('button', { name: 'Generate a password' }));
    const generated = (pwField as HTMLInputElement).value;
    expect(generated).toMatch(/^[A-Za-z2-9]{4}-[A-Za-z2-9]{4}-[A-Za-z2-9]{4}$/);
    expect(pwField).toHaveAttribute('type', 'text'); // revealed after generating
    await user.click(screen.getByRole('button', { name: 'Create account' }));

    expect(await screen.findByRole('heading', { name: 'Account created' })).toBeInTheDocument();
    expect(server.callsTo('POST', '/admin/users')[0]!.body).toEqual({
      username: 'wf-nueva',
      full_name: 'Dra. Nueva Sintetica',
      clave: 'NUE-03',
      role: 'admin',
      password: generated,
    });
    expect(screen.getByLabelText('Temporary password')).toHaveValue(generated);
    expect(screen.getByText(/shown only once/)).toBeInTheDocument();
    // Never persisted anywhere the browser keeps.
    for (let i = 0; i < window.localStorage.length; i++) {
      expect(window.localStorage.getItem(window.localStorage.key(i)!)).not.toContain(generated);
    }
    expect(window.location.href).not.toContain(generated);

    // Done → the list; coming back to "New user" shows an empty form, not the password.
    await user.click(screen.getByRole('button', { name: 'Done' }));
    expect(await screen.findByRole('heading', { name: 'Users', level: 1 })).toBeInTheDocument();
    expect(screen.queryByText(generated)).toBeNull();
    await user.click(screen.getByRole('link', { name: 'New user' }));
    expect(await screen.findByLabelText('Password')).toHaveValue('');
    expect(screen.queryByDisplayValue(generated)).toBeNull();
  });

  it('"Create another" clears the secret and the form', async () => {
    const server = fakeAdminServer({ me: ME_ADMIN() });
    const { user } = setup(server, '/admin/users/new');
    await user.type(await screen.findByLabelText('Username'), 'wf-otra');
    await user.type(screen.getByLabelText('Password'), 'Temporal-123');
    await user.click(screen.getByRole('button', { name: 'Create account' }));
    await screen.findByRole('heading', { name: 'Account created' });
    await user.click(screen.getByRole('button', { name: 'Create another' }));
    expect(screen.queryByDisplayValue('Temporal-123')).toBeNull();
    expect(screen.getByLabelText('Username')).toHaveValue('');
  });
});

describe('Edit, reset, delete', () => {
  it('edit sends only the changed keys', async () => {
    const server = fakeAdminServer({ me: ME_ADMIN(), users: [ANA] });
    const { user } = setup(server, `/admin/users/${ANA.id}`);
    const name = await screen.findByLabelText('Full name');
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled();
    await user.clear(name);
    await user.type(name, 'Dra. Ana Editada');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText('Changes saved.')).toBeInTheDocument();
    expect(server.callsTo('PATCH', `/admin/users/${ANA.id}`)[0]!.body).toEqual({ full_name: 'Dra. Ana Editada' });
    expect(screen.getByRole('heading', { name: 'Dra. Ana Editada', level: 1 })).toBeInTheDocument();
  });

  it('deactivate via the Active switch; the badge follows', async () => {
    const server = fakeAdminServer({ me: ME_ADMIN(), users: [ANA] });
    const { user } = setup(server, `/admin/users/${ANA.id}`);
    await user.click(await screen.findByRole('switch', { name: 'Active (can sign in)' }));
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await screen.findByText('Changes saved.');
    expect(server.callsTo('PATCH', `/admin/users/${ANA.id}`)[0]!.body).toEqual({ is_active: false });
    expect(screen.getByText('Inactive')).toBeInTheDocument();
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
    await user.click(await screen.findByRole('radio', { name: 'Anesthesiologist' }));
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('This is the last active admin, so it can’t be deleted, deactivated or demoted.');
    expect(server.users.get(other.id)?.role).toBe('admin');
  });

  it('your own account: role/active locked, no reset or delete; a server self-guard is still shown inline', async () => {
    const me = ME_ADMIN();
    const server = fakeAdminServer({ me });
    const { user } = setup(server, `/admin/users/${me.id}`, me);
    expect(await screen.findByText('You')).toBeInTheDocument();
    expect(screen.queryByRole('radio', { name: 'Anesthesiologist' })).toBeNull();
    expect(screen.getByRole('switch', { name: 'Active (can sign in)' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Reset password…' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Delete account…' })).toBeNull();

    // A save the server refuses with the self guard (e.g. a stale page) is explained inline.
    server.override(`PATCH /admin/users/${me.id}`, () =>
      json({ detail: 'admins cannot delete, deactivate or demote themselves' }, 409),
    );
    await user.type(screen.getByLabelText('Clave'), 'X');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'You can’t delete, deactivate or demote your own account.',
    );
  });

  it('saving your own account updates the signed-in user and the stored session', async () => {
    const me = ME_ADMIN();
    const server = fakeAdminServer({ me });
    const { user } = setup(server, `/admin/users/${me.id}`, me);
    const name = await screen.findByLabelText('Full name');
    await user.clear(name);
    await user.type(name, 'Admin Renombrado');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await screen.findByText('Changes saved.');
    expect(useAuthStore.getState().user).toMatchObject({ id: me.id, full_name: 'Admin Renombrado' });
    expect(JSON.parse(window.localStorage.getItem('auth_session_v1')!).user.full_name).toBe('Admin Renombrado');
  });

  it('saving ANOTHER account leaves the signed-in user alone', async () => {
    const me = ME_ADMIN();
    const server = fakeAdminServer({ me, users: [ANA] });
    const { user } = setup(server, `/admin/users/${ANA.id}`, me);
    const name = await screen.findByLabelText('Full name');
    await user.clear(name);
    await user.type(name, 'Dra. Ana Editada');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await screen.findByText('Changes saved.');
    expect(useAuthStore.getState().user).toMatchObject({ id: me.id, full_name: me.full_name });
  });

  it('the reset-password field is kept away from the browser / password managers', async () => {
    const server = fakeAdminServer({ me: ME_ADMIN(), users: [ANA] });
    const { user } = setup(server, `/admin/users/${ANA.id}`);
    await user.click(await screen.findByRole('button', { name: 'Reset password…' }));
    const field = screen.getByLabelText('New temporary password');
    expect(field).toHaveAttribute('autocomplete', 'off');
    expect(field).toHaveAttribute('data-1p-ignore');
    expect(field).toHaveAttribute('data-lpignore', 'true');
  });

  it('reset password shows the new temporary password once', async () => {
    const server = fakeAdminServer({ me: ME_ADMIN(), users: [ANA] });
    const { user } = setup(server, `/admin/users/${ANA.id}`);
    await user.click(await screen.findByRole('button', { name: 'Reset password…' }));
    const field = screen.getByLabelText('New temporary password') as HTMLInputElement;
    const proposed = field.value;
    expect(proposed).toMatch(/^[A-Za-z2-9]{4}(-[A-Za-z2-9]{4}){2}$/);
    await user.click(screen.getByRole('button', { name: 'Reset password' }));
    expect(await screen.findByRole('heading', { name: 'Password reset' })).toBeInTheDocument();
    expect(server.callsTo('POST', `/admin/users/${ANA.id}/reset-password`)[0]!.body).toEqual({ password: proposed });
    expect(screen.getByLabelText('Temporary password')).toHaveValue(proposed);
    expect(screen.getByText('Must change password')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Done' }));
    expect(screen.queryByDisplayValue(proposed)).toBeNull();
    expect(screen.getByRole('button', { name: 'Reset password…' })).toBeInTheDocument();
  });

  it('reset password: a too-short password is refused locally', async () => {
    const server = fakeAdminServer({ me: ME_ADMIN(), users: [ANA] });
    const { user } = setup(server, `/admin/users/${ANA.id}`);
    await user.click(await screen.findByRole('button', { name: 'Reset password…' }));
    const field = screen.getByLabelText('New temporary password');
    await user.clear(field);
    await user.type(field, 'short');
    await user.click(screen.getByRole('button', { name: 'Reset password' }));
    expect(screen.getByText('At least 8 characters.')).toBeInTheDocument();
    expect(server.callsTo('POST', `/admin/users/${ANA.id}/reset-password`)).toHaveLength(0);
  });

  it('delete (in-page confirm) → back to the list with a notice', async () => {
    const server = fakeAdminServer({ me: ME_ADMIN(), users: [ANA] });
    const { user } = setup(server, `/admin/users/${ANA.id}`);
    await user.click(await screen.findByRole('button', { name: 'Delete account…' }));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(server.callsTo('DELETE', `/admin/users/${ANA.id}`)).toHaveLength(0);
    await user.click(screen.getByRole('button', { name: 'Delete account…' }));
    const group = screen.getByRole('group', { name: `Confirm deleting ${ANA.username}` });
    await user.click(within(group).getByRole('button', { name: 'Delete' }));
    expect(await screen.findByRole('heading', { name: 'Users', level: 1 })).toBeInTheDocument();
    expect(screen.getByText(`Account ${ANA.username} deleted.`)).toBeInTheDocument();
    expect(server.users.has(ANA.id)).toBe(false);
  });

  it('delete of a user who owns cases (409) explains and offers Deactivate instead', async () => {
    const server = fakeAdminServer({ me: ME_ADMIN(), users: [ANA], caseCounts: { [ANA.id]: 3 } });
    const { user } = setup(server, `/admin/users/${ANA.id}`);
    await user.click(await screen.findByRole('button', { name: 'Delete account…' }));
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    expect(await screen.findByText(/owns 3 cases, so the account can’t be deleted/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Deactivate instead' }));
    expect(await screen.findByText(/was deactivated: they can no longer sign in/)).toBeInTheDocument();
    expect(server.callsTo('PATCH', `/admin/users/${ANA.id}`)[0]!.body).toEqual({ is_active: false });
    expect(server.users.get(ANA.id)?.is_active).toBe(false);
    expect(screen.getByRole('switch', { name: 'Active (can sign in)' })).not.toBeChecked();
  });

  it('delete of the last active admin (409) shows the guard inline', async () => {
    const other = fakeUser({ id: 'cccccccc-0000-4000-8000-0000000000ad', username: 'wf-admin2', role: 'admin' });
    const server = fakeAdminServer({ me: { ...ME_ADMIN(), is_active: false }, users: [other] });
    const { user } = setup(server, `/admin/users/${other.id}`, ME_ADMIN());
    await user.click(await screen.findByRole('button', { name: 'Delete account…' }));
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('This is the last active admin');
    expect(server.users.has(other.id)).toBe(true);
  });

  it('an unknown account shows "Account not found"', async () => {
    const server = fakeAdminServer({ me: ME_ADMIN() });
    setup(server, '/admin/users/dddddddd-0000-4000-8000-000000000000');
    expect(await screen.findByText('Account not found')).toBeInTheDocument();
  });
});
