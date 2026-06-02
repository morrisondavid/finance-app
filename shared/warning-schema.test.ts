/**
 * Schema-level regression locks for the §1.8 additive extension to
 * `EntityFoundationWarningSchema`. The legacy 7-field shape must still
 * parse byte-for-byte; the new optional `context` and `entityId` must
 * round-trip when present.
 */

import { describe, it, expect } from 'vitest';
import {
  EntityFoundationWarningSchema,
  WarningSchema,
  type EntityFoundationWarning,
  type Warning,
} from './api-contracts.js';

const legacyRow = {
  id: 'legacy-1',
  code: 'company-tbc-fields',
  severity: 'warn',
  title: 'Legacy title',
  detail: 'Legacy detail',
  recommended_action: 'Legacy action',
  sources: ['company:autonize-it-ltd'],
} as const;

describe('EntityFoundationWarningSchema (1.8 additive)', () => {
  it('parses the legacy 7-field shape unchanged', () => {
    const parsed = EntityFoundationWarningSchema.parse(legacyRow);
    expect(parsed.id).toBe('legacy-1');
    expect(parsed.context).toBeUndefined();
    expect(parsed.entityId).toBeUndefined();
  });

  it('parses a row carrying optional context primitives', () => {
    const parsed = EntityFoundationWarningSchema.parse({
      ...legacyRow,
      id: 'with-context',
      context: {
        ratio: 1.0,
        topClientId: 'delta-capita',
        topClientMonthly: 10000,
        threshold: 0.8,
      },
      entityId: 'autonize-it-ltd',
    });
    expect(parsed.context?.ratio).toBe(1.0);
    expect(parsed.context?.topClientId).toBe('delta-capita');
    expect(parsed.entityId).toBe('autonize-it-ltd');
  });

  it('rejects nested objects in context (flat-only)', () => {
    expect(() =>
      EntityFoundationWarningSchema.parse({
        ...legacyRow,
        context: { nested: { wat: 1 } as unknown as number },
      }),
    ).toThrow();
  });

  it('accepts every new §1.6/§1.7/§1.8 code', () => {
    const newCodes = [
      'runway-low',
      'runway-mandatory-low',
      'trapped-cash',
      'client-concentration-extreme',
      'client-concentration-elevated',
      'time-independence-low',
      'time-independence-elevated',
      'mode-concentration-extreme',
      'passive-income-zero',
      'leveraged-passive-income',
      'tax-reserve-underfunded',
      'tax-reserve-trajectory-missing',
      'ad-hoc-spend-escalating',
      'warning-improved',
      'warning-cleared',
    ] as const;
    for (const code of newCodes) {
      const parsed = EntityFoundationWarningSchema.parse({ ...legacyRow, code });
      expect(parsed.code).toBe(code);
    }
  });

  it('accepts every new §1.9 Debt Strategy code', () => {
    const newCodes = [
      'account-credit-card-config-missing',
      'plan-blocked-incomplete-budgets',
      'plan-blocked-fzco-no-savings-account',
      'mortgage-rate-reset-soon',
      'debt-unregistered',
      'plan-feasibility-degraded',
      'plan-budget-blown',
      'plan-transfer-not-set-up',
      'plan-transfer-missed',
      'plan-standing-order-can-be-stopped',
      'plan-infeasible',
      'plan-target-reached',
      'accountant-pack-incomplete-vat',
      'accountant-pack-incomplete-ct',
    ] as const;
    for (const code of newCodes) {
      const parsed = EntityFoundationWarningSchema.parse({ ...legacyRow, code });
      expect(parsed.code).toBe(code);
    }
  });

  it('Warning alias resolves to the same shape', () => {
    const w: Warning = WarningSchema.parse(legacyRow);
    const ef: EntityFoundationWarning = w;
    expect(ef.code).toBe(legacyRow.code);
  });
});
