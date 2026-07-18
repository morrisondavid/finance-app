/**
 * `matchPayerToContract` contract tests — every branch of the
 * discriminated union is exercised with a fixture-built registry, so
 * a regression in either narrative matching or the contract-window
 * lookup surfaces here.
 */

import { describe, it, expect } from 'vitest';
import type { Transaction } from '../../../shared/api-contracts.js';
import { matchPayerToContract } from './payer-match.js';
import { makeTestContractRegistry } from './fixtures.js';
import {
  makeStubClients,
  dcSowRow,
  lfContractRow,
  lfFzcoContractRow,
} from './test-helpers.js';
import { parseContractRow } from './csv-io.js';

const CLIENTS = makeStubClients();

const FULL_REGISTRY = makeTestContractRegistry({
  contracts: [
    parseContractRow(dcSowRow),
    parseContractRow(lfContractRow),
    parseContractRow(lfFzcoContractRow),
  ],
  clients: CLIENTS,
});

function tx(overrides: Partial<Transaction>): Transaction {
  return {
    date: '2026-04-01',
    description: 'PAYMENT',
    amount: 1000,
    account: 'UK - Barclays',
    type: 'income',
    ...overrides,
  };
}

describe('matchPayerToContract', () => {
  it('returns `in-contract` when the deposit date falls inside an active contract', () => {
    const result = matchPayerToContract({
      transaction: tx({
        date: '2026-04-15',
        description: 'DELTA CAPITA PAYMENT REF DC-001',
      }),
      accountEntityId: 'autonize-it-ltd',
      contractRegistry: FULL_REGISTRY,
      clientRegistry: CLIENTS,
    });
    expect(result.kind).toBe('in-contract');
    if (result.kind !== 'in-contract') return;
    expect(result.contract.id).toBe('dc-sow-2026');
  });

  it('returns `in-contract` for a deposit in the trailing receivable window', () => {
    const result = matchPayerToContract({
      transaction: tx({
        date: '2026-05-15',
        description: 'DELTA CAPITA PAYMENT REF DC-010',
      }),
      accountEntityId: 'autonize-it-ltd',
      contractRegistry: FULL_REGISTRY,
      clientRegistry: CLIENTS,
    });
    expect(result.kind).toBe('in-contract');
    if (result.kind !== 'in-contract') return;
    expect(result.contract.id).toBe('dc-sow-2026');
  });

  it('returns `outside-contract-window` for a deposit after the trailing window closed, pinned to the nearest contract', () => {
    // lf-2026-apr (FZCO) ends 2026-04-30. Trailing window runs to ~2026-06-13;
    // a 2026-06-20 FZCO deposit falls outside every window — nearest is lf-2026-apr.
    const result = matchPayerToContract({
      transaction: tx({
        date: '2026-06-20',
        description: 'FZCO Wire: LA FOSSE ASSOCIATES LTD',
        account: 'FZCO - WIO',
      }),
      accountEntityId: 'autonize-it-fzco',
      contractRegistry: FULL_REGISTRY,
      clientRegistry: CLIENTS,
    });
    expect(result.kind).toBe('outside-contract-window');
    if (result.kind !== 'outside-contract-window') return;
    expect(result.client.id).toBe('la-fosse');
    expect(result.nearestContract.id).toBe('lf-2026-apr');
  });

  it('returns `outside-contract-window` for a deposit before the earliest contract started', () => {
    const result = matchPayerToContract({
      transaction: tx({
        date: '2025-11-01',
        description: 'BACS CREDIT DELTA CAPITA',
      }),
      accountEntityId: 'autonize-it-ltd',
      contractRegistry: FULL_REGISTRY,
      clientRegistry: CLIENTS,
    });
    expect(result.kind).toBe('outside-contract-window');
    if (result.kind !== 'outside-contract-window') return;
    expect(result.client.id).toBe('delta-capita');
    expect(result.nearestContract.id).toBe('dc-sow-2026');
  });

  it('returns `no-contracts-for-entity` when the client is recognised but has no contract on the receiving entity', () => {
    // Delta Capita only has contracts on UK Ltd — a FZCO deposit from
    // Delta Capita is a harder edge case than "outside window".
    const result = matchPayerToContract({
      transaction: tx({
        date: '2026-04-15',
        description: 'FZCO Wire: DELTA CAPITA LTD',
        account: 'FZCO - WIO',
      }),
      accountEntityId: 'autonize-it-fzco',
      contractRegistry: FULL_REGISTRY,
      clientRegistry: CLIENTS,
    });
    expect(result.kind).toBe('no-contracts-for-entity');
    if (result.kind !== 'no-contracts-for-entity') return;
    expect(result.client.id).toBe('delta-capita');
  });

  it('returns `no-known-payer` when no client narrative matches the description', () => {
    const result = matchPayerToContract({
      transaction: tx({
        date: '2026-04-15',
        description: 'BACS CREDIT ACME CORP PAYMENT REF 1234',
      }),
      accountEntityId: 'autonize-it-ltd',
      contractRegistry: FULL_REGISTRY,
      clientRegistry: CLIENTS,
    });
    expect(result.kind).toBe('no-known-payer');
  });
});
