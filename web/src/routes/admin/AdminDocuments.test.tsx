import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeUser } from '../../api/authApi';
import { FORM_IDS, type AdminDocumentDTO } from '../../api/types';
import { caseStore } from '../../state/caseStore';
import { signInAs, TEST_TOKEN } from '../../test/auth';
import { adminDocument, fakeAdminServer, ME_ADMIN } from '../../test/fakeAdminServer';
import { FUTURE } from '../../test/router';
import { AppRoutes } from '../AppRoutes';
import { storageInfo, storageLabel } from '../../state/documents';

const CASE_A = 'a0a0a0a0-0000-4000-8000-00000000000a';
const CASE_B = 'b0b0b0b0-0000-4000-8000-00000000000b';
const ANA = fakeUser({ id: 'u-ana', username: 'wf-ana', full_name: 'Dra. Ana Sintetica' });

/** `n` synthetic documents, one minute apart, cycling through the forms and two cases. */
function docs(n: number): AdminDocumentDTO[] {
  return Array.from({ length: n }, (_, i) =>
    adminDocument(i % 2 ? CASE_B : CASE_A, FORM_IDS[i % FORM_IDS.length]!, {
      id: `dddddddd-0000-4000-8000-${String(i + 1).padStart(12, '0')}`,
      created_at: new Date(Date.parse('2026-09-25T12:00:00Z') - i * 60_000).toISOString(),
      generated_by: i === 0 ? 'u-ana' : null,
      is_fallback: i === 1,
    }),
  );
}

function LocationProbe() {
  const l = useLocation();
  return <output data-testid="location">{l.pathname + l.search}</output>;
}
const searchParams = () =>
  new URLSearchParams((screen.getByTestId('location').textContent ?? '').split('?')[1] ?? '');

function setup(path: string, documents: AdminDocumentDTO[]) {
  const server = fakeAdminServer({ me: ME_ADMIN(), users: [ANA], documents });
  vi.stubGlobal('fetch', server.fetch);
  caseStore.getState().reset();
  signInAs(ME_ADMIN());
  const user = userEvent.setup();
  const view = render(
    <MemoryRouter initialEntries={[path]} future={FUTURE}>
      <AppRoutes />
      <LocationProbe />
    </MemoryRouter>,
  );
  return { server, user, view, listCalls: () => server.callsTo('GET', '/admin/documents') };
}

let urlSeq = 0;
const revoked: string[] = [];
beforeEach(() => {
  urlSeq = 0;
  revoked.length = 0;
  Object.assign(URL, {
    createObjectURL: vi.fn(() => `blob:test/${++urlSeq}`),
    revokeObjectURL: vi.fn((u: string) => void revoked.push(u)),
  });
});
afterEach(() => vi.unstubAllGlobals());

