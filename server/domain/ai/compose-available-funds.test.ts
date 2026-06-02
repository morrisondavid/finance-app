import { describe, it, expect, vi } from 'vitest';

vi.mock('../../config/exchange-rates.js', () => ({
  convertAmountSync: (amount: number) => amount,
}));

vi.mock('../../db/repositories/balance.js', () => ({
  getAllAccountBalances: () => [],
}));

function commitmentsOverview(totalCommittedGbp: number) {
  return {
    horizonStartDate: '2026-05-31',
    horizonEndDate: '2027-05-31',
    horizonLabel: 'Next 12 months (to 31 May 2027)',
    significantThresholdGbp: 2000,
    totalCommittedGbp,
    cashAfterCommitmentsGbp: 45_000 - totalCommittedGbp,
    lines: [],
  };
}

const buildLiquidityCommitmentsMock = vi.fn(
  (_input: { todayIso: string; totalCashGbp: number; months?: number }) =>
    commitmentsOverview(184_263.19),
);

vi.mock('../accounts/liquidity-commitments.js', () => ({
  buildLiquidityCommitments: (input: { todayIso: string; totalCashGbp: number; months?: number }) =>
    buildLiquidityCommitmentsMock(input),
}));

vi.mock('../accounts/liquidity-overview.js', () => ({
  buildLiquidityOverview: () => ({ totalCashGbp: 45_000 }),
}));

vi.mock('../company/queries.js', async () => {
  const { parseCompanyRow } = await import('../company/csv-io.js');
  const { ukRow } = await import('../company/test-helpers.js');
  return {
    companyById: () => parseCompanyRow(ukRow),
  };
});

vi.mock('../clients/queries.js', () => ({
  findClientById: (clientId: string) =>
    clientId === 'client-a' ? { trading_name: 'Client A' } : null,
}));

vi.mock('../forecast/load-inputs.js', () => ({
  loadForecastInputs: () => ({
    today: '2026-05-31',
    horizonDays: 1830,
    contracts: [{
      id: 'c1',
      client_id: 'client-a',
      reference: 'Client A · 2026',
      issuing_entity_id: 'autonize-it-ltd',
      end_date: '2026-12-31',
      day_rate: 550,
      day_rate_currency: 'GBP',
    }],
    unpaidInvoices: [],
  }),
}));

vi.mock('../contracts/expected-receipts.js', () => ({
  buildExpectedReceipts: () => ({
    receipts: [
      {
        expectedDate: '2026-07-30',
        amount: 5000,
        currency: 'GBP',
        account: 'barclays-current',
        source: 'accrual',
        contractId: 'c1',
        invoiceId: null,
      },
      {
        expectedDate: '2027-06-01',
        amount: 3000,
        currency: 'GBP',
        account: 'barclays-current',
        source: 'accrual',
        contractId: 'c1',
        invoiceId: null,
      },
    ],
  }),
}));

import { composeAiAvailableFunds } from './compose-available-funds.js';
import { buildLiquidityCommitments } from '../accounts/liquidity-commitments.js';
import { calculateRetainedReserves } from '../../config/tax-rates.js';
import { round2 } from '../../utils/math.js';
import { isoDateAddCalendarMonths } from '../../../shared/iso-date.js';
import { parseCompanyRow } from '../company/csv-io.js';
import { ukRow } from '../company/test-helpers.js';

const ukCompany = parseCompanyRow(ukRow);

describe('composeAiAvailableFunds', () => {
  it('uses months window and after-tax retained income for totals', () => {
    const result = composeAiAvailableFunds({ months: 12 });

    expect(result.projectionEndDate).toBe(isoDateAddCalendarMonths('2026-05-31', 12));
    expect(result.confirmedFutureIncomeGrossGbp).toBe(5000);
    const claim = calculateRetainedReserves(5000, ukCompany);
    expect(result.confirmedFutureIncomeRetainedGbp).toBe(claim.retained_period);
    expect(result.futureIncomeCtReserveGbp).toBe(claim.ct_reserve_period);
    expect(result.totalFundsGbp).toBe(round2(45_000 + claim.retained_period));
    expect(result.netAfterCommitmentsGbp).toBe(
      round2(45_000 + claim.retained_period - 184_263.19),
    );
    expect(buildLiquidityCommitmentsMock).toHaveBeenCalledWith({
      todayIso: '2026-05-31',
      totalCashGbp: 45_000,
      months: 12,
    });
  });

  it('scopes income and committed to a 3-month window', () => {
    buildLiquidityCommitmentsMock.mockReturnValueOnce(commitmentsOverview(50_000));
    const result = composeAiAvailableFunds({ months: 3 });
    expect(result.projectionEndDate).toBe(isoDateAddCalendarMonths('2026-05-31', 3));
    expect(result.confirmedFutureIncomeGrossGbp).toBe(5000);
    expect(buildLiquidityCommitmentsMock).toHaveBeenCalledWith(
      expect.objectContaining({ months: 3 }),
    );
  });

  it('builds gross breakdown grouped by client and final payment', () => {
    const result = composeAiAvailableFunds();
    const retained = calculateRetainedReserves(5000, ukCompany).retained_period;

    expect(result.futureIncomeByClient).toEqual([
      {
        clientId: 'client-a',
        label: 'Client A',
        totalGbp: 5000,
        retainedGbp: retained,
      },
    ]);
    expect(result.futureIncomeByContract).toEqual(result.futureIncomeByClient);
    expect(result.lastContractPayment).toEqual({
      date: '2026-07-30',
      amountGbp: 5000,
      label: 'Client A',
    });
    expect(result.futureIncome).toHaveLength(1);
  });

  it('committedOutflowsGbp equals buildLiquidityCommitments totalCommittedGbp', () => {
    const result = composeAiAvailableFunds();
    const commitments = buildLiquidityCommitments({
      todayIso: '2026-05-31',
      totalCashGbp: result.availableNowGbp,
      months: 12,
    });
    expect(result.committedOutflowsGbp).toBe(commitments.totalCommittedGbp);
  });

  it('exposes the full committedOutflows overview for the dashboard panel', () => {
    const result = composeAiAvailableFunds({ months: 12 });
    expect(result.committedOutflows.totalCommittedGbp).toBe(result.committedOutflowsGbp);
    expect(result.committedOutflows.horizonLabel).toContain('Next 12 months');
  });
});
