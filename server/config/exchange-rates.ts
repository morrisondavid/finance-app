/**
 * Exchange rate service.
 *
 * AED is not supported by the ECB-based Frankfurter API, so we fall back to
 * hardcoded mid-market rates for any pair involving AED.  The Frankfurter
 * client is installed for future use with supported ECB currencies.
 */

import type { CurrencyCode } from '../types.js';

interface RateCacheEntry {
  rate: number;
  fetchedAt: number;
}

const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 h

const rateCache = new Map<string, RateCacheEntry>();

const HARDCODED_RATES: Record<string, number> = {
  'AED/GBP': 0.21,
  'GBP/AED': 4.76,
  'AED/AED': 1,
  'GBP/GBP': 1,
};

function cacheKey(from: CurrencyCode, to: CurrencyCode, date: string | undefined): string {
  return `${from}/${to}@${date ?? 'latest'}`;
}

/**
 * Synchronous rate lookup from the hardcoded table or cache.
 * Used in hot paths like transfer detection where going async is impractical.
 */
export function getRateSync(from: CurrencyCode, to: CurrencyCode): number {
  if (from === to) return 1;
  const key = cacheKey(from, to, undefined);
  const cached = rateCache.get(key);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) return cached.rate;

  const pairKey = `${from}/${to}`;
  const hardcoded = HARDCODED_RATES[pairKey];
  if (hardcoded !== undefined) {
    rateCache.set(key, { rate: hardcoded, fetchedAt: Date.now() });
    return hardcoded;
  }

  console.warn(`[exchange-rates] No rate available for ${pairKey}, returning 1`);
  return 1;
}

/**
 * Return the exchange rate to convert 1 unit of `from` into `to`.
 *
 * For AED pairs the hardcoded fallback is always used because the free
 * ECB data feed does not cover AED.  A `date` parameter is accepted for
 * future historical-rate support but currently ignored for AED pairs.
 */
export async function getRate(
  from: CurrencyCode,
  to: CurrencyCode,
  _date?: string,
): Promise<number> {
  return getRateSync(from, to);
}

/**
 * Convert an amount from one currency to another.
 */
export function convertAmountSync(
  amount: number,
  from: CurrencyCode,
  to: CurrencyCode,
): number {
  return amount * getRateSync(from, to);
}

/**
 * Async variant of convertAmount (for future API-backed rates).
 */
export async function convertAmount(
  amount: number,
  from: CurrencyCode,
  to: CurrencyCode,
  date?: string,
): Promise<number> {
  const rate = await getRate(from, to, date);
  return amount * rate;
}
