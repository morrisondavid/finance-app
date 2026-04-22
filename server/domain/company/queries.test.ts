/**
 * Query purity for the company domain.
 *
 * Every query is driven via a fixture registry so the same function
 * over different data produces the expected result. Pure by
 * construction — no global state dependency.
 */

import { describe, it, expect } from 'vitest';
import {
  activeCompanies,
  allCompanies,
  allEntityIds,
  companiesByJurisdiction,
  companyById,
} from './queries.js';
import { makeTestCompanyRegistry } from './fixtures.js';
import { buildCompanyRegistryFromData } from './registry.js';
import { parseCompanyRow } from './csv-io.js';
import { ukRow, uaeRow, uaeInactiveRow } from './test-helpers.js';

const both = makeTestCompanyRegistry({
  companies: [parseCompanyRow(ukRow), parseCompanyRow(uaeRow)],
});
const ukOnly = makeTestCompanyRegistry({
  companies: [parseCompanyRow(ukRow)],
});
const oneActiveOneInactive = makeTestCompanyRegistry({
  companies: [parseCompanyRow(ukRow), parseCompanyRow(uaeInactiveRow)],
});

describe('allCompanies', () => {
  it('returns the canonical ordered list', () => {
    expect(allCompanies(both).map(c => c.id)).toEqual([
      'autonize-it-ltd',
      'autonize-it-fzco',
    ]);
  });

  it('returns an empty list on an empty registry', () => {
    const empty = buildCompanyRegistryFromData([]);
    expect(allCompanies(empty)).toEqual([]);
  });
});

describe('allEntityIds', () => {
  it('returns ids in CSV order', () => {
    expect(allEntityIds(both)).toEqual(['autonize-it-ltd', 'autonize-it-fzco']);
  });

  it('distinguishes between fixtures (purity)', () => {
    expect(allEntityIds(both).length).not.toBe(allEntityIds(ukOnly).length);
  });
});

describe('companyById', () => {
  it('returns the matching company', () => {
    expect(companyById('autonize-it-ltd', both)?.jurisdiction).toBe('UK');
    expect(companyById('autonize-it-fzco', both)?.jurisdiction).toBe('UAE');
  });

  it('returns null for unknown ids', () => {
    expect(companyById('autonize-it-fzco', ukOnly)).toBeNull();
  });
});

describe('companiesByJurisdiction', () => {
  it('returns all UK companies', () => {
    expect(companiesByJurisdiction('UK', both).map(c => c.id)).toEqual([
      'autonize-it-ltd',
    ]);
  });

  it('returns all UAE companies', () => {
    expect(companiesByJurisdiction('UAE', both).map(c => c.id)).toEqual([
      'autonize-it-fzco',
    ]);
  });

  it('returns an empty list when no companies match', () => {
    expect(companiesByJurisdiction('UAE', ukOnly)).toEqual([]);
  });
});

describe('activeCompanies', () => {
  it('excludes inactive companies', () => {
    expect(activeCompanies(oneActiveOneInactive).map(c => c.id)).toEqual([
      'autonize-it-ltd',
    ]);
  });

  it('returns every company when all active', () => {
    expect(activeCompanies(both).map(c => c.id)).toEqual([
      'autonize-it-ltd',
      'autonize-it-fzco',
    ]);
  });
});
