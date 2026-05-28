/**
 * End-to-end unit tests for the self-bill ingest orchestrator.
 *
 * The text fixture is the committed La Fosse PDF — any drift in the
 * parser, detect layer, or orchestrator wiring surfaces here.
 * Registry fixtures use a tmp invoices CSV so the duplicate check
 * sees only what the test seeded.
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
} from 'vitest';
import { ingestSelfBill } from './ingest-self-bill.js';
import { extractPdfText } from './parsers/pdf-text.js';
import {
  __resetInvoiceRegistryForTests,
  buildInvoiceRegistry,
} from './registry.js';
import {
  getInvoicesCsvPath,
  writeInvoicesCsvFile,
} from './csv-io.js';

const FIXTURE_DIR = path.join(
  path.dirname(new URL(import.meta.url).pathname),
  'parsers',
  '__fixtures__',
);

let tmpDir: string;

async function readFixtureText(filename: string): Promise<string> {
  const buffer = fs.readFileSync(path.join(FIXTURE_DIR, filename));
  return await extractPdfText(buffer);
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'invoices-ingest-'));
  writeInvoicesCsvFile(getInvoicesCsvPath(tmpDir), []);
  __resetInvoiceRegistryForTests(buildInvoiceRegistry(tmpDir));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  __resetInvoiceRegistryForTests();
});

describe('ingestSelfBill', () => {
  it('returns no-contract-match when the placement ref does not match any contract', async () => {
    const text = await readFixtureText('la-fosse-SB-277615.pdf');
    const result = ingestSelfBill({ rawText: text, today: '2026-06-15' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('no-contract-match');
    if (result.code !== 'no-contract-match') return;
    expect(result.clientId).toBe('la-fosse');
    expect(result.placementRef).toBe('BH-28240');
  });

  it('composes a canonical Invoice when the placement ref matches an active contract', async () => {
    // `LAF-TEG-002` is the active la-fosse contract on FZCO — swap the
    // PDF's placement_ref in place to exercise the happy path without
    // mutating the real contracts.csv.
    const realText = await readFixtureText('la-fosse-SB-277615.pdf');
    const text = realText.replace(
      'Placement Ref: BH-28240',
      'Placement Ref: LAF-TEG-002',
    );

    const result = ingestSelfBill({ rawText: text, today: '2026-06-15' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const inv = result.invoice;
    expect(inv.client_id).toBe('la-fosse');
    expect(inv.contract_id).toBe('lf-2026-may');
    expect(inv.issuing_entity_id).toBe('autonize-it-fzco');
    expect(inv.mechanism).toBe('self-bill');
    expect(inv.payment_reference).toBe('SB-277615');
    expect(inv.invoice_number).toBe(inv.id);
    expect(inv.id).toMatch(/^FZ-\d{4}$/);
    expect(inv.subtotal).toBe(1000);
    expect(inv.vat_amount).toBe(200);
    expect(inv.total).toBe(1200);
    expect(inv.status).toBe('issued');
    expect(inv.invoice_date).toBe('2025-11-05');
    expect(inv.period_start).toBe('2025-10-30');
    expect(inv.period_end).toBe('2025-11-02');
    expect(inv.due_date).toBe('2025-12-05');
    expect(inv.description).toContain('Full Stack Engineer');
  });

  it('detects duplicate supplier invoice numbers', async () => {
    const realText = await readFixtureText('la-fosse-SB-277615.pdf');
    const text = realText.replace(
      'Placement Ref: BH-28240',
      'Placement Ref: LAF-TEG-002',
    );

    const first = ingestSelfBill({ rawText: text, today: '2026-06-15' });
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    // Simulate "already ingested" by handing the same invoice back via
    // the optional `existingInvoices` override.
    const second = ingestSelfBill({
      rawText: text,
      today: '2026-06-15',
      existingInvoices: [first.invoice],
    });
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.code).toBe('duplicate-supplier-invoice');
    if (second.code !== 'duplicate-supplier-invoice') return;
    expect(second.existingInvoiceId).toBe(first.invoice.id);
    expect(second.supplierInvoiceNumber).toBe('SB-277615');
  });

  it('returns no-parser-match for unrelated text', () => {
    const result = ingestSelfBill({
      rawText: 'Hello, this is an unrelated invoice text.',
      today: '2026-06-15',
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('no-parser-match');
  });

  it('returns parse-failed when the supplier layout is recognised but a field is missing', () => {
    // Detector sees both marker strings → routes to la-fosse — but the
    // parser bails because the `Invoice Number:` line is missing.
    const text =
      'La Fosse Associates Ltd\n' +
      'SELF BILLING INVOICE\n' +
      '...nothing else useful here...';
    const result = ingestSelfBill({ rawText: text, today: '2026-06-15' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('parse-failed');
  });
});
