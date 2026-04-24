import fs from 'fs';
import path from 'path';
import { describe, it, expect } from 'vitest';
import { detectSelfBillKind, SELF_BILL_PARSERS } from './index.js';
import { extractPdfText } from './pdf-text.js';

const FIXTURE_DIR = path.join(
  path.dirname(new URL(import.meta.url).pathname),
  '__fixtures__',
);

describe('detectSelfBillKind', () => {
  it('routes the La Fosse fixture to the la-fosse parser', async () => {
    const buffer = fs.readFileSync(
      path.join(FIXTURE_DIR, 'la-fosse-SB-277615.pdf'),
    );
    const text = await extractPdfText(buffer);

    const result = detectSelfBillKind(text);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.entry.clientId).toBe('la-fosse');
  });

  it('returns no-parser-match for unrelated text', () => {
    const result = detectSelfBillKind('some invoice from an unknown supplier');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('no-parser-match');
  });

  it('exposes every configured parser in the registry', () => {
    expect(SELF_BILL_PARSERS.length).toBeGreaterThan(0);
    const ids = SELF_BILL_PARSERS.map(p => p.clientId);
    expect(ids).toContain('la-fosse');
  });
});
