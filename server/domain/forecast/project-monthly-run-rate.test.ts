/**
 * Unit tests for the canonical monthly run-rate primitive.
 *
 * Drives `projectMonthlyRunRate` with synthetic `LoadedForecastInputs`
 * via mocks. The intent is to lock the steady-state contract +
 * recurring-income bucketing behaviour without standing up a real DB.
 * Real `calculateWorkload` is used (it's a pure function over the
 * inputs we control), so the workload sums are exercised end-to-end.
 */

import { describe, it, expect, vi } from 'vitest';
import type {
  AccountName,
  Contract,
  CurrencyCode,
  EntityId,
  LeaveRow,
  RecurringExpense,
} from '../../../shared/api-contracts.js';
import type { PipelineResult } from '../../utils/recurring-pipeline.js';
import type { UpcomingRecurringBuckets } from '../../utils/recurring-upcoming.js';
import type { LoadedForecastInputs } from './load-inputs.js';

const loadForecastInputsMock = vi.fn();
vi.mock('./load-inputs.js', () => ({
  loadForecastInputs: () => loadForecastInputsMock(),
}));

import {
  projectMonthlyRunRate,
  recurringIncomeStableKey,
  DEFAULT_RUN_RATE_WINDOW_DAYS,
} from './project-monthly-run-rate.js';
import { bucketKey } from './project-income.js';

// ── Fixtures ───────────────────────────────────────────────────────

function emptyPipeline(monthlyIncomeRecurring: RecurringExpense[] = []): PipelineResult {
  return {
    expenseCandidates: [],
    incomeCandidates: [],
    expenseAccumulators: new Map(),
    incomeAccumulators: new Map(),
    monthlyExpenseRecurring: [],
    annualExpenseRecurring: [],
    monthlyIncomeRecurring,
    annualIncomeRecurring: [],
    monthsCovered: 12,
  };
}

function emptyBuckets(): UpcomingRecurringBuckets {
  return { thisMonth: [], thisYear: [] };
}

const ACCOUNTS_BY_ENTITY: ReadonlyMap<EntityId, readonly AccountName[]> = new Map([
  ['autonize-it-ltd', ['barclays-current']],
  ['autonize-it-fzco', ['emirates-islamic']],
]);

const CURRENCY_BY_ACCOUNT: ReadonlyMap<AccountName, CurrencyCode> = new Map([
  ['barclays-current', 'GBP'],
  ['barclays-savings', 'GBP'],
  ['capital-on-tap', 'GBP'],
  ['barclaycard', 'GBP'],
  ['wise-ltd', 'GBP'],
  ['natwest', 'GBP'],
  ['natwest-savings', 'GBP'],
  ['monzo-joint', 'GBP'],
  ['emirates-islamic', 'AED'],
  ['santander-everyday', 'GBP'],
]);

function preLoaded(over: Partial<LoadedForecastInputs> = {}): LoadedForecastInputs {
  return {
    today: '2026-04-27',
    horizon: '2026-06-26',
    horizonDays: 60,
    startingBalances: [],
    obligations: [],
    pipeline: emptyPipeline(),
    upcomingBuckets: emptyBuckets(),
    unpaidInvoices: [],
    contracts: [],
    leaveRows: [],
    publicHolidayDatesByEntity: new Map(),
    currencyByAccount: CURRENCY_BY_ACCOUNT,
    accountsByEntity: ACCOUNTS_BY_ENTITY,
    defaultAccountByType: new Map(),
    allowedAccountSet: new Set(),
    ...over,
  };
}

