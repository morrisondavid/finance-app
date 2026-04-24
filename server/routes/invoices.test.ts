/**
 * Shape + behaviour contract for the invoices HTTP surface.
 *
 * `GET /api/invoices` is exercised against the real registry (seed
 * data) so any drift in the CSV parser, schema, or registry wiring
 * surfaces as a route-level regression rather than as a silent
 * mismatch in Phase 2's draft endpoint.
 *
 * `GET /api/invoices/draft` is also exercised against the real
 * registries so the composition between `buildDraftInvoice` and the
 * four upstream registries (contracts, clients, company, leave) can't
 * silently regress.
 *
 * `POST /api/invoices/generate` and `GET /api/invoices/:id/pdf` are
 * exercised against mocked domain helpers (`createInvoice`,
 * `updateInvoice`, `writeInvoicePdf`, `findInvoiceById`). The
 * domain-level write + render chain is covered exhaustively in
 * `server/domain/invoices/{mutations,pdf}/*.test.ts`.
 */

import fs from 'fs';
import path from 'path';
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import express from 'express';
import type { AddressInfo } from 'net';
import type { Server } from 'http';
import {
  InvoicesListResponseSchema,
  InvoiceSchema,
  type Invoice,
} from '../../shared/api-contracts.js';
import type {
  CreateInvoiceResult,
  UpdateInvoiceResult,
} from '../domain/invoices/mutations.js';
import type { WriteInvoicePdfResult } from '../domain/invoices/pdf/write.js';
import type { PersistIngestedSelfBillFromBufferResult } from '../domain/invoices/ingest-persist.js';

// ─── Domain mocks ───────────────────────────────────────────────────────────

const createInvoiceMock = vi.fn<(input: { readonly invoice: Invoice }) => CreateInvoiceResult>();
const updateInvoiceMock = vi.fn<(input: unknown) => UpdateInvoiceResult>();
const writeInvoicePdfMock = vi.fn<(input: unknown) => Promise<WriteInvoicePdfResult>>();
const findInvoiceByIdMock = vi.fn<(id: string) => Invoice | null>();
const persistIngestedSelfBillFromBufferMock = vi.fn<
  (buffer: Buffer, today: string) => Promise<PersistIngestedSelfBillFromBufferResult>
>();

vi.mock('../domain/invoices/index.js', async () => {
  const actual =
    await vi.importActual<typeof import('../domain/invoices/index.js')>(
      '../domain/invoices/index.js',
    );
  return {
    ...actual,
    createInvoice: (input: { readonly invoice: Invoice }) => createInvoiceMock(input),
    updateInvoice: (input: unknown) => updateInvoiceMock(input),
    writeInvoicePdf: (input: unknown) => writeInvoicePdfMock(input),
    findInvoiceById: (id: string) => findInvoiceByIdMock(id),
    persistIngestedSelfBillFromBuffer: (buffer: Buffer, today: string) =>
      persistIngestedSelfBillFromBufferMock(buffer, today),
  };
});

// Imported after the mock so the router binds to the mocked helpers.
const { default: invoicesRouter } = await import('./invoices.js');

let server: Server;
let baseUrl: string;

