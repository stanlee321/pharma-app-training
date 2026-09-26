/**
 * Spanish-only guard (the UI has no i18n framework, so nothing else stops English creeping back).
 *
 * 1. Source scan: every user-visible string in `src/**` (JSX text, string / template literals,
 *    except import specifiers, object keys and type literals) is checked for common English UI
 *    words. Server-contract strings (the backend's English `detail`s the client compares against
 *    or fakes offline) are the only allowed exceptions, and they are listed explicitly.
 * 2. Rendered scan: a few real screens are rendered and their whole text + accessible names
 *    (aria-label / title / placeholder) are checked with the same word list.
 * 3. index.html declares lang="es".
 */
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import ts from 'typescript';
import { afterEach, describe, expect, it, vi } from 'vitest';
import indexHtml from '../../index.html?raw';
import { newCase } from '../api/factory';
import { KNOWN_SERVER_DETAILS } from '../api/serverMessages';
import { AppRoutes } from '../routes/AppRoutes';
import { caseStore } from '../state/caseStore';
import { signInAs } from './auth';
import { fakeAdminServer, ME_ADMIN, statsFixture } from './fakeAdminServer';
import { fakePatient, renderApp, restHarness } from './restHarness';
import { FUTURE } from './router';

/** Capitalised English UI words (case-sensitive, whole words) that have no Spanish homograph. */
const ENGLISH_WORDS = [
  'Save', 'Saved', 'Saving', 'Cancel', 'Delete', 'Deleting', 'Sign', 'Signed', 'Signing', 'Loading', 'Patient',
  'Patients', 'Encounter', 'Review', 'Export', 'Retry', 'Back', 'Edit', 'Add', 'Close', 'Open', 'Opening', 'View',
  'Search', 'Status', 'Created', 'Updated', 'Draft', 'Drafts', 'Finalized', 'Finalize', 'Dismiss', 'Refresh', 'Users',
  'User', 'Account', 'Accounts', 'Password', 'Username', 'Documents', 'Document', 'Previous', 'Next', 'Failed',
  'Could', 'Couldn', 'Please', 'Settings', 'Server', 'Advanced', 'Newborn', 'Newborns', 'Recovery', 'Monitoring',
  'Weight', 'Height', 'Age', 'Drug', 'Drugs', 'Fluid', 'Technique', 'Dashboard', 'Case', 'Cases', 'Unsaved',
  'Welcome', 'Confirm', 'Reset', 'Generate', 'Download', 'Copy', 'Copied', 'Show', 'Hide', 'Done', 'Invalid',
  'Required', 'Filter', 'Clear', 'Page', 'Active', 'Inactive', 'Role', 'Totals', 'Stored', 'Preview', 'Size',
  'Actions', 'Form', 'Notes', 'Labs', 'History', 'Derived', 'Dilution', 'Somatometry', 'Target', 'Increase',
  'Decrease', 'Completed', 'Untitled', 'Enter', 'Change', 'Current', 'New', 'Older', 'Reopen', 'Deactivate',
] as const;
/** Lower-case English phrases typical of UI sentences. */
const ENGLISH_PHRASES = ['could not', 'failed', 'not found', 'read-only', 'your ', 'you ', 'the server', 'please', 'no cases', 'summary fallback'];

/** A synthetic patient for the rendered admin patient screens. */
const GUARD_PATIENT = fakePatient({ id: '33333333-0000-4000-8000-000000000001', nombre: 'Paciente Guardia', registro: 'SYN-GUARD' });

const WORD_RE = new RegExp(`\\b(${ENGLISH_WORDS.join('|')})\\b`);

/**
 * Lower-case English words with no Spanish homograph. Checked in text a person reads (JSX text,
 * rendered text), where a lone lower-case word is prose, not a code identifier — e.g. an
 * `<option>unit</option>` placeholder.
 */
const ENGLISH_LOWER_WORDS = [
  'unit', 'units', 'none', 'select', 'choose', 'loading', 'save', 'cancel', 'delete', 'edit', 'search', 'required',
  'optional', 'unknown', 'other', 'yes', 'empty', 'add', 'remove', 'retry', 'close', 'back', 'next', 'previous',
] as const;
const LOWER_WORD_RE = new RegExp(`\\b(${ENGLISH_LOWER_WORDS.join('|')})\\b`);

/** A code identifier / enum value ("failed", "draft", "row--invalid"), not prose. */
const IDENTIFIER = /^[a-z][A-Za-z0-9_.:-]*$/;

