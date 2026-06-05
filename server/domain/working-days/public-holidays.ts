/**
 * Entity-scoped public-holiday provider.
 *
 * Source of truth:
 *   - `date-holidays` npm (202 countries, pure computation from rules).
 *   - GB.EAW (England & Wales) is supplemented with the Summer bank
 *     holiday (last Monday of August) which the upstream data omits.
 *
 * Mapping to ISO 3166 country codes:
 *   - UK  → `GB` subdivision `EAW` (England and Wales)
 *   - UAE → `AE`
 *
 * Contract workloads use {@link contractWorkingDayJurisdiction} (governing
 * law / place of work), not the issuing entity's company jurisdiction.
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
import type { Contract, EntityId, Jurisdiction } from '../../../shared/api-contracts.js';
import { companyById } from '../company/index.js';

const UK_CONTRACT_JURISDICTION_MARKERS = [
  'england',
  'wales',
  'scotland',
  'northern ireland',
  'united kingdom',
  'uk',
  'gb',
  'eaw',
] as const;

const UAE_CONTRACT_JURISDICTION_MARKERS = [
  'uae',
  'dubai',
  'emirates',
  'abu dhabi',
] as const;

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
 * Public holidays for contract workload follow **where the work happens**
 * (`contract.jurisdiction` / governing law), not the issuing entity's
 * company jurisdiction. A UK client engagement billed via FZCO still
 * uses UK bank holidays for days-billed reconciliation.
 */
export function contractWorkingDayJurisdiction(
  contract: Pick<Contract, 'jurisdiction' | 'issuing_entity_id'>,
): Jurisdiction {
  const normalized = contract.jurisdiction.trim().toLowerCase();
  if (UK_CONTRACT_JURISDICTION_MARKERS.some(marker => normalized.includes(marker))) {
    return 'UK';
  }
  if (UAE_CONTRACT_JURISDICTION_MARKERS.some(marker => normalized.includes(marker))) {
    return 'UAE';
  }
  const company = companyById(contract.issuing_entity_id);
  if (company) return company.jurisdiction;
  return 'UK';
}

export function holidayDatesForJurisdiction(
  jurisdiction: Jurisdiction,
  start: string,
  end: string,
): ReadonlySet<string> {
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

export function holidayDatesForContract(
  contract: Pick<Contract, 'jurisdiction' | 'issuing_entity_id'>,
  start: string,
  end: string,
): ReadonlySet<string> {
  return holidayDatesForJurisdiction(
    contractWorkingDayJurisdiction(contract),
    start,
    end,
  );
}

/**
 * Set of ISO date strings for public holidays that fall within
 * `[start, end]` (inclusive) for the entity's jurisdiction.
 *
 * Resolves `entityId → company.jurisdiction` via the company registry.
 * Prefer {@link holidayDatesForContract} for invoice / leave workloads.
 */
export function holidayDatesForEntity(
  entityId: EntityId,
  start: string,
  end: string,
): ReadonlySet<string> {
  const company = companyById(entityId);
  if (!company) return new Set<string>();
  return holidayDatesForJurisdiction(company.jurisdiction, start, end);
}

/**
 * Reset the in-memory cache. Test-only — production code never calls
 * this; the cache is immutable for a given (jurisdiction, year).
 */
export function __resetPublicHolidayCacheForTests(): void {
  cache.clear();
}
