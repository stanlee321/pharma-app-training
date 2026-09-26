import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { newCase } from '../../api/factory';
import type { CaseStatus, DocumentDTO, UserRole } from '../../api/types';
import { caseStore } from '../../state/caseStore';
import { canDeleteDocuments, groupDocuments } from '../../state/documents';
import { signInAs } from '../../test/auth';
import { fakeDocument, restHarness } from '../../test/restHarness';
import { DocumentsPanel } from './DocumentsPanel';

let urlSeq = 0;
const created: string[] = [];
const revoked: string[] = [];
beforeEach(() => {
  urlSeq = 0;
  created.length = 0;
  revoked.length = 0;
  Object.assign(URL, {
    createObjectURL: vi.fn(() => {
      const u = `blob:test/${++urlSeq}`;
      created.push(u);
      return u;
    }),
    revokeObjectURL: vi.fn((u: string) => {
      revoked.push(u);
    }),
  });
});
afterEach(() => vi.restoreAllMocks());

/** Several versions of two forms, deliberately NOT in newest-first or form order. */
function seedDocs(caseId: string): DocumentDTO[] {
  return [
    fakeDocument(caseId, 'imss_registro_anestesia', 30),
    fakeDocument(caseId, 'registro_transanestesico', 120),
    fakeDocument(caseId, 'registro_transanestesico', 5, { is_fallback: true }),
    fakeDocument(caseId, 'registro_transanestesico', 60),
  ];
}

function setup(status: CaseStatus, role: UserRole) {
  const c = newCase('Dr. Demo');
  c.status = status;
  const docs = seedDocs(c.id);
  const h = restHarness([c], { documents: docs, role });
  caseStore.getState().reset();
  caseStore.getState().setBackend(h.backend);
  signInAs({ role });
  const view = render(<DocumentsPanel caseId={c.id} status={status} />);
  return { c, h, docs, view };
}

describe('groupDocuments', () => {
  it('orders groups by the known form order and versions newest first, whatever the server order', () => {
    const docs = seedDocs('c1');
    const shuffled = [docs[2]!, docs[0]!, docs[3]!, docs[1]!];
    const groups = groupDocuments(shuffled);
    expect(groups.map((g) => g.formId)).toEqual(['registro_transanestesico', 'imss_registro_anestesia']);
    expect(groups[0]!.latest.id).toBe(docs[2]!.id); // 5 min ago
    expect(groups[0]!.older.map((d) => d.id)).toEqual([docs[3]!.id, docs[1]!.id]); // 60, 120
    expect(groups[1]!.older).toEqual([]);
  });

  it('delete rule: admin always; the owner only while the case is a draft', () => {
    expect(canDeleteDocuments({ role: 'admin' }, 'finalized')).toBe(true);
    expect(canDeleteDocuments({ role: 'anesthesiologist' }, 'draft')).toBe(true);
    expect(canDeleteDocuments({ role: 'anesthesiologist' }, 'finalized')).toBe(false);
    expect(canDeleteDocuments(null, 'draft')).toBe(false);
  });
});

