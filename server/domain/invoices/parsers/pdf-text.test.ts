import fs from 'fs';
import path from 'path';
import { describe, it, expect } from 'vitest';
import { extractPdfText } from './pdf-text.js';

const FIXTURE_DIR = path.join(
  path.dirname(new URL(import.meta.url).pathname),
  '__fixtures__',
);

describe('extractPdfText', () => {
  it('returns the full text of the La Fosse SB-277615 fixture', async () => {
    const buffer = fs.readFileSync(
      path.join(FIXTURE_DIR, 'la-fosse-SB-277615.pdf'),
    );
    const text = await extractPdfText(buffer);

    // A handful of stable markers from the rendered invoice — if the
    // PDF is swapped or the library regresses, these are the first
    // things to break. Keeps the assertion robust to minor whitespace
    // drift between pdf-parse versions.
    expect(text).toContain('SELF BILLING INVOICE');
    expect(text).toContain('Invoice Number: SB-277615');
    expect(text).toContain('La Fosse Associates Ltd');
    expect(text).toContain('AUTONIZE IT LIMITED');
    expect(text).toContain('Placement Ref: BH-28240');
  });
});