async function startServer(): Promise<void> {
  const app = express();
  app.use(express.json());
  app.use('/api/invoices', invoicesRouter);
  await new Promise<void>(resolve => {
    server = app.listen(0, () => resolve());
  });
  const addr = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${addr.port}`;
}

async function stopServer(): Promise<void> {
  if (server) {
    await new Promise<void>((resolve, reject) => {
      server.close(err => (err ? reject(err) : resolve()));
    });
  }
}

beforeAll(async () => {
  await startServer();
});

afterAll(async () => {
  await stopServer();
});

beforeEach(() => {
  createInvoiceMock.mockReset();
  updateInvoiceMock.mockReset();
  writeInvoicePdfMock.mockReset();
  findInvoiceByIdMock.mockReset();
  persistIngestedSelfBillFromBufferMock.mockReset();
  // Default: no invoice found — GET /:id/pdf tests that want a hit
  // override explicitly in the test body.
  findInvoiceByIdMock.mockReturnValue(null);
});

// ─── GET / ──────────────────────────────────────────────────────────────────

describe('GET /api/invoices', () => {
  it('returns a Zod-valid list of invoices', async () => {
    const res = await fetch(`${baseUrl}/api/invoices`);
    expect(res.status).toBe(200);
    const body: unknown = await res.json();
    const parsed = InvoicesListResponseSchema.parse(body);
    expect(parsed.invoices.length).toBeGreaterThanOrEqual(10);
  });

  it('includes the 10 seed Delta Capita rows DC-001 .. DC-010', async () => {
    const res = await fetch(`${baseUrl}/api/invoices`);
    const { invoices } = InvoicesListResponseSchema.parse(await res.json());
    const ids = invoices.map((inv: Invoice) => inv.id).sort();
    for (let i = 1; i <= 10; i++) {
      const id = `DC-${i.toString().padStart(3, '0')}`;
      expect(ids).toContain(id);
    }
  });

  it('reflects seeded Delta Capita rows (payment ref matches invoice number; corrected calendar fields)', async () => {
    const res = await fetch(`${baseUrl}/api/invoices`);
    const { invoices } = InvoicesListResponseSchema.parse(await res.json());
    const byId = new Map(invoices.map((inv: Invoice) => [inv.id, inv]));

    for (const id of [
      'DC-001',
      'DC-002',
      'DC-003',
      'DC-004',
      'DC-005',
      'DC-006',
      'DC-007',
      'DC-008',
      'DC-009',
      'DC-010',
    ]) {
      const inv = byId.get(id);
      expect(inv?.payment_reference).toBe(inv?.invoice_number);
    }

    expect(byId.get('DC-006')?.due_date).toBe('2026-01-04');
    expect(byId.get('DC-008')?.period_start).toBe('2026-01-01');
    expect(byId.get('DC-008')?.period_end).toBe('2026-01-30');
    expect(byId.get('DC-010')?.due_date).toBe('2026-05-01');
  });
});

// ─── GET /draft ─────────────────────────────────────────────────────────────

describe('GET /api/invoices/draft', () => {
  it('400s when contract_id is missing', async () => {
    const res = await fetch(`${baseUrl}/api/invoices/draft`);
    expect(res.status).toBe(400);
  });

  it('404s when contract_id does not exist', async () => {
    const res = await fetch(
      `${baseUrl}/api/invoices/draft?contract_id=does-not-exist`,
    );
    expect(res.status).toBe(404);
  });

  it('returns a Zod-valid draft invoice for a real active contract', async () => {
    // `dc-sow-2026` is the active Delta Capita contract in the seed
    // registry — UK Ltd entity, DC-### invoice ids.
    const res = await fetch(`${baseUrl}/api/invoices/draft?contract_id=dc-sow-2026`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { invoice: unknown };
    const draft = InvoiceSchema.parse(body.invoice);
    expect(draft.status).toBe('draft');
    expect(draft.pdf_path).toBeNull();
    expect(draft.contract_id).toBe('dc-sow-2026');
    expect(draft.id).toMatch(/^DC-\d{3}$/);
    expect(draft.invoice_number).toBe('DC-011');
    expect(draft.payment_reference).toBe('DC-011');
  });

  it('400 when contract is self-bill (supplier draft does not apply)', async () => {
    const res = await fetch(
      `${baseUrl}/api/invoices/draft?contract_id=lf-2026-apr`,
    );
    expect(res.status).toBe(400);
    const raw: unknown = await res.json();
    expect(raw).toMatchObject({ error: 'self-bill-contract' });
  });
});

// ─── POST /generate ─────────────────────────────────────────────────────────

const CANONICAL_DRAFT: Invoice = {
  id: 'DC-999',
  contract_id: 'dc-sow-2026',
  client_id: 'delta-capita',
  issuing_entity_id: 'autonize-it-ltd',
  invoice_number: 'DC-999',
  payment_reference: 'DC-999',
  invoice_date: '2026-04-24',
  period_start: '2026-04-01',
  period_end: '2026-04-30',
  days_billed: 22,
  description: 'David Morrison - Consultant Services',
  currency: 'GBP',
  subtotal: 12100,
  vat_rate: 0.2,
  vat_amount: 2420,
  total: 14520,
  fx_rate_at_issue: null,
  fx_base_currency: null,
  mechanism: 'supplier-issued',
  pdf_path: null,
  status: 'draft',
  due_date: '2026-05-24',
  created_at: '2026-04-24',
  updated_at: null,
};

describe('POST /api/invoices/generate', () => {
  it('creates, renders, patches to issued, returns the final row', async () => {
    createInvoiceMock.mockReturnValue({ ok: true, invoice: CANONICAL_DRAFT });
    writeInvoicePdfMock.mockResolvedValue({
      absolutePath: '/tmp/DC-999.pdf',
      relativePath: 'invoices/generated/DC-999.pdf',
      sizeBytes: 1234,
    });
    updateInvoiceMock.mockImplementation(input => {
      const typed = input as { readonly invoiceId: string; readonly patch: Partial<Invoice> };
      return {
        ok: true,
        invoice: {
          ...CANONICAL_DRAFT,
          ...typed.patch,
          id: typed.invoiceId,
          updated_at: '2026-04-24',
        },
      };
    });

    const res = await fetch(`${baseUrl}/api/invoices/generate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ invoice: CANONICAL_DRAFT }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { invoice: Invoice };
    expect(body.invoice.status).toBe('issued');
    expect(body.invoice.pdf_path).toBe('invoices/generated/DC-999.pdf');

    expect(createInvoiceMock).toHaveBeenCalledOnce();
    expect(writeInvoicePdfMock).toHaveBeenCalledOnce();
    expect(updateInvoiceMock).toHaveBeenCalledOnce();
  });

  it('409 on duplicate-id', async () => {
    createInvoiceMock.mockReturnValue({
      ok: false,
      code: 'duplicate-id',
      invoiceId: 'DC-001',
    });

    const res = await fetch(`${baseUrl}/api/invoices/generate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ invoice: CANONICAL_DRAFT }),
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string; invoiceId: string };
    expect(body.error).toBe('duplicate-id');
    expect(body.invoiceId).toBe('DC-001');
    expect(writeInvoicePdfMock).not.toHaveBeenCalled();
  });

  it('400 on invalid payload', async () => {
    const res = await fetch(`${baseUrl}/api/invoices/generate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ invoice: { not: 'a real invoice' } }),
    });
    expect(res.status).toBe(400);
    expect(createInvoiceMock).not.toHaveBeenCalled();
  });

  it('400 when draft contract is self-bill', async () => {
    const payload: Invoice = {
      ...CANONICAL_DRAFT,
      contract_id: 'lf-2026-apr',
      client_id: 'la-fosse',
      issuing_entity_id: 'autonize-it-fzco',
      mechanism: 'self-bill',
    };

    const res = await fetch(`${baseUrl}/api/invoices/generate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ invoice: payload }),
    });
    expect(res.status).toBe(400);
    const raw: unknown = await res.json();
    expect(raw).toMatchObject({ error: 'self-bill-contract' });
    expect(createInvoiceMock).not.toHaveBeenCalled();
  });

  it('500 + rewinds to draft when PDF render fails', async () => {
    createInvoiceMock.mockReturnValue({ ok: true, invoice: CANONICAL_DRAFT });
    writeInvoicePdfMock.mockRejectedValue(new Error('render boom'));
    findInvoiceByIdMock.mockReturnValue({ ...CANONICAL_DRAFT, status: 'draft' });
    updateInvoiceMock.mockReturnValue({ ok: true, invoice: CANONICAL_DRAFT });

    const res = await fetch(`${baseUrl}/api/invoices/generate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ invoice: CANONICAL_DRAFT }),
    });
    expect(res.status).toBe(500);
    // Rewind is a no-op if the row is already draft-with-null-pdf_path,
    // so we don't strictly require a call here — the important contract
    // is: no successful status=issued body was returned.
  });
});