describe('Admin documents', () => {
  it('lists newest first with form, case link, stored-by, size, storage path and the fallback flag', async () => {
    setup('/admin/documents', docs(3));
    const rows = await screen.findAllByTestId('document-row');
    expect(rows.map((r) => r.getAttribute('data-doc-id'))).toEqual([
      'dddddddd-0000-4000-8000-000000000001',
      'dddddddd-0000-4000-8000-000000000002',
      'dddddddd-0000-4000-8000-000000000003',
    ]);
    expect(screen.getByText('3 documents')).toBeInTheDocument();
    expect(within(rows[0]!).getByRole('link', { name: CASE_A.slice(0, 8) })).toHaveAttribute(
      'href',
      `/admin/cases/${CASE_A}`,
    );
    expect(rows[0]).toHaveTextContent('Dra. Ana Sintetica');
    expect(rows[0]).toHaveTextContent('4 KB');
    // Only the base name is printed; the full server path is in the tooltip.
    const storage = within(rows[0]!).getByTestId('document-storage');
    expect(storage).toHaveTextContent(/^Local file · \S+\.pdf$/);
    expect(storage).not.toHaveTextContent('/var/documents');
    expect(storage.getAttribute('title')).toMatch(new RegExp(`^/var/documents/${CASE_A}/`));
    expect(rows[1]).toHaveTextContent('summary fallback');
    expect(rows[0]).not.toHaveTextContent('summary fallback');
  });

  it('storage label: local path, database backend, or an older server without storage_backend', () => {
    expect(storageLabel({ storage_path: '/x/a.pdf', storage_backend: 'local' })).toBe('Local file · a.pdf');
    expect(storageInfo({ storage_path: '/x/a.pdf', storage_backend: 'local' }).title).toBe('/x/a.pdf');
    expect(storageLabel({ storage_path: null, storage_backend: 'db' })).toBe('Stored in the database');
    expect(storageLabel({ storage_backend: 'db' } as Parameters<typeof storageLabel>[0])).toBe('Stored in the database');
    expect(storageLabel({ storage_path: '/x/b.pdf' })).toBe('Local file · b.pdf');
    expect(storageLabel({ storage_path: null })).toBe('—');
  });

  it('a database-stored document (storage_backend "db", no path) renders without a path', async () => {
    const [d] = docs(1);
    setup('/admin/documents', [{ ...d!, storage_backend: 'db', storage_path: null }]);
    const [row] = await screen.findAllByTestId('document-row');
    expect(within(row!).getByTestId('document-storage')).toHaveTextContent('Stored in the database');
  });

  it('reads form and case filters from the URL (the case page links here with ?case_id=)', async () => {
    const { listCalls } = setup(`/admin/documents?form_id=nota_postanestesica&case_id=${CASE_B}&page=2`, docs(12));
    // 3 of the 12 are that form on case B: page 2 is past the end.
    expect(await screen.findByText('This page is empty')).toBeInTheDocument();
    expect(listCalls().at(-1)!.query).toEqual({
      form_id: 'nota_postanestesica',
      case_id: CASE_B,
      limit: '25',
      offset: '25',
    });
    expect(screen.getByLabelText('Form')).toHaveValue('nota_postanestesica');
    expect(screen.getByLabelText('Case id')).toHaveValue(CASE_B);
  });

  it('writes filter changes to the URL, resets the page and re-queries', async () => {
    const { user, listCalls } = setup('/admin/documents?page=2', docs(30));
    await screen.findAllByTestId('document-row');
    await user.selectOptions(screen.getByLabelText('Form'), 'imss_registro_anestesia');
    await waitFor(() => expect(searchParams().get('form_id')).toBe('imss_registro_anestesia'));
    expect(searchParams().get('page')).toBeNull();
    await waitFor(() => expect(listCalls().at(-1)!.query).toMatchObject({ form_id: 'imss_registro_anestesia', offset: '0' }));
    const rows = await screen.findAllByTestId('document-row');
    expect(rows.every((r) => r.textContent?.includes('IMSS') || r.textContent?.includes('Registro'))).toBe(true);

    await user.type(screen.getByLabelText('Case id'), CASE_A);
    await waitFor(() => expect(searchParams().get('case_id')).toBe(CASE_A));
    await waitFor(() => expect(listCalls().at(-1)!.query.case_id).toBe(CASE_A));
  });

  it('a malformed case id is flagged on the field and never sent (the server would 422)', async () => {
    const { user, listCalls } = setup('/admin/documents', docs(2));
    await screen.findAllByTestId('document-row');
    const before = listCalls().length;
    const box = screen.getByLabelText('Case id');
    await user.type(box, 'not-a-uuid');
    expect(box).toHaveAttribute('aria-invalid', 'true');
    expect(box).toHaveAccessibleDescription('Paste a full case id (a UUID).');
    expect(await screen.findByText('Not a case id')).toBeInTheDocument();
    expect(listCalls().filter((c) => c.query.case_id)).toHaveLength(0);
    expect(listCalls().length).toBe(before);
  });

  it('paginates with Previous / Next', async () => {
    const { user, listCalls } = setup('/admin/documents', docs(30));
    expect(await screen.findAllByTestId('document-row')).toHaveLength(25);
    const nav = screen.getByRole('navigation', { name: 'Document pages' });
    expect(nav).toHaveTextContent('1–25 of 30 · Page 1 of 2');
    await user.click(within(nav).getByRole('button', { name: 'Next ›' }));
    await waitFor(() => expect(searchParams().get('page')).toBe('2'));
    await waitFor(() => expect(screen.getAllByTestId('document-row')).toHaveLength(5));
    expect(listCalls().at(-1)!.query.offset).toBe('25');
    expect(screen.getByRole('navigation', { name: 'Document pages' })).toHaveTextContent('26–30 of 30 · Page 2 of 2');
    expect(screen.getByRole('button', { name: 'Next ›' })).toBeDisabled();
  });

  it('Open downloads through the authenticated layer into a blob URL, revoked on replace, close and unmount', async () => {
    const { server, user, view } = setup('/admin/documents', docs(2));
    const rows = await screen.findAllByTestId('document-row');
    await user.click(within(rows[0]!).getByRole('button', { name: /^Open / }));
    const dl = await screen.findByRole('link', { name: 'Download PDF' });
    expect(dl).toHaveAttribute('href', 'blob:test/1');
    expect(dl.getAttribute('download')).toMatch(/^registro_transanestesico_a0a0a0a0_\d+\.pdf$/);
    expect(document.querySelector('iframe')).toHaveAttribute('src', 'blob:test/1');
    const fileCall = server.fetch.mock.calls.find(([u]) => String(u).endsWith('/documents/dddddddd-0000-4000-8000-000000000001/file'))!;
    expect(new Headers(fileCall[1]?.headers).get('Authorization')).toBe(`Bearer ${TEST_TOKEN}`);
    // No bare link to the API anywhere on the page.
    expect(document.querySelector('a[href*="/api/v1/"]')).toBeNull();

    await user.click(within(rows[1]!).getByRole('button', { name: /^Open / }));
    await waitFor(() => expect(screen.getByRole('link', { name: 'Download PDF' })).toHaveAttribute('href', 'blob:test/2'));
    expect(revoked).toEqual(['blob:test/1']);
    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(revoked).toEqual(['blob:test/1', 'blob:test/2']);

    await user.click(within(rows[0]!).getByRole('button', { name: /^Open / }));
    await screen.findByRole('link', { name: 'Download PDF' });
    view.unmount();
    expect(revoked).toEqual(['blob:test/1', 'blob:test/2', 'blob:test/3']);
  });

  it('a failed download explains and creates no blob URL', async () => {
    const { server, user } = setup('/admin/documents', docs(1));
    server.override('GET /documents/dddddddd-0000-4000-8000-000000000001/file', () =>
      Response.json({ detail: 'Document not found' }, { status: 404 }),
    );
    const [row] = await screen.findAllByTestId('document-row');
    await user.click(within(row!).getByRole('button', { name: /^Open / }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/Download failed/);
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });

  it('empty and error states', async () => {
    const { server, user } = setup('/admin/documents', []);
    expect(await screen.findByText('No stored documents yet')).toBeInTheDocument();
    server.override('GET /admin/documents', () => Response.json({ detail: 'boom' }, { status: 500 }));
    await user.selectOptions(screen.getByLabelText('Form'), 'nota_postanestesica');
    expect(await screen.findByText(/Couldn’t refresh: boom/)).toBeInTheDocument();
    server.clearOverride('GET /admin/documents');
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('No matching documents')).toBeInTheDocument();
  });
});