describe('DocumentsPanel', () => {
  it('lists the latest per form with older versions expandable', async () => {
    const { docs } = setup('draft', 'anesthesiologist');
    await waitFor(() => expect(screen.getAllByTestId('document-row')).toHaveLength(4));
    const groups = [...document.querySelectorAll<HTMLElement>('.doc-group')];
    expect(groups.map((g) => g.getAttribute('aria-label'))).toEqual(['Registro transanestésico', 'IMSS · Registro de anestesia']);
    const first = groups[0]!;
    // Latest row first (outside <details>), flagged as a fallback.
    const latest = first.querySelector(':scope > [data-testid="document-row"]')!;
    expect(latest.getAttribute('data-doc-id')).toBe(docs[2]!.id);
    expect(latest).toHaveTextContent('resumen de respaldo');
    const older = first.querySelector('details')!;
    expect(older.open).toBe(false);
    expect(within(first).getByText('Versiones anteriores (2)')).toBeInTheDocument();
    expect([...older.querySelectorAll('[data-testid="document-row"]')].map((r) => r.getAttribute('data-doc-id'))).toEqual([
      docs[3]!.id,
      docs[1]!.id,
    ]);
  });

  it('View downloads through the authenticated layer into a blob URL, revoked on close and on unmount', async () => {
    const { h, docs, view } = setup('finalized', 'anesthesiologist');
    const user = userEvent.setup();
    await waitFor(() => expect(screen.getAllByTestId('document-row')).toHaveLength(4));
    const viewButtons = screen.getAllByRole('button', { name: /^Ver / });

    await user.click(viewButtons[0]!);
    const frame = await screen.findByTitle(/\(PDF\)$/);
    expect(frame).toHaveAttribute('src', 'blob:test/1');
    expect(h.calls.at(-1)).toEqual({ method: 'GET', url: `/api/v1/documents/${docs[2]!.id}/file` });
    expect(screen.getByRole('link', { name: 'Descargar PDF' })).toHaveAttribute('href', 'blob:test/1');

    await user.click(screen.getByRole('button', { name: 'Cerrar' }));
    expect(screen.queryByTitle(/\(PDF\)$/)).toBeNull();
    expect(revoked).toEqual(['blob:test/1']);

    await user.click(viewButtons[1]!);
    await screen.findByTitle(/\(PDF\)$/);
    expect(created).toEqual(['blob:test/1', 'blob:test/2']);
    view.unmount();
    expect(revoked).toEqual(['blob:test/1', 'blob:test/2']);
  });

  it('owner of a draft: delete (in-page confirm) removes the row and closes its preview', async () => {
    const { h, docs } = setup('draft', 'anesthesiologist');
    const user = userEvent.setup();
    await waitFor(() => expect(screen.getAllByTestId('document-row')).toHaveLength(4));
    await user.click(screen.getAllByRole('button', { name: /^Ver / })[0]!);
    await screen.findByTitle(/\(PDF\)$/);

    const del = screen.getAllByRole('button', { name: /^Eliminar Registro transanestésico/ })[0]!;
    await user.click(del);
    await user.click(screen.getByRole('button', { name: 'Eliminar' }));
    await waitFor(() => expect(screen.getAllByTestId('document-row')).toHaveLength(3));
    expect(h.calls.some((c) => c.method === 'DELETE' && c.url === `/api/v1/documents/${docs[2]!.id}`)).toBe(true);
    expect(screen.queryByTitle(/\(PDF\)$/)).toBeNull();
    expect(revoked).toEqual(['blob:test/1']);
  });

  it('owner of a finalized case: no delete', async () => {
    setup('finalized', 'anesthesiologist');
    await waitFor(() => expect(screen.getAllByTestId('document-row')).toHaveLength(4));
    expect(screen.queryByRole('button', { name: /^Eliminar / })).toBeNull();
    // Generating a new version is still allowed.
    expect(screen.getByRole('button', { name: 'Generar y guardar' })).toBeEnabled();
  });

  it('admin of a finalized case: may delete', async () => {
    const { h } = setup('finalized', 'admin');
    const user = userEvent.setup();
    await waitFor(() => expect(screen.getAllByTestId('document-row')).toHaveLength(4));
    const dels = screen.getAllByRole('button', { name: /^Eliminar / });
    expect(dels).toHaveLength(4);
    await user.click(dels[3]!);
    await user.click(screen.getByRole('button', { name: 'Eliminar' }));
    await waitFor(() => expect(screen.getAllByTestId('document-row')).toHaveLength(3));
    expect(h.calls.filter((c) => c.method === 'DELETE')).toHaveLength(1);
  });

  it('a refused delete (409) shows the reason and re-reads the list', async () => {
    const { h } = setup('draft', 'anesthesiologist');
    const user = userEvent.setup();
    await waitFor(() => expect(screen.getAllByTestId('document-row')).toHaveLength(4));
    // The case was finalized meanwhile (server side).
    for (const [id, c] of h.server) h.server.set(id, { ...(c as object), status: 'finalized' });
    await user.click(screen.getAllByRole('button', { name: /^Eliminar / })[0]!);
    await user.click(screen.getByRole('button', { name: 'Eliminar' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo eliminar el documento: el servidor respondió HTTP 409 — El caso está finalizado y es de solo lectura..');
    expect(screen.getAllByTestId('document-row')).toHaveLength(4);
  });
});