function makeContract(over: Partial<Contract> & Pick<Contract, 'id'>): Contract {
  return {
    id: over.id,
    client_id: over.client_id ?? 'delta-capita',
    issuing_entity_id: over.issuing_entity_id ?? 'autonize-it-ltd',
    master_id: null,
    reference: over.reference ?? `REF-${over.id}`,
    placement_ref: over.placement_ref ?? null,
    start_date: over.start_date ?? '2026-01-01',
    end_date: over.end_date ?? null,
    works_monday: over.works_monday ?? true,
    works_tuesday: over.works_tuesday ?? true,
    works_wednesday: over.works_wednesday ?? true,
    works_thursday: over.works_thursday ?? true,
    works_friday: over.works_friday ?? true,
    works_saturday: over.works_saturday ?? false,
    works_sunday: over.works_sunday ?? false,
    day_rate: over.day_rate ?? 600,
    day_rate_currency: over.day_rate_currency ?? 'GBP',
    invoice_currency: over.invoice_currency ?? 'GBP',
    invoice_cadence: over.invoice_cadence ?? 'monthly',
    invoice_mechanism: over.invoice_mechanism ?? 'self-bill',
    payment_terms_days: over.payment_terms_days ?? 30,
    company_notice_weeks: over.company_notice_weeks ?? 4,
    supplier_notice_weeks: over.supplier_notice_weeks ?? 4,
    renewal_warning_days: over.renewal_warning_days ?? 30,
    job_title: over.job_title ?? 'Engineer',
    job_description: null,
    work_location: over.work_location ?? 'Remote',
    conduct_regs: null,
    engagement_tax_status: null,
    jurisdiction: over.jurisdiction ?? 'England',
    signed_at: over.signed_at ?? '2025-12-15',
    docusign_envelope: null,
    active: over.active ?? true,
    updated_at: null,
  };
}

function makeRecurringIncome(over: Partial<RecurringExpense> & {
  merchant: string;
  amount: number;
  sourceAccount: AccountName;
}): RecurringExpense {
  return {
    merchant: over.merchant,
    category: over.category ?? 'Income',
    colour: over.colour ?? '#000',
    amount: over.amount,
    frequency: 'monthly',
    monthsActive: over.monthsActive ?? 12,
    annualTotal: over.amount * 12,
    logoUrl: null,
    sourceAccount: over.sourceAccount,
    billingDayOfMonth: null,
    billingMonth: null,
    nativeAmount: over.nativeAmount,
    nativeCurrency: over.nativeCurrency,
    ...(over.declaredObligationId !== undefined
      ? { declaredObligationId: over.declaredObligationId }
      : {}),
  };
}

let leaveSeq = 0;
function makeLeaveDay(contractId: string, date: string): LeaveRow {
  leaveSeq++;
  return {
    id: `leave-${leaveSeq}`,
    contract_id: contractId,
    date,
    type: 'holiday',
    notes: null,
    external_logged: false,
    created_at: '2026-01-01',
    updated_at: '2026-01-01',
  };
}

// ── Tests ─────────────────────────────────────────────────────────

