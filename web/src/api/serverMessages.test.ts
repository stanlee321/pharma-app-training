import { describe, expect, it } from 'vitest';
import { BackendError, errorMessage } from './backend';
import { serverMessage, translateDetail } from './serverMessages';

/** Backend validator messages (dto.py / auth_service.py), raw and as pydantic wraps them. */
const VALIDATOR_DETAILS: [string, string][] = [
  ['nombre cannot be blank', 'Nombre: no puede estar vacío.'],
  ['registro cannot be blank', 'Registro: no puede estar vacío.'],
  ['fields cannot be null: nombre, registro', 'Estos campos no pueden quedar vacíos: Nombre, Registro.'],
  ['fields cannot be null: full_name, role', 'Estos campos no pueden quedar vacíos: Nombre completo, Rol.'],
  ['username must be 1-64 characters', 'El nombre de usuario debe tener de 1 a 64 caracteres.'],
  ['password must be 8-128 characters', 'La contraseña debe tener de 8 a 128 caracteres.'],
  ["usernames starting with 'gw-' are reserved", 'Los nombres de usuario que empiezan con «gw-» están reservados.'],
];

describe('serverMessages: backend validator details', () => {
  it.each(VALIDATOR_DETAILS)('translates %s', (detail, es) => {
    expect(translateDetail(detail)).toBe(es);
    expect(translateDetail(`Value error, ${detail}`)).toBe(es);
    expect(serverMessage(`Value error, ${detail}`)).toBe(es);
  });

  it('never shows the English validator text behind the Spanish prefix', () => {
    for (const [detail] of VALIDATOR_DETAILS) {
      expect(serverMessage(`Value error, ${detail}`)).not.toMatch(/El servidor respondió/);
    }
  });

  it('keeps an unknown field name as sent', () => {
    expect(translateDetail('zzz cannot be blank')).toBe('zzz: no puede estar vacío.');
  });

  it('labels a detail it does not know', () => {
    expect(translateDetail('something new')).toBeNull();
    expect(serverMessage('something new')).toBe('El servidor respondió: something new');
  });
});

describe('serverMessages: pydantic type errors', () => {
  /** The real 422 body of GET /patients/not-a-uuid (FastAPI + pydantic 2 uuid_parsing). */
  const UUID_422 = JSON.stringify({
    detail: [
      {
        type: 'uuid_parsing',
        loc: ['path', 'patient_id'],
        msg: 'Input should be a valid UUID, invalid character: found `n` at 1',
        input: 'not-a-uuid',
        ctx: { error: 'invalid character: found `n` at 1' },
        url: 'https://errors.pydantic.dev/2.13/v/uuid_parsing',
      },
    ],
  });
  const ENGLISH = /\b(input|should|valid|invalid|character|found|expected|uuid|integer|string)\b/i;

  it('a malformed id reads "Identificador no válido." with no English left', () => {
    const err = BackendError.http(422, UUID_422);
    expect(errorMessage(err)).toBe('Identificador no válido.');
    expect(errorMessage(err)).not.toMatch(ENGLISH);
    expect(err.message).not.toMatch(ENGLISH);
  });

  it.each([
    'Input should be a valid integer, unable to parse string as an integer',
    "Input should be 'male' or 'female'",
    'Input should be a valid date or datetime, input is too short',
  ])('any other "Input should be" → "Valor no válido." without echoing it (%s)', (msg) => {
    expect(serverMessage(msg)).toBe('Valor no válido.');
    expect(serverMessage(msg)).not.toMatch(ENGLISH);
  });
});
