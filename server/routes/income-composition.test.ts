/**
 * Envelope: {@link IncomeCompositionResponseSchema} stays aligned with the
 * GET /api/income-composition shape. The route composes registries + DB
 * data identically to runway/forecast (HTTP stack covered manually).
 */
import { describe, it, expect } from 'vitest';
import { IncomeCompositionResponseSchema } from '../../shared/api-contracts.js';

describe('IncomeCompositionResponseSchema', () => {
  it('accepts a minimal valid payload', () => {
    const body = {
      today: '2026-01-15',
      household: {
        GBP: {
          clientConcentration: {
            ratio: 1,
            topClientId: 'delta-capita',
            topClientMonthly: 10000,
            totalActiveMonthly: 10000,
          },
          activePassiveRatio: {
            ratio: 0.15,
            passiveMonthly: 1500,
            activeMonthly: 8500,
            totalMonthly: 10000,
            passiveByKind: {
              contract: 0,
              'rental-income': 1500,
              'recurring-detected': 0,
            },
          },
          timeIndependence: {
            ratio: 0.2,
            passiveMonthly: 1500,
            mandatoryMonthly: 7500,
          },
        },
      },
      byEntity: [
        {
          entityId: 'autonize-it-ltd',
          currency: 'GBP',
          metrics: {
            clientConcentration: {
              ratio: 1,
              topClientId: 'delta-capita',
              topClientMonthly: 10000,
              totalActiveMonthly: 10000,
            },
            activePassiveRatio: {
              ratio: 0,
              passiveMonthly: 0,
              activeMonthly: 10000,
              totalMonthly: 10000,
              passiveByKind: { contract: 0, 'rental-income': 0, 'recurring-detected': 0 },
            },
            timeIndependence: {
              ratio: 0,
              passiveMonthly: 0,
              mandatoryMonthly: 7500,
            },
          },
        },
      ],
      sources: [
        {
          kind: 'contract',
          id: 'c-dc',
          label: 'Delta Capita',
          monthlyAmount: 10000,
          currency: 'GBP',
          entityId: 'autonize-it-ltd',
          activityClass: 'active',
          propertyId: null,
          clientId: 'delta-capita',
        },
      ],
      riskSignals: [
        {
          code: 'client-concentration-extreme',
          severity: 'high',
          currency: 'GBP',
          ratio: 1,
          topClientId: 'delta-capita',
          topClientMonthly: 10000,
          totalActiveMonthly: 10000,
          threshold: 0.8,
        },
        {
          code: 'leveraged-passive-income',
          severity: 'high',
          propertyId: 'hunters-square-78',
          grossMonthly: 1000,
          mortgageMonthly: 800,
          netMonthly: 200,
          netToGrossRatio: 0.2,
          threshold: 0.3,
        },
      ],
    };
    const parsed = IncomeCompositionResponseSchema.safeParse(body);
    expect(parsed.success, parsed.error?.message).toBe(true);
  });
});
