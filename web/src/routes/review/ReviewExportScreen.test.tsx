import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { newCase } from '../../api/factory';
import { InMemoryBackend } from '../../api/inMemoryBackend';
import type { AnesthesiaCase } from '../../api/types';
import { newDrug } from '../../state/drugLedger';
import { caseStore } from '../../state/caseStore';
import { renderApp, restHarness, storeCase, TEST_TOKEN } from '../../test/restHarness';
import { signInAs } from '../../test/auth';
import { AppRoutes } from '../AppRoutes';
import { FUTURE } from '../../test/router';

// jsdom has no blob URLs; stub them and record revocations.
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
afterEach(() => {
  vi.restoreAllMocks();
});

/** Obviously synthetic demo case. */
function demoCase(): AnesthesiaCase {
  const c = newCase('Dr. Demo');
  c.patient.nombre = 'Paciente Demo (sintético)';
  c.patient.registro = 'TEST-0001';
  c.patient.profile = { weight: 80, height: 180, age: 52.9, gender: 'female', dilution: 10 };
  c.diagnostico_preop = 'Dx demo';
  c.operacion_propuesta = 'Procedimiento demo';
  c.pre_assessment.asa = 3;
  c.technique.modality = 'AGEV';
  c.drugs = [newDrug(), newDrug()];
  c.recovery.aldrete = { Actividad: { 'Al salir': 2, '20': 1 }, Conciencia: { 'Al salir': 2 } };
  return c;
}

const valueOf = (label: string) => screen.getByText(label, { selector: '.row__label' }).nextElementSibling;