function englishIn(text: string, prose = false): string | null {
  if (prose) {
    const lw = LOWER_WORD_RE.exec(text);
    if (lw) return lw[1]!;
  } else if (IDENTIFIER.test(text)) return null;
  const w = WORD_RE.exec(text);
  if (w) return w[1]!;
  const lower = text.toLowerCase();
  return ENGLISH_PHRASES.find((p) => lower.includes(p)) ?? null;
}

/**
 * Server-contract strings: English on purpose (compared with / faked as the backend's `detail`,
 * never shown untranslated — see api/serverMessages.ts). Anything else English fails the test.
 */
const ALLOWED = new Set<string>([
  ...KNOWN_SERVER_DETAILS,
  '{"detail":"Patient not found"}',
  'String should have at least 8 characters',
  // Keyboard event keys (not text).
  'Enter',
]);

const sources = import.meta.glob(['../**/*.{ts,tsx}', '!../**/*.test.{ts,tsx}', '!../test/**', '!../api/schema.d.ts'], {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

/** Every user-visible string of one source file with its line. */
function uiStrings(file: string, code: string): { line: number; text: string; prose: boolean }[] {
  const sf = ts.createSourceFile(file, code, ts.ScriptTarget.Latest, true, file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const out: { line: number; text: string; prose: boolean }[] = [];
  /** `prose`: JSX text, always shown as is (a lone lower-case word there is not an identifier). */
  const push = (n: ts.Node, text: string, prose = false) => {
    const t = text.trim();
    if (t) out.push({ line: sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1, text: t, prose });
  };
  const visit = (n: ts.Node): void => {
    if (ts.isImportDeclaration(n) || ts.isExportDeclaration(n) || ts.isLiteralTypeNode(n)) return;
    if (ts.isJsxText(n)) push(n, n.text, true);
    else if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) {
      const p = n.parent;
      const isKey = p && (ts.isPropertyAssignment(p) || ts.isPropertySignature(p)) && p.name === n;
      const isIndex = p && ts.isElementAccessExpression(p) && p.argumentExpression === n;
      if (!isKey && !isIndex) push(n, n.text);
    } else if (ts.isTemplateExpression(n)) {
      push(n, [n.head.text, ...n.templateSpans.map((s) => s.literal.text)].join(' '));
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

describe('Spanish-only UI', () => {
  it('scans a meaningful part of the source', () => {
    const files = Object.keys(sources);
    expect(files.length).toBeGreaterThan(80);
    expect(files.some((f) => f.endsWith('routes/EncounterHubView.tsx'))).toBe(true);
    expect(files.some((f) => f.endsWith('routes/admin/AdminUserPage.tsx'))).toBe(true);
  });

  it('the source has no English UI strings (outside the server-contract allowlist)', () => {
    const leftovers: string[] = [];
    for (const [file, code] of Object.entries(sources)) {
      for (const { line, text, prose } of uiStrings(file, code)) {
        if (ALLOWED.has(text)) continue;
        const hit = englishIn(text, prose);
        if (hit) leftovers.push(`${file.replace(/^\.\.\//, 'src/')}:${line} «${hit}» in ${JSON.stringify(text.slice(0, 120))}`);
      }
    }
    expect(leftovers).toEqual([]);
  });

  it('the guard itself catches English (so an empty result means something)', () => {
    const probe = 'export const X = () => <button aria-label="Delete row">Save changes</button>;';
    const found = uiStrings('probe.tsx', probe).map((s) => englishIn(s.text));
    expect(found).toEqual(['Delete', 'Save']);
    expect(englishIn('Guardar cambios')).toBeNull();
    expect(englishIn('No se pudo guardar el caso')).toBeNull();
    expect(englishIn('Export failed: the server could not be reached')).toBe('Export');
    expect(englishIn('could not be saved')).toBe('could not');
    // a lone lower-case word in JSX text is prose, not an identifier
    const option = uiStrings('probe.tsx', 'export const O = () => <option value="">unit</option>;');
    expect(option.map((s) => englishIn(s.text, s.prose))).toEqual(['unit']);
    expect(englishIn('Unidad', true)).toBeNull();
    expect(englishIn('unit')).toBeNull(); // a bare string literal may be an identifier / enum value
  });

  it('index.html is Spanish (lang="es")', () => {
    expect(indexHtml).toMatch(/<html lang="es">/);
  });

  /** All visible text + accessible names of the rendered page. */
  const renderedText = () => {
    const attrs = [...document.body.querySelectorAll('[aria-label], [title], [placeholder]')].flatMap((el) =>
      ['aria-label', 'title', 'placeholder'].map((a) => el.getAttribute(a) ?? ''),
    );
    return [document.body.textContent ?? '', ...attrs].join('\n');
  };

  it.each([
    ['Hub', (id: string) => `/cases/${id}`, 'Datos del caso'],
    ['Datos del paciente', (id: string) => `/cases/${id}/patient`, 'Somatometría'],
    ['Revisión y exportación', (id: string) => `/cases/${id}/review`, 'Documentos'],
    ['Fármacos', (id: string) => `/cases/${id}/drugs`, 'Registro de fármacos'],
    ['Recién nacido', (id: string) => `/cases/${id}/newborn`, 'Sin registros de recién nacido'],
    ['Paciente', (_id: string, pid: string) => `/pacientes/${pid}`, 'Datos del paciente'],
    ['Historias clínicas', () => '/pacientes', 'Historias clínicas'],
  ] as const)('the rendered %s screen has no English', async (_name, path, marker) => {
    const p = fakePatient({ nombre: 'Paciente Sintético Guardia', registro: 'SYN-GUARD', sexo: 'female', edad: 40 });
    const c = newCase('Dr. Sintético', new Date('2026-09-01T08:00:00Z'));
    c.patient_id = p.id;
    c.patient.nombre = p.nombre;
    // a drug row without a unit shows the unit placeholder option
    c.drugs = [{ id: 'aaaaaaaa-0000-4000-8000-00000000d001', label: 'A', farmaco: 'Propofol', dose_value: null, dose_unit: '', via: 'IV', time: null, rust_model_id: null }];
    const h = restHarness([c], { patients: [p] });
    renderApp(path(c.id, p.id), h.backend);
    await screen.findAllByText(marker);
    // Let the async loads (documents, patient detail) settle before reading the page.
    await new Promise((r) => setTimeout(r, 50));
    const text = renderedText();
    const hits = text
      .split('\n')
      .map((l) => [l, englishIn(l, true)] as const)
      .filter(([, hit]) => hit)
      .map(([l, hit]) => `«${hit}» in ${JSON.stringify(l.slice(0, 160))}`);
    expect(hits).toEqual([]);
  });

  afterEach(() => vi.unstubAllGlobals());

  it.each([
    ['Panel', '/admin', 'Casos por día · últimos 30 días (UTC)'],
    ['Casos', '/admin/cases', 'Filtrar casos'],
    ['Usuarios', '/admin/users', 'Nuevo usuario'],
    ['Nuevo usuario', '/admin/users/new', 'Contraseña temporal'],
    ['Documentos', '/admin/documents', 'Todos los formularios'],
    ['Pacientes', '/admin/patients', 'Buscar pacientes'],
    ['Paciente', `/admin/patients/${GUARD_PATIENT.id}`, 'Eliminar paciente'],
    ['Casos de un paciente', `/admin/cases?patient_id=${GUARD_PATIENT.id}`, 'Quitar filtro de paciente'],
    ['Cambiar contraseña', '/change-password', 'Contraseña nueva'],
  ] as const)('the rendered admin %s screen has no English', async (_name, path, marker) => {
    const stats = statsFixture('2026-09-25', { '2026-09-20': 2 }, {
      per_user: [{ user_id: 'u-1', username: 'wf-ana', full_name: 'Dra. Ana Sintetica', drafts: 1, finalized: 1, last_activity: null }],
    });
    const server = fakeAdminServer({ me: ME_ADMIN(), stats, patients: [GUARD_PATIENT] });
    vi.stubGlobal('fetch', server.fetch);
    caseStore.getState().reset();
    signInAs(ME_ADMIN());
    render(
      <MemoryRouter initialEntries={[path]} future={FUTURE}>
        <AppRoutes />
      </MemoryRouter>,
    );
    await screen.findAllByText((_t, el) => !!el && (el.textContent === marker || el.getAttribute('aria-label') === marker));
    await new Promise((r) => setTimeout(r, 50));
    const hits = renderedText()
      .split('\n')
      .map((l) => [l, englishIn(l, true)] as const)
      .filter(([, hit]) => hit)
      .map(([l, hit]) => `«${hit}» in ${JSON.stringify(l.slice(0, 160))}`);
    expect(hits).toEqual([]);
  });
});