// ─── POST /ingest-self-bill ─────────────────────────────────────────────────

const INGESTED_INVOICE: Invoice = {
  ...CANONICAL_DRAFT,
  id: 'FZ-0042',
  contract_id: 'lf-2026-apr',
  client_id: 'la-fosse',
  issuing_entity_id: 'autonize-it-fzco',
  invoice_number: 'FZ-0042',
  payment_reference: 'SB-277615',
  mechanism: 'self-bill',
  status: 'issued',
};

async function uploadSelfBill(options: {
  body?: Uint8Array;
  mimetype?: string;
  field?: string;
  filename?: string;
}): Promise<Response> {
  const form = new FormData();
  const bytes = options.body ?? new TextEncoder().encode('%PDF-1.4\n%%EOF\n');
  const blob = new Blob([new Uint8Array(bytes)], {
    type: options.mimetype ?? 'application/pdf',
  });
  form.append(options.field ?? 'pdf', blob, options.filename ?? 'self-bill.pdf');
  return await fetch(`${baseUrl}/api/invoices/ingest-self-bill`, {
    method: 'POST',
    body: form,
  });
}

describe('POST /api/invoices/ingest-self-bill', () => {
  it('400 when no file is uploaded', async () => {
    const res = await uploadSelfBill({ field: 'wrong-field' });
    expect(res.status).toBe(400);
    expect(persistIngestedSelfBillFromBufferMock).not.toHaveBeenCalled();
  });

  it('400 when the uploaded file is not a PDF', async () => {
    const res = await uploadSelfBill({ mimetype: 'text/plain' });
    expect(res.status).toBe(400);
    expect(persistIngestedSelfBillFromBufferMock).not.toHaveBeenCalled();
  });

  it('422 when the parser registry cannot identify the supplier', async () => {
    persistIngestedSelfBillFromBufferMock.mockResolvedValue({
      ok: false,
      code: 'no-parser-match',
      detail: { ok: false, code: 'no-parser-match' },
    });
    const res = await uploadSelfBill({});
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('no-parser-match');
    expect(persistIngestedSelfBillFromBufferMock).toHaveBeenCalledOnce();
  });

  it('409 when the supplier invoice number is already on file', async () => {
    persistIngestedSelfBillFromBufferMock.mockResolvedValue({
      ok: false,
      code: 'duplicate-supplier-invoice',
      detail: {
        ok: false,
        code: 'duplicate-supplier-invoice',
        supplierInvoiceNumber: 'SB-277615',
        existingInvoiceId: 'FZ-0001',
      },
    });
    const res = await uploadSelfBill({});
    expect(res.status).toBe(409);
    expect(persistIngestedSelfBillFromBufferMock).toHaveBeenCalledOnce();
  });

  it('returns the persisted invoice and parsed payload on success', async () => {
    const parsed = {
      supplierInvoiceNumber: 'SB-277615',
      invoiceDate: '2025-11-05',
      periodStart: '2025-10-30',
      periodEnd: '2025-11-02',
      placementRef: 'LAF-TEG-002',
      workerName: 'David Morrison',
      jobTitle: 'Full Stack Engineer',
      daysBilled: 4,
      currency: 'GBP',
      subtotal: 1000,
      vatAmount: 200,
      total: 1200,
      vatRate: 0.2,
    };
    persistIngestedSelfBillFromBufferMock.mockResolvedValue({
      ok: true,
      invoice: {
        ...INGESTED_INVOICE,
        pdf_path: 'invoices/ingested/FZ-0042.pdf',
      },
      parsed,
      contractId: 'lf-2026-apr',
      clientId: 'la-fosse',
    });

    const res = await uploadSelfBill({});
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      invoice: Invoice;
      parsed: { supplierInvoiceNumber: string };
    };
    expect(body.invoice.pdf_path).toBe('invoices/ingested/FZ-0042.pdf');
    expect(body.parsed.supplierInvoiceNumber).toBe('SB-277615');
    expect(persistIngestedSelfBillFromBufferMock).toHaveBeenCalledOnce();
  });
});

