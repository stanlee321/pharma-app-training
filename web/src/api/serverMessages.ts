/**
 * The backend's `ErrorDTO.detail` strings are English and part of its API contract (the web
 * compares against them, e.g. `detail === 'case is finalized'`). They are translated here, and
 * only here, when shown to a person: `serverMessage(detail)`. `BackendError.detail` itself stays
 * the raw server value so those comparisons keep working.
 */

/** Exact details → Spanish (backend/app/**: *_DETAIL constants and HTTPException details). */
const EXACT: Record<string, string> = {
  // cases
  'case is finalized': 'El caso está finalizado y es de solo lectura.',
  'case is not finalized': 'El caso no está finalizado.',
  'case belongs to another anesthesiologist': 'El caso pertenece a otro anestesiólogo; solo puede consultarlo.',
  'case changed during finalize; retry': 'El caso cambió mientras se finalizaba; inténtelo de nuevo.',
  'admins cannot modify cases through /cases; use /admin': 'Un administrador no puede modificar casos desde esta vista.',
  'Case not found': 'Caso no encontrado.',
  'patient_id is required to create a case': 'Para crear un caso se necesita el paciente.',
  // patients
  'patient exists': 'Ya existe un paciente con ese registro.',
  'patient has cases; delete them first': 'El paciente tiene casos; elimínelos primero.',
  'Patient not found': 'Paciente no encontrado.',
  'fecha_nacimiento cannot be in the future': 'La fecha de nacimiento no puede ser futura.',
  // documents / forms
  'Document not found': 'Documento no encontrado.',
  'document file is missing': 'El archivo del documento no está disponible.',
  'document content is missing': 'El contenido del documento no está disponible.',
  'document is unreadable': 'No se pudo leer el documento.',
  'document integrity check failed': 'El documento no pasó la verificación de integridad.',
  'Form schema not found': 'Formulario no encontrado.',
  // accounts / auth
  'admin only': 'Solo para administradores.',
  'password change required': 'Debe cambiar su contraseña antes de continuar.',
  'Invalid username or password': 'Usuario o contraseña incorrectos.',
  'Invalid or expired token': 'La sesión no es válida o ya expiró.',
  'Invalid gateway identity': 'Identidad no válida.',
  'Not authenticated': 'No ha iniciado sesión.',
  'User is inactive': 'La cuenta está desactivada.',
  'Current password is incorrect': 'La contraseña actual es incorrecta.',
  'local login disabled in gateway mode': 'El inicio de sesión local está deshabilitado en este servidor.',
  'User not found': 'Usuario no encontrado.',
  'username already exists': 'Ese nombre de usuario ya existe.',
  'admins cannot delete, deactivate or demote themselves':
    'No puede eliminar, desactivar ni quitar el rol de administrador a su propia cuenta.',
  'the last active admin cannot be deleted, deactivated or demoted':
    'Es el último administrador activo: no se puede eliminar, desactivar ni cambiar de rol.',
  'user owns cases; deactivate the account instead': 'La cuenta tiene casos; desactívela en lugar de eliminarla.',
  'username must be 1-64 characters': 'El nombre de usuario debe tener de 1 a 64 caracteres.',
  // admin filters
  'date_from must be on or before date_to': 'La fecha inicial debe ser anterior o igual a la final.',
  // generic
  'Not found': 'No encontrado.',
  'Not Found': 'No encontrado.',
  'Item not found': 'No encontrado.',
  'Field required': 'Campo obligatorio.',
};

/** The server-contract (English) details this module knows — never shown untranslated. */
export const KNOWN_SERVER_DETAILS: readonly string[] = Object.keys(EXACT);

/** Wire field names (DTO keys) as a person reads them, for the parametrised validator details. */
export const FIELD_ES: Record<string, string> = {
  nombre: 'Nombre',
  registro: 'Registro',
  sexo: 'Sexo',
  fecha_nacimiento: 'Fecha de nacimiento',
  grupo_sanguineo: 'Grupo sanguíneo',
  rh: 'Rh',
  username: 'Nombre de usuario',
  full_name: 'Nombre completo',
  clave: 'Clave',
  role: 'Rol',
  is_active: 'Cuenta activa',
  password: 'Contraseña',
  status: 'Estado',
  owner: 'Responsable',
  patient_id: 'Paciente',
};

const fieldEs = (f: string): string => FIELD_ES[f.trim()] ?? f.trim();

/** Parametrised details (pydantic validation messages and counted details). */
const PATTERNS: [RegExp, (m: RegExpExecArray) => string][] = [
  [/^user owns (\d+) case\(s\); deactivate the account instead$/, (m) => `La cuenta tiene ${m[1]} caso(s); desactívela en lugar de eliminarla.`],
  [/^String should have at least (\d+) characters?$/, (m) => `Debe tener al menos ${m[1]} caracteres.`],
  [/^String should have at most (\d+) characters?$/, (m) => `Debe tener como máximo ${m[1]} caracteres.`],
  [/^Value error, usernames starting with '(.+)' are reserved$/, (m) => `Los nombres de usuario que empiezan con «${m[1]}» están reservados.`],
  [/^(\w+) cannot be blank$/, (m) => `${fieldEs(m[1]!)}: no puede estar vacío.`],
  [/^fields cannot be null: (.+)$/, (m) => `Estos campos no pueden quedar vacíos: ${m[1]!.split(',').map(fieldEs).join(', ')}.`],
  [/^password must be (\d+)-(\d+) characters$/, (m) => `La contraseña debe tener de ${m[1]} a ${m[2]} caracteres.`],
  [/^usernames starting with '(.+)' are reserved$/, (m) => `Los nombres de usuario que empiezan con «${m[1]}» están reservados.`],
  [/^Value error, (.+)$/, (m) => serverMessage(m[1]!)],
  [/^unknown form_id: (.+)$/, (m) => `Formulario desconocido: ${m[1]}.`],
  // pydantic type errors: never echo the (English) expectation nor the offending input
  [/^Input should be a valid UUID\b/, () => 'Identificador no válido.'],
  [/^Input should be /, () => 'Valor no válido.'],
  [/^String should match pattern (.+)$/, () => 'Formato no válido.'],
];

/** A server `detail` (or several joined with "; ") in Spanish; unknown text is kept, labelled. */
export function serverMessage(detail: string): string {
  return translateDetail(detail) ?? `El servidor respondió: ${detail.trim()}`;
}

/** The Spanish text of a known server `detail`, else null (the caller shows the raw text). */
export function translateDetail(detail: string): string | null {
  const whole = known(detail.trim());
  if (whole) return whole;
  const parts = detail.split('; ').map((d) => d.trim()).filter(Boolean);
  if (parts.length > 1 && parts.some((d) => known(d))) return parts.map((d) => known(d) ?? d).join(' ');
  return null;
}

function known(d: string): string | null {
  const exact = EXACT[d];
  if (exact) return exact;
  for (const [re, f] of PATTERNS) {
    const m = re.exec(d);
    if (m) return f(m);
  }
  return null;
}
