/**
 * Query purity for the clients domain.
 *
 * Every query is driven via a fixture registry so the same function
 * over different data produces the expected result. Pure by
 * construction — no global state dependency.
 */

import { describe, it, expect } from 'vitest';
import {
  allClients,
  findClientById,
  listActiveClients,
  listClientsByKind,
  resolveTemplatePath,
} from './queries.js';
import { makeTestClientRegistry } from './fixtures.js';
import { buildClientRegistryFromData } from './registry.js';
import { parseClientRow } from './csv-io.js';
import { directRow, agencyRow, agencyInactiveRow } from './test-helpers.js';

const both = makeTestClientRegistry({
  clients: [parseClientRow(directRow), parseClientRow(agencyRow)],
});
const directOnly = makeTestClientRegistry({
  clients: [parseClientRow(directRow)],
});
const oneActiveOneInactive = makeTestClientRegistry({
  clients: [parseClientRow(directRow), parseClientRow(agencyInactiveRow)],
});

describe('allClients', () => {
  it('returns the canonical ordered list', () => {
    expect(allClients(both).map(c => c.id)).toEqual(['delta-capita', 'la-fosse']);
  });

  it('returns an empty list on an empty registry', () => {
    const empty = buildClientRegistryFromData([]);
    expect(allClients(empty)).toEqual([]);
  });
});

describe('findClientById', () => {
  it('returns the matching client', () => {
    expect(findClientById('delta-capita', both)?.kind).toBe('direct');
    expect(findClientById('la-fosse', both)?.kind).toBe('agency');
  });

  it('returns null for unknown ids', () => {
    expect(findClientById('la-fosse', directOnly)).toBeNull();
  });
});

describe('listClientsByKind', () => {
  it('returns all direct clients', () => {
    expect(listClientsByKind('direct', both).map(c => c.id)).toEqual(['delta-capita']);
  });

  it('returns all agency clients', () => {
    expect(listClientsByKind('agency', both).map(c => c.id)).toEqual(['la-fosse']);
  });

  it('returns an empty list when no clients match', () => {
    expect(listClientsByKind('agency', directOnly)).toEqual([]);
  });
});

describe('listActiveClients', () => {
  it('excludes inactive clients', () => {
    expect(listActiveClients(oneActiveOneInactive).map(c => c.id)).toEqual([
      'delta-capita',
    ]);
  });

  it('returns every client when all active', () => {
    expect(listActiveClients(both).map(c => c.id)).toEqual(['delta-capita', 'la-fosse']);
  });
});

describe('resolveTemplatePath', () => {
  it('derives leave template path by convention', () => {
    expect(resolveTemplatePath('delta-capita', 'leave')).toBe(
      'clients/templates/delta-capita/leave.md',
    );
  });

  it('derives renewal template path by convention', () => {
    expect(resolveTemplatePath('la-fosse', 'renewal')).toBe(
      'clients/templates/la-fosse/renewal.md',
    );
  });

  it('does not differentiate by client kind — convention is uniform', () => {
    expect(resolveTemplatePath('delta-capita', 'invoice-cover')).toBe(
      'clients/templates/delta-capita/invoice-cover.md',
    );
    expect(resolveTemplatePath('la-fosse', 'invoice-cover')).toBe(
      'clients/templates/la-fosse/invoice-cover.md',
    );
  });
});