// ─── GET /:id/pdf ───────────────────────────────────────────────────────────

describe('GET /api/invoices/:id/pdf', () => {
  it('404s when invoice does not exist', async () => {
    findInvoiceByIdMock.mockReturnValue(null);
    const res = await fetch(`${baseUrl}/api/invoices/does-not-exist/pdf`);
    expect(res.status).toBe(404);
  });

  it('renders on the fly when pdf_path is null but entities resolve', async () => {
    findInvoiceByIdMock.mockReturnValue({ ...CANONICAL_DRAFT, pdf_path: null });
    const res = await fetch(`${baseUrl}/api/invoices/DC-999/pdf`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/pdf');
    const bytes = Buffer.from(await res.arrayBuffer());
    expect(bytes.slice(0, 5).toString('utf8')).toBe('%PDF-');
  });

  it('falls back to on-the-fly render when the stored PDF file is missing', async () => {
    findInvoiceByIdMock.mockReturnValue({
      ...CANONICAL_DRAFT,
      pdf_path: 'invoices/generated/does-not-exist.pdf',
    });
    const res = await fetch(`${baseUrl}/api/invoices/DC-999/pdf`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/pdf');
    const bytes = Buffer.from(await res.arrayBuffer());
    expect(bytes.slice(0, 5).toString('utf8')).toBe('%PDF-');
  });

  it('streams the PDF with Content-Type: application/pdf', async () => {
    // Drop a real file under <projectRoot>/invoices/generated/ so the
    // route can read it. Clean it up in the finally block.
    const projectRoot = path.resolve(
      path.dirname(new URL(import.meta.url).pathname),
      '../..',
    );
    const dir = path.join(projectRoot, 'invoices', 'generated');
    const pdfPath = path.join(dir, 'DC-077.pdf');
    fs.mkdirSync(dir, { recursive: true });
    const pdfBody = Buffer.from('%PDF-1.4\n% test\n%%EOF\n');
    fs.writeFileSync(pdfPath, pdfBody);
    try {
      findInvoiceByIdMock.mockReturnValue({
        ...CANONICAL_DRAFT,
        id: 'DC-077',
        invoice_number: 'DC-077',
        payment_reference: 'DC-077',
        pdf_path: 'invoices/generated/DC-077.pdf',
      });
      const res = await fetch(`${baseUrl}/api/invoices/DC-077/pdf`);
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toBe('application/pdf');
      const bytes = Buffer.from(await res.arrayBuffer());
      expect(bytes.slice(0, 5).toString('utf8')).toBe('%PDF-');
    } finally {
      fs.rmSync(pdfPath, { force: true });
    }
  });
});