describe('projectMonthlyRunRate — contract accrual', () => {
  it('active GBP contract at £600/day across 30 days lands in GBP::autonize-it-ltd', () => {
    const contract = makeContract({ id: 'dc-2026', day_rate: 600 });
    loadForecastInputsMock.mockReturnValue(preLoaded({ contracts: [contract] }));

    const out = projectMonthlyRunRate({ today: '2026-04-27' });

    const bucket = out.byBucket.get(bucketKey('GBP', 'autonize-it-ltd'));
    expect(bucket).toBeDefined();
    // 2026-04-27 to 2026-05-27 inclusive on Mon-Fri schedule = ~22 working days × £600 ≈ £13,200.
    expect(bucket!.contractAccrual).toBeGreaterThanOrEqual(11400); // floor: 19 working days
    expect(bucket!.contractAccrual).toBeLessThanOrEqual(14400);    // ceiling: 24 working days
    expect(bucket!.recurringIncome).toBe(0);
    expect(bucket!.contributingContractIds).toEqual(['dc-2026']);
  });

  it('leave days within the window reduce the workload subtotal', () => {
    const contract = makeContract({ id: 'dc-2026', day_rate: 600 });
    const leaveRows: LeaveRow[] = [
      makeLeaveDay('dc-2026', '2026-04-29'),
      makeLeaveDay('dc-2026', '2026-04-30'),
      makeLeaveDay('dc-2026', '2026-05-01'),
      makeLeaveDay('dc-2026', '2026-05-04'),
      makeLeaveDay('dc-2026', '2026-05-05'),
    ];
    loadForecastInputsMock.mockReturnValueOnce(preLoaded({ contracts: [contract] }));
    const baseline = projectMonthlyRunRate({ today: '2026-04-27' });
    const baselineSum = baseline.byBucket.get(bucketKey('GBP', 'autonize-it-ltd'))!.contractAccrual;

    loadForecastInputsMock.mockReturnValueOnce(preLoaded({ contracts: [contract], leaveRows }));
    const onLeave = projectMonthlyRunRate({ today: '2026-04-27' });
    const leaveSum = onLeave.byBucket.get(bucketKey('GBP', 'autonize-it-ltd'))!.contractAccrual;

    // 5 leave days × £600 = £3,000 less.
    expect(baselineSum - leaveSum).toBe(3000);
  });

  it('contract ending mid-window clips workload to days 0..endDate', () => {
    // Contract ends on day 5 of the window — only 5 working days max counted.
    const contract = makeContract({
      id: 'short-tail',
      day_rate: 600,
      end_date: '2026-05-04', // ~5-7 calendar days after today (2026-04-27)
    });
    loadForecastInputsMock.mockReturnValue(preLoaded({ contracts: [contract] }));

    const out = projectMonthlyRunRate({ today: '2026-04-27' });

    const sum = out.byBucket.get(bucketKey('GBP', 'autonize-it-ltd'))!.contractAccrual;
    // 2026-04-27 (Mon) through 2026-05-04 (Mon) inclusive Mon-Fri = up to 6 working days × 600 = 3600.
    expect(sum).toBeGreaterThanOrEqual(2400);
    expect(sum).toBeLessThanOrEqual(3600);
  });

  it('contract whose end_date is before today is skipped entirely (no bucket entry)', () => {
    const contract = makeContract({
      id: 'ended',
      day_rate: 600,
      end_date: '2026-03-31',
    });
    loadForecastInputsMock.mockReturnValue(preLoaded({ contracts: [contract] }));

    const out = projectMonthlyRunRate({ today: '2026-04-27' });
    expect(out.byBucket.size).toBe(0);
  });

  it('inactive contract (active: false) is skipped', () => {
    const contract = makeContract({ id: 'paused', active: false });
    loadForecastInputsMock.mockReturnValue(preLoaded({ contracts: [contract] }));

    const out = projectMonthlyRunRate({ today: '2026-04-27' });
    expect(out.byBucket.size).toBe(0);
  });
});

