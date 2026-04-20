import { describe, it, expect } from 'vitest';
import {
  HMRC_PATTERNS,
  HMRC_NARRATIVE_PATTERNS,
  buildHmrcNarrativeCaseSql,
} from './payees.js';

describe('HMRC_PATTERNS derivation', () => {
  it('seeder-facing groups point at the same array instances as the canonical map', () => {
    expect(HMRC_PATTERNS.VAT).toBe(HMRC_NARRATIVE_PATTERNS['vat']);
    expect(HMRC_PATTERNS.SELF_ASSESSMENT).toBe(HMRC_NARRATIVE_PATTERNS['self-assessment']);
    expect(HMRC_PATTERNS.CORPORATION_TAX).toBe(HMRC_NARRATIVE_PATTERNS['corporation-tax']);
  });

  it('ANY contains every narrative pattern plus the generic catch-all', () => {
    const narrativePatterns = Object.values(HMRC_NARRATIVE_PATTERNS).flat();
    for (const pattern of narrativePatterns) {
      expect(HMRC_PATTERNS.ANY).toContain(pattern);
    }
    expect(HMRC_PATTERNS.ANY).toContain('HMRC GOV.UK%');
  });
});

describe('buildHmrcNarrativeCaseSql', () => {
  const sql = buildHmrcNarrativeCaseSql('t.description');

  it('emits one WHEN clause per pattern in HMRC_NARRATIVE_PATTERNS', () => {
    for (const [narrative, patterns] of Object.entries(HMRC_NARRATIVE_PATTERNS)) {
      for (const pattern of patterns) {
        expect(sql).toContain(`WHEN t.description LIKE '${pattern}' THEN '${narrative}'`);
      }
    }
  });

  it('closes with an ELSE other fallback', () => {
    expect(sql).toMatch(/ELSE 'other'\s+END$/);
  });

  it('represents every key in HMRC_NARRATIVE_PATTERNS (no silent drift)', () => {
    for (const narrative of Object.keys(HMRC_NARRATIVE_PATTERNS)) {
      expect(sql).toContain(`THEN '${narrative}'`);
    }
  });

  it('interpolates the caller-supplied column expression', () => {
    const aliased = buildHmrcNarrativeCaseSql('descr');
    expect(aliased).toContain("WHEN descr LIKE 'HMRC VAT%' THEN 'vat'");
  });
});
