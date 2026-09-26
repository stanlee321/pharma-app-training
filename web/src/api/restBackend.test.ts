import { describe, expect, it, vi } from 'vitest';
import { BackendError } from './backend';
import { newCase } from './factory';
import { RestBackend } from './restBackend';

const TOKEN = 'tok-123';
const BEARER = `Bearer ${TOKEN}`;

function mockFetch(respond: (url: string, init: RequestInit) => Response | Promise<Response>) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => respond(String(input), init ?? {}));
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const headersOf = (init: RequestInit) => new Headers(init.headers);

describe('RestBackend', () => {
  it('GET /cases → list shells, with the Bearer token', async () => {
    const f = mockFetch(() =>
      json([
        {
          id: 'aaaaaaaa-0000-4000-8000-000000000001',
          owner: 'Dr. Demo',
          nombre: 'Paciente Sintético',
          diagnostico_preop: 'Dx demo',
          created_at: '2026-01-01T00:00:00Z',
        },
      ]),
    );
    const b = new RestBackend({ baseUrl: () => '/api/v1', token: () => TOKEN, fetch: f });
    const list = await b.list();
    const [url, init] = f.mock.calls[0]!;
    expect(url).toBe('/api/v1/cases');
    expect(init?.method).toBe('GET');
    expect(headersOf(init!).get('Authorization')).toBe(BEARER);
    expect(headersOf(init!).has('X-User-Id')).toBe(false);
    expect(list).toHaveLength(1);
    expect(list[0]!.patient.nombre).toBe('Paciente Sintético');
    expect(list[0]!.diagnostico_preop).toBe('Dx demo');
    expect(list[0]!.drugs).toEqual([]);
  });

  it('PUT /cases/{id} sends the full snake_case aggregate and normalizes the reply', async () => {
    const c = newCase('Dr. Demo');
    c.diagnostico_preop = 'Dx demo';
    c.patient.grupo_sanguineo = 'O';
    c.pre_assessment.via_aerea = 'normal';
    const f = mockFetch((_url, init) => {
      const body = JSON.parse(String(init.body));
      // Server echoes the body plus derivations; omit some fields to test normalization.
      delete body.newborns;
      body.patient.imc = 24.2;
      return json(body);
    });
    const b = new RestBackend({ baseUrl: () => 'http://host:8000/api/v1/', token: () => TOKEN, fetch: f });
    const saved = await b.save(c);

    const [url, init] = f.mock.calls[0]!;
    expect(url).toBe(`http://host:8000/api/v1/cases/${c.id}`);
    expect(init?.method).toBe('PUT');
    const h = headersOf(init!);
    expect(h.get('Content-Type')).toBe('application/json');
    expect(h.get('Authorization')).toBe(BEARER);
    const sent = JSON.parse(String(init!.body));
    expect(sent.id).toBe(c.id);
    expect(sent.diagnostico_preop).toBe('Dx demo');
    expect(sent.patient.grupo_sanguineo).toBe('O');
    expect(sent.pre_assessment.via_aerea).toBe('normal');
    expect(sent.trans_record).toBeDefined();
    expect(sent.fluid_balance).toBeDefined();
    expect(Object.keys(sent).some((k) => /[A-Z]/.test(k))).toBe(false);

    expect(saved.patient.imc).toBe(24.2);
    expect(saved.newborns).toEqual([]);
  });

  it('GET /cases/{id}, DELETE and POST export hit the right URLs', async () => {
    const c = newCase('x');
    const f = mockFetch((url, init) => {
      if (init.method === 'DELETE') return new Response(null, { status: 204 });
      if (url.endsWith('/export/nota_postanestesica'))
        return new Response(new Uint8Array([37, 80, 68, 70]), { headers: { 'Content-Type': 'application/pdf' } });
      return json(c);
    });
    const b = new RestBackend({ baseUrl: () => '/api/v1', token: () => TOKEN, fetch: f });
    const loaded = await b.load(c.id);
    expect(loaded.id).toBe(c.id);
    await b.delete(c.id);
    const pdf = await b.exportForm(c.id, 'nota_postanestesica');
    expect(pdf.size).toBe(4);
    expect(f.mock.calls.map(([u, i]) => `${i?.method} ${u}`)).toEqual([
      `GET /api/v1/cases/${c.id}`,
      `DELETE /api/v1/cases/${c.id}`,
      `POST /api/v1/cases/${c.id}/export/nota_postanestesica`,
    ]);
  });

  it('omits Authorization when signed out', async () => {
    const f = mockFetch(() => json([]));
    await new RestBackend({ baseUrl: () => '/api/v1', token: () => null, fetch: f }).list();
    expect(headersOf(f.mock.calls[0]![1]!).has('Authorization')).toBe(false);
  });

  it('PUT omits the server-owned lifecycle fields', async () => {
    const c = newCase('x');
    c.status = 'finalized';
    const f = mockFetch((_u, init) => json(JSON.parse(String(init.body))));
    await new RestBackend({ baseUrl: () => '/api/v1', token: () => TOKEN, fetch: f }).save(c);
    const sent = JSON.parse(String(f.mock.calls[0]![1]!.body));
    for (const k of ['status', 'updated_at', 'finalized_at', 'user_id']) expect(sent).not.toHaveProperty(k);
  });

  it('non-2xx → BackendError with status and body', async () => {
    const f = mockFetch(() => new Response('{"detail":"Case not found"}', { status: 404 }));
    const b = new RestBackend({ baseUrl: () => '/api/v1', token: () => TOKEN, fetch: f });
    const err = await b.load('nope').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(BackendError);
    expect((err as BackendError).status).toBe(404);
    expect((err as BackendError).kind).toBe('notFound');
    expect((err as BackendError).body).toContain('Case not found');
    expect((err as BackendError).detail).toBe('Case not found');

    const f500 = mockFetch(() => new Response('boom', { status: 500 }));
    const e500 = await new RestBackend({ baseUrl: () => '/api/v1', fetch: f500 }).list().catch((e: unknown) => e);
    expect((e500 as BackendError).kind).toBe('http');
    expect((e500 as BackendError).status).toBe(500);
  });

  it('network failure → BackendError(kind=network, status=null)', async () => {
    const f = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });
    const err = await new RestBackend({ baseUrl: () => '/api/v1', fetch: f }).list().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(BackendError);
    expect((err as BackendError).kind).toBe('network');
    expect((err as BackendError).status).toBeNull();
  });

  it('reads the base URL from localStorage by default', async () => {
    window.localStorage.setItem('backend_base_url', 'http://10.0.0.5:8000/api/v1');
    const f = mockFetch(() => json([]));
    await new RestBackend({ fetch: f, token: () => TOKEN }).list();
    const [url, init] = f.mock.calls[0]!;
    expect(url).toBe('http://10.0.0.5:8000/api/v1/cases');
    expect(headersOf(init!).get('Authorization')).toBe(BEARER);
  });
});