describe('projectMonthlyRunRate — recurring income', () => {
  it('rental income on a personal account lands in GBP::household', () => {
    const rental = makeRecurringIncome({
      merchant: 'Heath Park tenant',
      amount: 2500,
      sourceAccount: 'natwest',
    });
    loadForecastInputsMock.mockReturnValue(
      preLoaded({ pipeline: emptyPipeline([rental]) }),
    );

    const out = projectMonthlyRunRate({ today: '2026-04-27' });
    const bucket = out.byBucket.get(bucketKey('GBP', 'household'));
    expect(bucket?.recurringIncome).toBe(2500);
    expect(bucket?.contractAccrual).toBe(0);
    expect(bucket?.total).toBe(2500);
  });

  it('excludedContractIds skips accrual but still lists contract in sandboxIncomeSources', () => {
    const contract = makeContract({ id: 'dc-2026', day_rate: 600 });
    loadForecastInputsMock.mockReturnValue(preLoaded({ contracts: [contract] }));

    const gated = projectMonthlyRunRate({
      today: '2026-04-27',
      excludedContractIds: ['dc-2026'],
    });
    expect(gated.byBucket.size).toBe(0);
    expect(gated.sandboxIncomeSources.contracts).toHaveLength(1);
    expect(gated.sandboxIncomeSources.contracts[0]).toMatchObject({
      contractId: 'dc-2026',
      bucketKey: bucketKey('GBP', 'autonize-it-ltd'),
    });
    expect(gated.sandboxIncomeSources.contracts[0].monthlyAccrual).toBeGreaterThan(0);
  });

  it('excludedRecurringIncomeKeys skips recurring but keeps it in sandboxIncomeSources', () => {
    const rental = makeRecurringIncome({
      merchant: 'Heath Park tenant',
      amount: 2500,
      sourceAccount: 'natwest',
    });
    loadForecastInputsMock.mockReturnValue(
      preLoaded({ pipeline: emptyPipeline([rental]) }),
    );

    const key = recurringIncomeStableKey(rental);

    const gated = projectMonthlyRunRate({
      today: '2026-04-27',
      excludedRecurringIncomeKeys: [key],
    });
    expect(gated.byBucket.size).toBe(0);
    expect(gated.sandboxIncomeSources.recurring).toHaveLength(1);
    expect(gated.sandboxIncomeSources.recurring[0].key).toBe(key);
    expect(gated.sandboxIncomeSources.recurring[0].monthlyAmount).toBe(2500);
  });

  it('declared recurring uses declared:* key and exclusion matches', () => {
    const row = makeRecurringIncome({
      merchant: 'Rent',
      amount: 100,
      sourceAccount: 'natwest',
      declaredObligationId: 'obl-income-1',
    });
    loadForecastInputsMock.mockReturnValue(
      preLoaded({ pipeline: emptyPipeline([row]) }),
    );

    const full = projectMonthlyRunRate({ today: '2026-04-27' });
    expect(full.sandboxIncomeSources.recurring[0].key).toBe('declared:obl-income-1');

    const gated = projectMonthlyRunRate({
      today: '2026-04-27',
      excludedRecurringIncomeKeys: ['declared:obl-income-1'],
    });
    expect(gated.byBucket.size).toBe(0);
  });

  it('contract + recurring on the same bucket sum together', () => {
    const contract = makeContract({ id: 'dc-2026', day_rate: 600 });
    const sharedAccountRental = makeRecurringIncome({
      merchant: 'Co-located tenant',
      amount: 1500,
      sourceAccount: 'barclays-current', // same as contract
    });
    loadForecastInputsMock.mockReturnValue(
      preLoaded({
        contracts: [contract],
        pipeline: emptyPipeline([sharedAccountRental]),
      }),
    );

    const out = projectMonthlyRunRate({ today: '2026-04-27' });
    const bucket = out.byBucket.get(bucketKey('GBP', 'autonize-it-ltd'))!;
    expect(bucket.recurringIncome).toBe(1500);
    expect(bucket.contractAccrual).toBeGreaterThan(0);
    expect(bucket.total).toBe(bucket.contractAccrual + 1500);
  });

  it('uses nativeAmount/nativeCurrency for AED items', () => {
    const aedRecurring = makeRecurringIncome({
      merchant: 'AED Subscription',
      amount: 1000, // GBP equivalent; ignored when nativeAmount is set
      sourceAccount: 'emirates-islamic',
      nativeAmount: 5000,
      nativeCurrency: 'AED',
    });
    loadForecastInputsMock.mockReturnValue(
      preLoaded({ pipeline: emptyPipeline([aedRecurring]) }),
    );

    const out = projectMonthlyRunRate({ today: '2026-04-27' });
    expect(out.byBucket.get(bucketKey('AED', 'autonize-it-fzco'))?.recurringIncome).toBe(5000);
    expect(out.byBucket.get(bucketKey('GBP', 'autonize-it-fzco'))).toBeUndefined();
  });

  it('zero-amount items are skipped', () => {
    const zero = makeRecurringIncome({
      merchant: 'Zero Income',
      amount: 0,
      sourceAccount: 'natwest',
    });
    loadForecastInputsMock.mockReturnValue(
      preLoaded({ pipeline: emptyPipeline([zero]) }),
    );

    const out = projectMonthlyRunRate({ today: '2026-04-27' });
    expect(out.byBucket.size).toBe(0);
  });
});

