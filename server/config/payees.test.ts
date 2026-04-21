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

  /**
   * Regression-lock: HMRC's card gateway routes every debit-card payment
   * through ETMP, so card-channel VAT lands with narrative "HMRC ETMP -
   * GLASGOW - Card Ending: NNNN". The card-ending suffix must classify as
   * VAT (because it IS VAT), while bare "HMRC ETMP" must stay on
   * payment-plan (where it belongs as TTP / recurring-DD).
   *
   * The classifier relies on object-insertion order: `vat` iterates before
   * `payment-plan` in HMRC_NARRATIVE_PATTERNS, so the more-specific card-
   * ending WHEN clause appears first and wins. If either of those
   * invariants breaks, card VAT will silently drop onto the wrong bucket.
   */
  it('classifies card-channel ETMP as VAT (Card Ending: suffix)', () => {
    const vatIdx = sql.indexOf("LIKE 'HMRC ETMP% Card Ending%' THEN 'vat'");
    const paymentPlanIdx = sql.indexOf("LIKE 'HMRC ETMP%' THEN 'payment-plan'");
    expect(vatIdx).toBeGreaterThanOrEqual(0);
    expect(paymentPlanIdx).toBeGreaterThanOrEqual(0);
    expect(vatIdx).toBeLessThan(paymentPlanIdx);
  });

  it('leaves bare HMRC ETMP classified as payment-plan (TTP/DD, not VAT)', () => {
    expect(HMRC_NARRATIVE_PATTERNS['payment-plan']).toContain('HMRC ETMP%');
    expect(HMRC_NARRATIVE_PATTERNS['vat']).not.toContain('HMRC ETMP%');
  });
});

/**
 * Regression-lock: SQL LIKE semantics for the card-ETMP discriminator.
 * These cases simulate what SQLite's LIKE will match against real bank
 * narratives seen in the user's ledger. If the pattern string ever
 * changes, any match flip here catches it immediately.
 */
describe('card-channel ETMP discriminator (LIKE semantics)', () => {
  function sqlLikeMatches(pattern: string, value: string): boolean {
    const regex = new RegExp(
      '^' +
        pattern
          .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
          .replace(/%/g, '.*')
          .replace(/_/g, '.') +
        '$',
    );
    return regex.test(value);
  }

  const CARD_ETMP_PATTERN = 'HMRC ETMP% Card Ending%';
  const BARE_ETMP_PATTERN = 'HMRC ETMP%';

  it('matches real-world card-channel VAT narratives', () => {
    expect(
      sqlLikeMatches(CARD_ETMP_PATTERN, 'HMRC ETMP - GLASGOW - Card Ending: 8346'),
    ).toBe(true);
  });

  it('does not match bare HMRC ETMP direct-debit narratives', () => {
    expect(sqlLikeMatches(CARD_ETMP_PATTERN, 'HMRC ETMP')).toBe(false);
    expect(
      sqlLikeMatches(CARD_ETMP_PATTERN, 'HMRC ETMP             \tON 07 DEC BDC'),
    ).toBe(false);
  });

  it('bare ETMP pattern still catches both (it is the generic fallback)', () => {
    expect(sqlLikeMatches(BARE_ETMP_PATTERN, 'HMRC ETMP')).toBe(true);
    expect(
      sqlLikeMatches(BARE_ETMP_PATTERN, 'HMRC ETMP - GLASGOW - Card Ending: 8346'),
    ).toBe(true);
  });
});
