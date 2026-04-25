/**
 * Entity-scoped public-holiday provider.
 *
 * Source of truth:
 *   - `date-holidays` npm (202 countries, pure computation from rules).
 *   - GB.EAW (England & Wales) is supplemented with the Summer bank
 *     holiday (last Monday of August) which the upstream data omits.
 *
 * Mapping: company jurisdiction → ISO 3166 country code:
 *   - UK  → `GB` subdivision `EAW` (England and Wales)
 *   - UAE → `AE`
 *
 * Holidays are filtered to `type === 'public'` (excludes observances
 * like Mother's Day). Results are memoised by `(jurisdiction, year)`
 * so repeated calls are free.
 *
 * Pure at the boundary: no I/O, no external API calls at runtime.
 * The only side effect is the one-time in-process computation by the
 * `date-holidays` engine, cached permanently.
 */

import Holidays from 'date-holidays';
import type { EntityId, Jurisdiction } from '../../../shared/api-contracts.js';
import { companyById } from '../company/index.js';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface PublicHoliday {
  readonly date: string;
  readonly name: string;
}

// ─── Internal helpers ────────────────────────────────────────────────────────

const cache = new Map<string, readonly PublicHoliday[]>();

function cacheKey(jurisdiction: Jurisdiction, year: number): string {
  return `${jurisdiction}:${year}`;
}

/**
 * Last Monday of August for the given year. This is the UK "Summer
 * bank holiday" rule — `date-holidays` omits it for GB.EAW.
 */
function summerBankHoliday(year: number): PublicHoliday {
  let day = new Date(Date.UTC(year, 7, 31));
  while (day.getUTCDay() !== 1) {
    day = new Date(Date.UTC(year, 7, day.getUTCDate() - 1));
  }
  const iso = day.toISOString().slice(0, 10);
  return { date: iso, name: 'Summer bank holiday' };
}

function computeHolidays(jurisdiction: Jurisdiction, year: number): readonly PublicHoliday[] {
  if (jurisdiction === 'UK') {
    const engine = new Holidays('GB', 'EAW');
    const raw = engine.getHolidays(year)
      .filter(h => h.type === 'public')
      .map(h => ({ date: h.date.slice(0, 10), name: h.name }));

    const summer = summerBankHoliday(year);
    const hasSummer = raw.some(h => h.date === summer.date);
    const merged = hasSummer ? raw : [...raw, summer];
    merged.sort((a, b) => a.date.localeCompare(b.date));
    return merged;
  }

  const engine = new Holidays('AE');
  return engine.getHolidays(year)
    .filter(h => h.type === 'public')
    .map(h => ({ date: h.date.slice(0, 10), name: h.name }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * All public holidays for a jurisdiction in a given year, sorted by
 * date. Memoised — safe to call in tight loops.
 */
export function getPublicHolidays(jurisdiction: Jurisdiction, year: number): readonly PublicHoliday[] {
  const key = cacheKey(jurisdiction, year);
  const cached = cache.get(key);
  if (cached) return cached;
  const result = computeHolidays(jurisdiction, year);
  cache.set(key, result);
  return result;
}

/**
 * Set of ISO date strings for public holidays that fall within
 * `[start, end]` (inclusive) for the entity's jurisdiction.
 *
 * Resolves `entityId → company.jurisdiction` via the company registry.
 */
export function holidayDatesForEntity(
  entityId: EntityId,
  start: string,
  end: string,
): ReadonlySet<string> {
  const company = companyById(entityId);
  if (!company) return new Set<string>();
  const jurisdiction = company.jurisdiction;

  const startYear = Number(start.slice(0, 4));
  const endYear = Number(end.slice(0, 4));
  const dates = new Set<string>();
  for (let y = startYear; y <= endYear; y++) {
    for (const h of getPublicHolidays(jurisdiction, y)) {
      if (h.date >= start && h.date <= end) {
        dates.add(h.date);
      }
    }
  }
  return dates;
}

/**
 * Reset the in-memory cache. Test-only — production code never calls
 * this; the cache is immutable for a given (jurisdiction, year).
 */
export function __resetPublicHolidayCacheForTests(): void {
  cache.clear();
}
