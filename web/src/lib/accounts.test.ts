import { describe, expect, it } from 'vitest';
import { BackendError } from '../api/backend';
import {
  fieldErrors,
  generateTempPassword,
  guardMessage,
  LAST_ADMIN_DETAIL,
  ownsCases,
  passwordProblem,
  SELF_GUARD_DETAIL,
  USERNAME_RULE,
  usernameProblem,
} from './accounts';

const httpErr = (status: number, body: unknown) => BackendError.http(status, JSON.stringify(body));

describe('username rules (mirror AdminUserCreate)', () => {
  it.each([
    ['dra.demo', null],
    ['A1', null],
    ['user_name-01@host', null],
    ['', 'Escriba un nombre de usuario.'],
    ['   ', 'Escriba un nombre de usuario.'],
    ['.lead', USERNAME_RULE],
    ['has space', USERNAME_RULE],
    ['ñandu', USERNAME_RULE],
    ['a'.repeat(65), 'Como máximo 64 caracteres.'],
  ])('%j → %j', (u, expected) => {
    expect(usernameProblem(u)).toBe(expected);
  });

  it('leaves the reserved gw- prefix to the server (its 422 message is shown)', () => {
    expect(usernameProblem('gw-legacy')).toBeNull();
  });

  it('password length 8–128', () => {
    expect(passwordProblem('1234567')).toBe('Al menos 8 caracteres.');
    expect(passwordProblem('12345678')).toBeNull();
    expect(passwordProblem('x'.repeat(129))).toBe('Como máximo 128 caracteres.');
  });
});

describe('generateTempPassword', () => {
  it('is 3×4 unambiguous chars with every class, accepted by the server rules, and random', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const p = generateTempPassword();
      expect(p).toMatch(/^[A-HJ-NP-Za-km-z2-9]{4}-[A-HJ-NP-Za-km-z2-9]{4}-[A-HJ-NP-Za-km-z2-9]{4}$/);
      expect(p).toMatch(/[A-Z]/);
      expect(p).toMatch(/[a-z]/);
      expect(p).toMatch(/[2-9]/);
      expect(passwordProblem(p)).toBeNull();
      seen.add(p);
    }
    expect(seen.size).toBe(200);
  });
});

describe('server errors → field / guard messages', () => {
  it('maps the gw- reservation 422 to the username field', () => {
    const e = httpErr(422, {
      detail: [
        {
          type: 'value_error',
          loc: ['body', 'username'],
          msg: "Value error, usernames starting with 'gw-' are reserved",
        },
      ],
    });
    expect(fieldErrors(e)).toEqual({ username: 'Los nombres de usuario que empiezan con «gw-» están reservados.' });
  });

  it('maps the pattern 422 to the readable rule and a short password to the password field', () => {
    const e = httpErr(422, {
      detail: [
        { type: 'string_pattern_mismatch', loc: ['body', 'username'], msg: "String should match pattern '^…$'" },
        { type: 'string_too_short', loc: ['body', 'password'], msg: 'String should have at least 8 characters' },
      ],
    });
    expect(fieldErrors(e)).toEqual({ username: USERNAME_RULE, password: 'Debe tener al menos 8 caracteres.' });
  });

  it('a taken username (409) goes to the username field', () => {
    expect(fieldErrors(httpErr(409, { detail: 'username already exists' }))).toEqual({
      username: 'Ese nombre de usuario ya está en uso.',
    });
  });

  it('guards and "owns cases" are recognised', () => {
    expect(guardMessage(httpErr(409, { detail: SELF_GUARD_DETAIL }))).toMatch(/su propia cuenta/);
    expect(guardMessage(httpErr(409, { detail: LAST_ADMIN_DETAIL }))).toMatch(/último administrador activo/);
    const owns = httpErr(409, { detail: 'user owns 2 case(s); deactivate the account instead' });
    expect(guardMessage(owns)).toBeNull();
    expect(ownsCases(owns)).toBe(true);
    expect(ownsCases(httpErr(409, { detail: SELF_GUARD_DETAIL }))).toBe(false);
    expect(fieldErrors(httpErr(500, { detail: 'boom' }))).toEqual({});
  });
});
