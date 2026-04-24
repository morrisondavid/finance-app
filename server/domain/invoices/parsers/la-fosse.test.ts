import fs from 'fs';
import path from 'path';
import { describe, it, expect } from 'vitest';
import { parseLaFosseSelfBill } from './la-fosse.js';
import { extractPdfText } from './pdf-text.js';

const FIXTURE_DIR = path.join(
  path.dirname(new URL(import.meta.url).pathname),
  '__fixtures__',
);

async function readFixtureText(filename: string): Promise<string> {
  const buffer = fs.readFileSync(path.join(FIXTURE_DIR, filename));
  return await extractPdfText(buffer);
}

describe('parseLaFosseSelfBill (against the committed PDF)', () => {
  it('extracts every field from SB-277615 verbatim', async () => {
    const text = await readFixtureText('la-fosse-SB-277615.pdf');
    const result = parseLaFosseSelfBill(text);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const inv = result.invoice;
    expect(inv.supplierInvoiceNumber).toBe('SB-277615');
    expect(inv.invoiceDate).toBe('2025-11-05');
    expect(inv.periodEnd).toBe('2025-11-02');
    expect(inv.periodStart).toBe('2025-10-30');
    expect(inv.placementRef).toBe('BH-28240');
    expect(inv.workerName).toBe('David Morrison');
    expect(inv.jobTitle).toBe('Full Stack Engineer');
    expect(inv.daysBilled).toBe(2);
    expect(inv.currency).toBe('GBP');
    expect(inv.subtotal).toBe(1000);
    expect(inv.vatAmount).toBe(200);
    expect(inv.total).toBe(1200);
    expect(inv.vatRate).toBeCloseTo(0.2);
  });
});

describe('parseLaFosseSelfBill (synthetic failures)', () => {
  it('rejects empty text', () => {
    const result = parseLaFosseSelfBill('');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('empty-text');
  });

  it('rejects text missing the Invoice Number line', () => {
    const result = parseLaFosseSelfBill('Some other document text');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('unexpected-format');
  });

  it('rejects an invalid Date value', async () => {
    const real = await readFixtureText('la-fosse-SB-277615.pdf');
    const broken = real.replace('Date: 05/11/2025', 'Date: 99/99/9999');
    const result = parseLaFosseSelfBill(broken);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('unexpected-format');
    if (result.code !== 'unexpected-format') return;
    expect(result.detail).toContain('Date');
  });
});
