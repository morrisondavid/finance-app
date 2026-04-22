/**
 * Witness test — locks in that every named entry in the merchants
 * registry produces a description that, when round-tripped through
 * `categorizeTransaction` + `normalizeMerchant`, resolves back to
 * the exact same category and display name declared on that entry.
 *
 * This is the canonical regression lock for pattern ordering: if a
 * later entry in `STATIC_MERCHANT_DATA` accidentally shadows an
 * earlier one, the shadowed entry becomes unreachable and this test
 * fails loudly with the entry index and pattern source.
 */

import { describe, it, expect } from 'vitest';
import { getMerchantsRegistry } from './registry.js';
import { categorizeTransaction } from '../../utils/categorizer.js';
import { normalizeMerchant } from '../../utils/merchant-normalizer.js';

const PATTERNS = getMerchantsRegistry().indexes.patterns;

/** Mirrors `normalizeForMatching` in categorizer.ts */
function normalizeLikeCategorizer(raw: string): string {
  return raw
    .replace(/,/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/** Mirrors `normalizeForMatching` in merchant-normalizer.ts */
function normalizeLikeNormalizer(raw: string): string {
  return raw
    .replace(/[,\/\\]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function firstCategoryMatchIndex(normalized: string): number {
  for (let j = 0; j < PATTERNS.length; j++) {
    if (PATTERNS[j].pattern.test(normalized)) return j;
  }
  return -1;
}

function firstNamedMatchIndex(normalized: string): number {
  for (let j = 0; j < PATTERNS.length; j++) {
    const e = PATTERNS[j];
    if (e.displayName !== null && e.pattern.test(normalized)) return j;
  }
  return -1;
}

/**
 * Build strings to try so that at least one should match `pattern` when typical
 * literals are substituted for regex metacharacters.
 */
function candidatesFromPattern(pattern: RegExp): string[] {
  const out: string[] = [];
  const add = (s: string) => {
    const t = s.trim();
    if (t.length > 0) out.push(t);
  };

  const source = pattern.source;
  const branchSources = splitTopLevelAlternation(source);

  for (const branch of branchSources) {
    let b = branch
      .replace(/\(\?[:=!][^)]*\)/g, '')
      .replace(/\(\?:[^)]*\)/g, ' ')
      .replace(/\(([A-Z]{3}(?:\|[A-Z]{3})+)\)/g, (_, inner: string) => inner.split('|')[0] ?? '')
      .replace(/\\b/g, ' ')
      .replace(/\\s\??/g, ' ')
      .replace(/\\d\{2\}/g, '00')
      .replace(/\\d\{4\}/g, '0000')
      .replace(/\\d\+/g, '00')
      .replace(/\\d\*/g, '0')
      .replace(/\\d/g, '0')
      .replace(/\\w\+/g, 'A')
      .replace(/\\w\*/g, 'A')
      .replace(/\\w/g, 'A')
      .replace(/\\t/g, '\t')
      .replace(/\\n/g, '\n');

    b = b.replace(/\[[^\]]+\]/g, (cls) => {
      const inner = cls.slice(1, -1);
      if (inner === '\\s-' || inner === '-\\s' || /^\\s$/.test(inner) || inner === '-') {
        return ' ';
      }
      const first = inner.match(/[A-Za-z0-9]/);
      return first?.[0] ?? 'X';
    });

    b = b.replace(/\\.?/g, (m) => {
      if (m === '\\.') return '.';
      if (m.startsWith('\\') && m.length === 2) return m.slice(1);
      return m;
    });

    // Drop quantifiers / syntax noise but keep `.` (domains) and `*` (e.g. PAYPAL *STEAM).
    b = b.replace(/[+?^$()[\]{}|]/g, ' ');
    b = b.replace(/\s{2,}/g, ' ').trim();
    add(b);

    const compact = b.replace(/\s+/g, '');
    if (compact !== b) add(compact);
  }

  add(source.replace(/\|/g, ' '));

  return [...new Set(out)];
}

function splitTopLevelAlternation(source: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < source.length; i++) {
    const c = source[i];
    if (c === '\\') {
      i++;
      continue;
    }
    if (c === '(') depth++;
    else if (c === ')') depth = Math.max(0, depth - 1);
    else if (c === '|' && depth === 0) {
      parts.push(source.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(source.slice(start));
  return parts.length > 0 ? parts : [source];
}

function syntheticSamplesForSource(source: string): string[] {
  const out: string[] = [];
  if (/BOLT\\.EU/i.test(source)) out.push('BOLT.EU');
  if (/APPLE\\.COM/i.test(source)) out.push('APPLE.COM');
  if (/^PAYPAL \\\*X\\\./i.test(source)) out.push('PAYPAL *X.');
  if (source.includes('*STEAM')) out.push('PAYPAL *STEAM');
  if (source.includes('*SEGPAY')) out.push('PAYPAL *SEGPAY');
  if (source.includes('ROMFORD') && source.includes('ESSEX') && source.includes('[\\s-]+')) {
    out.push('ROMFORD ESSEX', 'ROMFORD-ESSEX');
  }
  if (source.includes('NOV|DEC) A(?:\\/| )C')) {
    out.push('01JAN A/C', '01JAN A C');
  }
  return out;
}

function findExclusiveWitness(entryIndex: number): string | undefined {
  const entry = PATTERNS[entryIndex];
  if (entry.displayName === null) return undefined;

  const tryOrder = [
    ...syntheticSamplesForSource(entry.pattern.source),
    ...candidatesFromPattern(entry.pattern),
    entry.displayName.toUpperCase(),
    entry.displayName,
  ];

  const seen = new Set<string>();
  for (const base of tryOrder) {
    if (seen.has(base)) continue;
    seen.add(base);

    const variants = witnessVariants(base, entryIndex);
    for (const raw of variants) {
      const nCat = normalizeLikeCategorizer(raw);
      const nNorm = normalizeLikeNormalizer(raw);
      if (firstCategoryMatchIndex(nCat) !== entryIndex) continue;
      if (firstNamedMatchIndex(nNorm) !== entryIndex) continue;
      if (!entry.pattern.test(nCat) || !entry.pattern.test(nNorm)) continue;
      if (categorizeTransaction(raw) !== entry.category) continue;
      if (normalizeMerchant(raw) !== entry.displayName) continue;
      return raw;
    }
  }

  return undefined;
}

function witnessVariants(base: string, entryIndex: number): string[] {
  const out: string[] = [base];
  const pad = `ZREG${entryIndex}Z`;
  out.push(`${pad} ${base}`, `${base} ${pad}`, `${pad}${base}`, `${base}${pad}`);

  if (/\d/.test(PATTERNS[entryIndex].pattern.source)) {
    for (const d of ['01', '12', '99']) {
      out.push(base.replace(/00/g, d));
    }
  }

  return [...new Set(out)];
}

describe('merchants registry witness round-trip', () => {
  it('has more than 100 patterns', () => {
    expect(PATTERNS.length).toBeGreaterThan(100);
  });

  it('gives every entry a non-empty category string', () => {
    for (const [i, entry] of PATTERNS.entries()) {
      expect(entry.category, `entry #${i}`).toMatch(/\S/);
    }
  });

  it('gives every entry a valid RegExp pattern', () => {
    for (const [i, entry] of PATTERNS.entries()) {
      expect(entry.pattern, `entry #${i}`).toBeInstanceOf(RegExp);
      expect(entry.pattern.source.length, `entry #${i}`).toBeGreaterThan(0);

      const roundTrip = new RegExp(entry.pattern.source, entry.pattern.flags);
      expect(roundTrip.test('sanity')).toBeTypeOf('boolean');
    }
  });

  it('has no duplicate non-null displayName + category pairs', () => {
    const seen = new Map<string, number>();
    for (const [i, entry] of PATTERNS.entries()) {
      if (entry.displayName === null) continue;
      const key = `${entry.displayName}\u0000${entry.category}`;
      const prev = seen.get(key);
      expect(
        prev,
        `duplicate displayName+category at #${i} and #${prev}: ${entry.displayName} / ${entry.category}`,
      ).toBeUndefined();
      seen.set(key, i);
    }
  });

  it('keeps categorizer and normalizer aligned for every named entry (exclusive witness)', () => {
    const failures: string[] = [];

    for (const [i, entry] of PATTERNS.entries()) {
      if (entry.displayName === null) continue;

      const witness = findExclusiveWitness(i);
      if (witness === undefined) {
        failures.push(
          `#${i} category=${entry.category} displayName=${entry.displayName} pattern=${entry.pattern}`,
        );
        continue;
      }

      expect(categorizeTransaction(witness), `entry #${i}`).toBe(entry.category);
      expect(normalizeMerchant(witness), `entry #${i}`).toBe(entry.displayName);
    }

    expect(failures, failures.join('\n')).toEqual([]);
  });
});
