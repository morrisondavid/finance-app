import { describe, it, expect } from 'vitest';
import { AiTransactionDrillQuerySchema } from '../../../shared/api-contracts.js';
import { drillQueryToTransactionFilters } from './compose-ai-transaction-drill.js';

describe('drillQueryToTransactionFilters', () => {
  it('sets type expense when merchantModalLabel is provided and type omitted', () => {
    const q = AiTransactionDrillQuerySchema.parse({
      financialYear: '2025/26',
      merchantModalLabel: 'Coffee',
      limit: 20,
    });
    expect(drillQueryToTransactionFilters(q)).toMatchObject({
      type: 'expense',
      financialYear: '2025/26',
      merchantModalLabel: 'Coffee',
    });
  });
});