describe('projectMonthlyRunRate — multi-currency / bucketFilter', () => {
  it('AED contract on FZCO accounts lands in AED::autonize-it-fzco', () => {
    const aedContract = makeContract({
      id: 'fzco-2026',
      day_rate: 2200,
      day_rate_currency: 'AED',
      invoice_currency: 'AED',
      issuing_entity_id: 'autonize-it-fzco',
    });
    loadForecastInputsMock.mockReturnValue(preLoaded({ contracts: [aedContract] }));

    const out = projectMonthlyRunRate({ today: '2026-04-27' });
    const bucket = out.byBucket.get(bucketKey('AED', 'autonize-it-fzco'));
    expect(bucket).toBeDefined();
    expect(bucket!.contractAccrual).toBeGreaterThan(0);
  });

  it('bucketFilter.currency narrows correctly', () => {
    const gbp = makeContract({ id: 'gbp', day_rate: 600 });
    const aed = makeContract({
      id: 'aed',
      day_rate: 2200,
      issuing_entity_id: 'autonize-it-fzco',
    });
    loadForecastInputsMock.mockReturnValue(preLoaded({ contracts: [gbp, aed] }));

    const out = projectMonthlyRunRate({
      today: '2026-04-27',
      bucketFilter: { currency: 'GBP' },
    });
    expect(out.byBucket.get(bucketKey('GBP', 'autonize-it-ltd'))).toBeDefined();
    expect(out.byBucket.get(bucketKey('AED', 'autonize-it-fzco'))).toBeUndefined();
  });

  it('bucketFilter.scope narrows correctly', () => {
    const business = makeContract({ id: 'biz', day_rate: 600 });
    const personalRental = makeRecurringIncome({
      merchant: 'Tenant',
      amount: 2500,
      sourceAccount: 'natwest',
    });
    loadForecastInputsMock.mockReturnValue(
      preLoaded({
        contracts: [business],
        pipeline: emptyPipeline([personalRental]),
      }),
    );

    const out = projectMonthlyRunRate({
      today: '2026-04-27',
      bucketFilter: { scope: 'household' },
    });
    expect(out.byBucket.get(bucketKey('GBP', 'household'))?.recurringIncome).toBe(2500);
    expect(out.byBucket.get(bucketKey('GBP', 'autonize-it-ltd'))).toBeUndefined();
  });
});

describe('projectMonthlyRunRate — defaults + edge cases', () => {
  it('uses DEFAULT_RUN_RATE_WINDOW_DAYS (30) when windowDays is omitted', () => {
    loadForecastInputsMock.mockReturnValue(preLoaded());
    const out = projectMonthlyRunRate({ today: '2026-04-27' });
    expect(out.windowDays).toBe(DEFAULT_RUN_RATE_WINDOW_DAYS);
    expect(out.windowDays).toBe(30);
  });

  it('honours an explicit windowDays', () => {
    loadForecastInputsMock.mockReturnValue(preLoaded());
    const out = projectMonthlyRunRate({ today: '2026-04-27', windowDays: 90 });
    expect(out.windowDays).toBe(90);
  });

  it('contract whose entity has no primary account is skipped (no crash)', () => {
    const orphan = makeContract({
      id: 'orphan',
      issuing_entity_id: 'autonize-it-ltd',
    });
    loadForecastInputsMock.mockReturnValue(
      preLoaded({
        contracts: [orphan],
        accountsByEntity: new Map(), // empty — no primary account anywhere
      }),
    );

    const out = projectMonthlyRunRate({ today: '2026-04-27' });
    expect(out.byBucket.size).toBe(0);
  });
});
