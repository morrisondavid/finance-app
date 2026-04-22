/**
 * Cross-index invariants for the transaction-overrides registry.
 *
 * Only one index exists today. The invariants below are placeholders
 * that become meaningful when more indexes are added (e.g. a reverse
 * byCategory index). Keeping the file present enforces the canonical
 * layout across every registry directory.
 */

import { describe, it, expect } from 'vitest';
import { buildOverrideRegistry } from './registry.js';
import { makeTestOverrideRegistry } from './fixtures.js';

describe('transaction-overrides registry invariants', () => {
  it('byHash is always a plain ReadonlyMap', () => {
    const reg = buildOverrideRegistry();
    expect(reg.indexes.byHash).toBeInstanceOf(Map);
  });

  it('fixture-built registries expose the same byHash index as production loader', () => {
    const reg = makeTestOverrideRegistry({
      entries: [['abc', 'Inter-company Loan'], ['def', 'Capital Contribution']],
    });
    expect(reg.indexes.byHash.size).toBe(2);
    expect(reg.indexes.byHash.get('abc')).toBe('Inter-company Loan');
    expect(reg.indexes.byHash.get('def')).toBe('Capital Contribution');
  });
});
