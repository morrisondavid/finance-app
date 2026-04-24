/**
 * Unit tests for narrative-match helpers. Lifted from the matching
 * cases that previously lived in
 * `server/domain/contracts/last-payment.test.ts`; those helpers are
 * now a first-class clients-domain primitive consumed by
 * `last-payment.ts` AND `payer-match.ts`, so the tests live with the
 * helpers rather than with one of the consumers.
 */

import { describe, it, expect } from 'vitest';
import {
  normaliseForMatch,
  buildNarrativeTokens,
  narrativeMatches,
} from './narrative-match.js';
import { parseClientRow } from './csv-io.js';
import { directRow, agencyRow } from './test-helpers.js';

const deltaCapita = parseClientRow(directRow);
const laFosse = parseClientRow(agencyRow);

describe('normaliseForMatch', () => {
  it('uppercases and collapses whitespace', () => {
    expect(normaliseForMatch('La Fosse  Associates Ltd'))
      .toBe('LA FOSSE ASSOCIATES LTD');
  });

  it('strips punctuation into spaces then collapses', () => {
    expect(normaliseForMatch('la-fosse.associates,ltd'))
      .toBe('LA FOSSE ASSOCIATES LTD');
  });

  it('strips diacritics', () => {
    expect(normaliseForMatch('Société Générale'))
      .toBe('SOCIETE GENERALE');
  });

  it('returns empty string for whitespace-only input', () => {
    expect(normaliseForMatch('   ')).toBe('');
  });

  it('returns empty string for empty input', () => {
    expect(normaliseForMatch('')).toBe('');
  });
});

describe('buildNarrativeTokens', () => {
  it('returns trading name, first-word token, and legal name when distinct', () => {
    const tokens = buildNarrativeTokens(laFosse);
    expect(tokens).toContain('LA FOSSE ASSOCIATES LIMITED');
    // First word of trading name is 'LA' (length 2) — excluded by the
    // length >= 4 guard to avoid matching generic prefixes.
    expect(tokens).not.toContain('LA');
  });

  it('includes a short single-word token for longer first words', () => {
    const tokens = buildNarrativeTokens(deltaCapita);
    expect(tokens).toContain('DELTA');
  });

  it('omits duplicate legal name when it equals trading name', () => {
    const tokens = buildNarrativeTokens(deltaCapita);
    const uniqueTokens = new Set(tokens);
    expect(uniqueTokens.size).toBe(tokens.length);
  });
});

describe('narrativeMatches', () => {
  it('returns true for an exact-name substring hit', () => {
    const tokens = buildNarrativeTokens(laFosse);
    expect(narrativeMatches(
      'LA FOSSE ASSOCIATES LIMITED - INV 123',
      tokens,
    )).toBe(true);
  });

  it('survives punctuation, spacing, and mixed case', () => {
    const tokens = buildNarrativeTokens(laFosse);
    expect(narrativeMatches(
      'la  fosse    associates.ltd -  invoice',
      tokens,
    )).toBe(true);
  });

  it('matches the single-word trading-name token when full name is abbreviated', () => {
    const tokens = buildNarrativeTokens(deltaCapita);
    expect(narrativeMatches(
      'DELTA Transfer - supplier payment',
      tokens,
    )).toBe(true);
  });

  it('returns false when no token appears', () => {
    const tokens = buildNarrativeTokens(laFosse);
    expect(narrativeMatches('Random interest payment', tokens)).toBe(false);
  });

  it('returns false for empty description', () => {
    const tokens = buildNarrativeTokens(laFosse);
    expect(narrativeMatches('', tokens)).toBe(false);
  });

  it('returns false for empty token set', () => {
    expect(narrativeMatches('LA FOSSE ASSOCIATES', [])).toBe(false);
  });
});