describe('ReviewExportScreen', () => {
  it('shows the Swift review summary', async () => {
    const c = demoCase();
    renderApp(`/cases/${c.id}/review`, restHarness([c]).backend);
    expect(await screen.findByRole('heading', { name: 'Revisión y exportación', level: 1 })).toBeInTheDocument();
    for (const h of ['Paciente', 'Diagnóstico', 'Técnica anestésica', 'Aldrete (recuperación)', 'Finalizar', 'Documentos']) {
      expect(screen.getByRole('heading', { name: h, level: 2 })).toBeInTheDocument();
    }
    expect(valueOf('Nombre')).toHaveTextContent('Paciente Demo (sintético)');
    expect(valueOf('Registro')).toHaveTextContent('TEST-0001');
    expect(valueOf('Edad')).toHaveTextContent('52 años'); // Int() truncation
    expect(valueOf('Sexo')).toHaveTextContent('F');
    expect(valueOf('Peso / Talla')).toHaveTextContent('80 kg · 180 cm');
    expect(valueOf('IMC')).toHaveTextContent('24.7');
    expect(valueOf('Preoperatorio')).toHaveTextContent('Dx demo');
    expect(valueOf('Postoperatorio')).toHaveTextContent('—');
    expect(valueOf('Operación')).toHaveTextContent('Procedimiento demo');
    expect(valueOf('ASA')).toHaveTextContent('III');
    expect(valueOf('Modalidad')).toHaveTextContent('AGEV');
    expect(valueOf('Fármacos registrados')).toHaveTextContent('2');
    // Aldrete totals: every recorded time point in the form's order (Al salir before 20), missing = 0.
    expect(valueOf('20')).toHaveTextContent('1 / 10');
    expect(valueOf('Al salir')).toHaveTextContent('4 / 10');
    const aldrete = screen.getByRole('heading', { name: 'Aldrete (recuperación)', level: 2 }).closest('section')!;
    expect([...aldrete.querySelectorAll('.row__label')].map((e) => e.textContent)).toEqual(['Al salir', '20']);
    // Form picker: the 4 form_ids with the Swift titles, Registro transanestésico by default.
    const picker = screen.getByLabelText('Formulario');
    expect(picker).toHaveValue('registro_transanestesico');
    expect([...(picker as HTMLSelectElement).options].map((o) => [o.value, o.text])).toEqual([
      ['registro_transanestesico', 'Registro transanestésico'],
      ['nota_postanestesica', 'Nota postanestésica'],
      ['imss_valoracion_preanestesica', 'IMSS · Valoración preanestésica'],
      ['imss_registro_anestesia', 'IMSS · Registro de anestesia'],
    ]);
  });

  it('shows "Sin puntuación de Aldrete registrada" when empty', async () => {
    const c = newCase('Dr. Demo');
    renderApp(`/cases/${c.id}/review`, restHarness([c]).backend);
    expect(await screen.findByText('Sin puntuación de Aldrete registrada')).toBeInTheDocument();
    expect(valueOf('ASA')).toHaveTextContent('—');
    expect(valueOf('Nombre')).toHaveTextContent('—');
  });

  it('generate & store: saves first, POSTs the picked form, lists it, previews inline, revokes blob URLs', async () => {
    const c = demoCase();
    const h = restHarness([c]);
    const user = userEvent.setup();
    const view = renderApp(`/cases/${c.id}/review`, h.backend);
    expect(await screen.findByText('Aún no hay documentos guardados')).toBeInTheDocument();
    // A pending edit must be saved before the form is rendered.
    caseStore.getState().updateCase(c.id, (d) => {
      d.diagnostico_postop = 'Dx post demo';
    });

    await user.selectOptions(screen.getByLabelText('Formulario'), 'nota_postanestesica');
    await user.click(screen.getByRole('button', { name: 'Generar y guardar' }));

    const frame = await screen.findByTitle(/^Nota postanestésica · .* \(PDF\)$/);
    expect(frame.tagName).toBe('IFRAME');
    expect(frame).toHaveAttribute('src', 'blob:test/1');
    expect(h.puts).toHaveLength(1);
    expect(h.puts[0]!.body.diagnostico_postop).toBe('Dx post demo');
    const posts = h.calls.filter((x) => x.method === 'POST');
    expect(posts.map((x) => x.url)).toEqual([`/api/v1/cases/${c.id}/documents`]);
    // PUT before POST.
    const order = h.calls.map((x) => x.method);
    expect(order.indexOf('PUT')).toBeLessThan(order.indexOf('POST'));
    // The file came through the authenticated layer (never a bare link to the API).
    const fileGet = h.calls.find((x) => /\/documents\/[^/]+\/file$/.test(x.url))!;
    expect(h.fetch.mock.calls.find(([u]) => String(u) === fileGet.url)![1]!.headers).toMatchObject({
      Authorization: `Bearer ${TEST_TOKEN}`,
      Accept: 'application/pdf',
    });
    const blob = (URL.createObjectURL as ReturnType<typeof vi.fn>).mock.calls[0]![0] as Blob;
    expect(blob.type).toBe('application/pdf');
    expect(screen.getAllByTestId('document-row')).toHaveLength(1);
    const dl = screen.getByRole('link', { name: 'Descargar PDF' });
    expect(dl).toHaveAttribute('href', 'blob:test/1');
    expect(dl.getAttribute('download')).toMatch(new RegExp(`^nota_postanestesica_${c.id.slice(0, 8)}_\\d+\\.pdf$`));
    expect(screen.queryByRole('alert')).toBeNull();

    // A second generation replaces (and revokes) the first URL.
    await user.selectOptions(screen.getByLabelText('Formulario'), 'imss_registro_anestesia');
    await user.click(screen.getByRole('button', { name: 'Generar y guardar' }));
    expect(await screen.findByTitle(/^IMSS · Registro de anestesia · .* \(PDF\)$/)).toHaveAttribute('src', 'blob:test/2');
    expect(revoked).toEqual(['blob:test/1']);
    expect(screen.getAllByTestId('document-row')).toHaveLength(2);

    // Unmount revokes the live URL.
    view.unmount();
    expect(revoked).toEqual(['blob:test/1', 'blob:test/2']);
  });

  it('shows a readable error when a download fails, and never builds a blob URL for a non-PDF', async () => {
    const c = demoCase();
    let mode: 'http' | 'html' | 'ok' = 'http';
    const h = restHarness([c], {
      fileResponse: () =>
        mode === 'http'
          ? new Response('{"detail":"stored file failed its integrity check"}', { status: 500 })
          : mode === 'html'
            ? new Response('<html>proxy error</html>', { status: 200, headers: { 'Content-Type': 'text/html' } })
            : undefined,
    });
    const user = userEvent.setup();
    renderApp(`/cases/${c.id}/review`, h.backend);
    await user.click(await screen.findByRole('button', { name: 'Generar y guardar' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'No se pudo descargar el PDF: el servidor respondió HTTP 500 — stored file failed its integrity check.',
    );
    mode = 'html';
    await user.click(screen.getByRole('button', { name: /^Ver Registro transanestésico/ }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/text\/html, no un PDF/));
    expect(created).toHaveLength(0);
    mode = 'ok';
    await user.click(screen.getByRole('button', { name: /^Ver Registro transanestésico/ }));
    expect(await screen.findByTitle(/^Registro transanestésico · .* \(PDF\)$/)).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('explains network failures on generate', async () => {
    const c = demoCase();
    const h = restHarness([c]);
    const user = userEvent.setup();
    renderApp(`/cases/${c.id}/review`, h.backend);
    await screen.findByText('Aún no hay documentos guardados');
    h.fetch.mockImplementationOnce(async () => {
      throw new TypeError('Failed to fetch');
    });
    await user.click(screen.getByRole('button', { name: 'Generar y guardar' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/No se pudo generar el formulario: no se pudo conectar con el servidor/);
  });

  it('explains that the offline in-memory store cannot store documents', async () => {
    const c = demoCase();
    caseStore.getState().reset();
    caseStore.getState().setBackend(new InMemoryBackend([c]));
    signInAs();
    render(
      <MemoryRouter initialEntries={[`/cases/${c.id}/review`]} future={FUTURE}>
        <AppRoutes />
      </MemoryRouter>,
    );
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Generar y guardar' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/esta sesión trabaja sin conexión/);
    expect(storeCase(c.id).id).toBe(c.id);
  });
});

describe('Finalizar', () => {
  it('in-page confirm → saves pending edits → finalizes → read-only everywhere + the 4 stored documents', async () => {
    const c = demoCase();
    const h = restHarness([c]);
    const user = userEvent.setup();
    renderApp(`/cases/${c.id}/review`, h.backend);
    await screen.findByText('Aún no hay documentos guardados');
    caseStore.getState().updateCase(c.id, (d) => {
      d.observaciones = 'nota final';
    });

    // Cancel sends nothing.
    await user.click(screen.getByRole('button', { name: 'Finalizar caso…' }));
    expect(screen.getByRole('group', { name: 'Confirmar finalización' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(h.calls.some((x) => x.url.endsWith('/finalize'))).toBe(false);

    await user.click(screen.getByRole('button', { name: 'Finalizar caso…' }));
    await user.click(screen.getByRole('button', { name: 'Finalizar y bloquear' }));

    expect(await screen.findByTestId('readonly-banner')).toHaveTextContent('Caso finalizado — solo lectura');
    expect(h.puts).toHaveLength(1);
    expect(h.puts[0]!.body.observaciones).toBe('nota final');
    const order = h.calls.map((x) => `${x.method} ${x.url.replace(c.id, 'ID')}`);
    expect(order.indexOf('PUT /api/v1/cases/ID')).toBeLessThan(order.indexOf('POST /api/v1/cases/ID/finalize'));
    expect(storeCase(c.id).status).toBe('finalized');
    expect(screen.getByText('Finalizado', { selector: '.status-badge' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Finalizar caso…' })).toBeNull();
    expect(screen.getByRole('heading', { name: 'Estado del caso', level: 2 })).toBeInTheDocument();
    // The 4 stored forms, in the form order, and no delete for the owner of a finalized case.
    await waitFor(() => expect(screen.getAllByTestId('document-row')).toHaveLength(4));
    expect([...document.querySelectorAll('.doc-group')].map((g) => g.getAttribute('data-form-id'))).toEqual([
      'registro_transanestesico',
      'nota_postanestesica',
      'imss_valoracion_preanestesica',
      'imss_registro_anestesia',
    ]);
    expect(screen.queryByRole('button', { name: /^Eliminar / })).toBeNull();
    // Save is disabled and edits are refused by the store.
    expect(screen.getByRole('button', { name: 'Guardar' })).toBeDisabled();
    expect(caseStore.getState().updateCase(c.id, (d) => void (d.observaciones = 'x'))).toBe(false);
  });

  it('409 "case changed during finalize" → readable message, reload, still a draft', async () => {
    const c = demoCase();
    const h = restHarness([c], {
      finalizeResponse: () => Response.json({ detail: 'case changed during finalize; retry' }, { status: 409 }),
    });
    const user = userEvent.setup();
    renderApp(`/cases/${c.id}/review`, h.backend);
    await user.click(await screen.findByRole('button', { name: 'Finalizar caso…' }));
    const gets = () => h.calls.filter((x) => x.method === 'GET' && x.url === `/api/v1/cases/${c.id}`).length;
    const before = gets();
    await user.click(screen.getByRole('button', { name: 'Finalizar y bloquear' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'El caso cambió mientras se guardaban sus formularios, así que no se bloqueó.',
    );
    expect(gets()).toBe(before + 1); // reloaded
    expect(storeCase(c.id).status).toBe('draft');
    expect(screen.queryByTestId('readonly-banner')).toBeNull();
  });

  it('409 "case is finalized" (locked elsewhere) → message, reload shows the locked case', async () => {
    const c = demoCase();
    const h = restHarness([c], {
      finalizeResponse: (id) => {
        h.server.set(id, { ...(h.server.get(id) as AnesthesiaCase), status: 'finalized' });
        return Response.json({ detail: 'case is finalized' }, { status: 409 });
      },
    });
    const user = userEvent.setup();
    renderApp(`/cases/${c.id}/review`, h.backend);
    await user.click(await screen.findByRole('button', { name: 'Finalizar caso…' }));
    await user.click(screen.getByRole('button', { name: 'Finalizar y bloquear' }));
    expect(await screen.findByTestId('readonly-banner')).toBeInTheDocument();
    expect(storeCase(c.id).status).toBe('finalized');
  });

  it('a save answered 409 (finalized in another tab) explains it and reloads the locked case', async () => {
    const c = demoCase();
    const h = restHarness([c]);
    const user = userEvent.setup();
    renderApp(`/cases/${c.id}/patient`, h.backend);
    const cama = await screen.findByLabelText('Cama');
    h.server.set(c.id, { ...(h.server.get(c.id) as AnesthesiaCase), status: 'finalized' });
    await user.type(cama, 'X');
    await user.click(screen.getByRole('button', { name: 'Guardar' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/Este caso se finalizó y ahora es de solo lectura/);
    expect(screen.getByTestId('readonly-banner')).toBeInTheDocument();
    expect(screen.getByLabelText('Cama')).toBeDisabled();
    expect(screen.getByLabelText('Cama')).toHaveValue('');
    await user.click(screen.getByRole('button', { name: 'Descartar' }));
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
