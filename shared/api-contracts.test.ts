import { describe, it, expect } from 'vitest';
import {
  VATPaymentsResponseSchema,
  HmrcPaymentMatchSchema,
  AccountConfigsResponseSchema,
  DashboardSummaryResponseSchema,
  TaxLiabilitiesSchema,
  OverdueObligationsResponseSchema,
  UpcomingRecurringSchema,
  UpcomingPaymentItemSchema,
  UpcomingPaymentsResponseSchema,
  DismissalSchema,
  CreateDismissalBodySchema,
  DismissalsListResponseSchema,
  DebtCreateBodySchema,
  DebtUpdateBodySchema,
  EntityIdSchema,
  JurisdictionSchema,
  CompanySchema,
  UkCompanySchema,
  UaeCompanySchema,
} from './api-contracts.js';

describe('HmrcPaymentMatchSchema', () => {
  it('validates a typical HMRC VAT payment (no type field)', () => {
    const payment = {
      date: '2025-09-08',
      amount: -8060,
      account: 'barclays-current',
      description: 'HMRC VAT SOUTHEND\t292146596 BBP',
    };
    const result = HmrcPaymentMatchSchema.safeParse(payment);
    expect(result.success).toBe(true);
  });

  it('rejects a payment missing account', () => {
    const result = HmrcPaymentMatchSchema.safeParse({
      date: '2025-09-08',
      amount: -8060,
      description: 'HMRC VAT',
    });
    expect(result.success).toBe(false);
  });

  it('rejects a payment missing description', () => {
    const result = HmrcPaymentMatchSchema.safeParse({
      date: '2025-09-08',
      amount: -8060,
      account: 'barclays-current',
    });
    expect(result.success).toBe(false);
  });
});

describe('VATPaymentsResponseSchema', () => {
  it('validates an array of HmrcPaymentMatch objects', () => {
    const response = {
      payments: [
        { date: '2025-09-08', amount: -8060, account: 'barclays-current', description: 'HMRC VAT SOUTHEND' },
        { date: '2025-12-08', amount: -11653.06, account: 'barclays-current', description: 'HMRC VAT SOUTHEND' },
        { date: '2025-06-09', amount: -5578.79, account: 'capital-on-tap', description: 'HMRC ETMP - GLASGOW - Card Ending: 8346' },
      ],
    };
    const result = VATPaymentsResponseSchema.safeParse(response);
    expect(result.success).toBe(true);
  });

  it('validates an empty payments array', () => {
    const result = VATPaymentsResponseSchema.safeParse({ payments: [] });
    expect(result.success).toBe(true);
  });

  it('does NOT require a transaction type field on payments', () => {
    const withoutType = {
      payments: [
        { date: '2025-09-08', amount: -8060, account: 'barclays-current', description: 'HMRC VAT' },
      ],
    };
    expect(VATPaymentsResponseSchema.safeParse(withoutType).success).toBe(true);

    const withType = {
      payments: [
        { date: '2025-09-08', amount: -8060, account: 'barclays-current', description: 'HMRC VAT', type: 'expense' },
      ],
    };
    expect(VATPaymentsResponseSchema.safeParse(withType).success).toBe(true);
  });

  it('rejects payments missing required fields', () => {
    const result = VATPaymentsResponseSchema.safeParse({
      payments: [{ date: '2025-09-08', amount: -100 }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects a bare array (must be wrapped in { payments })', () => {
    const result = VATPaymentsResponseSchema.safeParse([
      { date: '2025-09-08', amount: -8060, account: 'barclays-current', description: 'HMRC VAT' },
    ]);
    expect(result.success).toBe(false);
  });
});

describe('AccountConfigsResponseSchema', () => {
  const validBusinessConfig = {
    name: 'barclays-current',
    label: 'Barclays Current',
    type: 'current',
    currency: 'GBP',
    category: 'business',
    canMakeOutgoingPayments: true,
    excludeTransfersFromIncome: true,
    showTaxLiabilities: true,
  };

  const validPersonalConfig = {
    name: 'natwest',
    label: 'NatWest',
    type: 'current',
    currency: 'GBP',
    category: 'personal',
    canMakeOutgoingPayments: true,
    excludeTransfersFromIncome: false,
    showTaxLiabilities: false,
  };

  it('validates configs with category field', () => {
    const result = AccountConfigsResponseSchema.safeParse([validBusinessConfig, validPersonalConfig]);
    expect(result.success).toBe(true);
  });

  it('rejects configs using deprecated ownership field instead of category', () => {
    const staleConfig = {
      name: 'barclays-current',
      label: 'Barclays Current',
      type: 'current',
      currency: 'GBP',
      ownership: 'business',
      canMakeOutgoingPayments: true,
      excludeTransfersFromIncome: true,
      showTaxLiabilities: true,
    };
    const result = AccountConfigsResponseSchema.safeParse([staleConfig]);
    expect(result.success).toBe(false);
  });

  it('strips extra server-only fields (business config) without failing', () => {
    const withBusinessTaxConfig = {
      ...validBusinessConfig,
      business: {
        jurisdiction: 'UK',
        vat: { applicable: true, rate: 0.2, registered: true },
        corpTax: { applicable: true, qualifyingFreeZone: false },
      },
      quarterOverlapMonths: 1,
    };
    const result = AccountConfigsResponseSchema.safeParse([withBusinessTaxConfig]);
    expect(result.success).toBe(true);
  });
});

describe('TaxLiabilitiesSchema', () => {
  const baseTaxLiabilities = {
    corporationTax: 50000,
    corporationTaxRate: 25,
    taxableProfit: 200000,
  };

  it('validates minimal tax liabilities (only required fields)', () => {
    const result = TaxLiabilitiesSchema.safeParse(baseTaxLiabilities);
    expect(result.success).toBe(true);
  });

  it('validates full tax liabilities with vatInProgressQuarter: null', () => {
    const full = {
      ...baseTaxLiabilities,
      vatOwedThisQuarter: 10828.42,
      vatOutstanding: 10828.42,
      vatOnIncome: 39559.62,
      vatPaidLast4Quarters: 33785.92,
      vatPaid: 33785.92,
      vatRate: 0.2,
      vatQuarter: {
        label: 'Feb-Apr 2026',
        quarter: 2,
        startDate: '2026-02-01',
        endDate: '2026-04-30',
        dueDate: '2026-06-07',
      },
      vatInProgressQuarter: null,
      vatInProgressEstimate: 0,
      davidTaxEstimate: 5000,
      davidPayments: { total: 30000, salary: 12000, dividends: 18000, annualSalary: 12000 },
      davidTaxBreakdown: { dividendTax: 5000 },
      heenaTaxEstimate: 3000,
      heenaPayments: { total: 20000, salary: 12000, dividends: 8000, annualSalary: 12000 },
      heenaTaxBreakdown: { dividendTax: 3000 },
    };
    const result = TaxLiabilitiesSchema.safeParse(full);
    expect(result.success).toBe(true);
  });

  it('validates tax liabilities with a non-null vatInProgressQuarter', () => {
    const withInProgress = {
      ...baseTaxLiabilities,
      vatInProgressQuarter: {
        label: 'Feb-Apr 2026',
        quarter: 2,
        startDate: '2026-02-01',
        endDate: '2026-04-30',
        dueDate: '2026-06-07',
      },
      vatInProgressEstimate: 5000,
    };
    const result = TaxLiabilitiesSchema.safeParse(withInProgress);
    expect(result.success).toBe(true);
  });
});

describe('DashboardSummaryResponseSchema', () => {
  const minimalDashboard = {
    totals: { income: 100, expenses: 50, net: 50, vatLiability: 10, transfersIn: 0, transfersOut: 0, passThroughIncome: 0 },
    monthly: [],
    byAccount: {},
    liquidityOverview: { totalCashGbp: 0, totalCreditGbp: 0, totalAvailableGbp: 0, lines: [] },
    taxLiabilities: {
      corporationTax: 50000,
      corporationTaxRate: 25,
      taxableProfit: 200000,
      vatInProgressQuarter: null,
    },
    transactionCount: 100,
    transferCount: 10,
    fileCount: 5,
    financialYears: ['2025/26'],
    selectedFinancialYear: null,
    liquidityCommitments: null,
  };

  it('validates a minimal dashboard response', () => {
    const result = DashboardSummaryResponseSchema.safeParse(minimalDashboard);
    if (!result.success) {
      const errors = result.error.issues.map(i => `${i.path.join('.')}: ${i.message}`);
      expect.fail(`Validation failed:\n${errors.join('\n')}`);
    }
    expect(result.success).toBe(true);
  });

  it('validates with balances and currentAccountBalance', () => {
    const withBalances = {
      ...minimalDashboard,
      balances: {
        'barclays-current': {
          balanceSemantics: 'cash',
          cashBalance: 51035.54,
          creditLimit: null,
          creditUsed: null,
          creditRemaining: null,
          debtOwed: null,
          openingBalance: 63035.54,
          transactionTotal: -12000,
          currentBalance: 51035.54,
          transactionCount: 500,
        },
      },
      currentAccountBalance: {
        balanceSemantics: 'cash',
        cashBalance: 51035.54,
        creditLimit: null,
        creditUsed: null,
        creditRemaining: null,
        debtOwed: null,
        openingBalance: 63035.54,
        transactionTotal: -12000,
        currentBalance: 51035.54,
        transactionCount: 500,
      },
      liquidityOverview: {
        totalCashGbp: 51035.54,
        totalCreditGbp: 0,
        totalAvailableGbp: 51035.54,
        lines: [
          {
            account: 'barclays-current',
            label: 'Barclays Current',
            kind: 'cash' as const,
            currency: 'GBP' as const,
            amountNative: 51035.54,
            amountGbp: 51035.54,
          },
        ],
      },
    };
    const result = DashboardSummaryResponseSchema.safeParse(withBalances);
    expect(result.success).toBe(true);
  });
});

describe('OverdueObligationsResponseSchema', () => {
  it('accepts a realistic overdue-obligations fixture', () => {
    const fixture = {
      obligations: [
        {
          id: 'manual-self-assessment-2025',
          source: 'manual',
          type: 'self-assessment',
          name: 'Self Assessment 2024/25',
          entity: 'HMRC',
          frequency: 'annual',
          expectedAmount: 12500,
          dueDate: '2026-01-31',
          status: 'pending',
          paidAmount: null,
          paidDate: null,
          paidFromAccount: null,
          notes: null,
          createdAt: '2026-01-01T00:00:00Z',
          updatedAt: '2026-01-01T00:00:00Z',
        },
      ],
    };
    const result = OverdueObligationsResponseSchema.safeParse(fixture);
    expect(result.success).toBe(true);
  });

  it('accepts an empty list', () => {
    const result = OverdueObligationsResponseSchema.safeParse({ obligations: [] });
    expect(result.success).toBe(true);
  });
});

describe('UpcomingRecurringSchema', () => {
  const baseItem = {
    merchant: 'Netflix',
    category: 'Subscriptions',
    colour: '#ff0000',
    logoUrl: null,
    amount: 9.99,
    frequency: 'monthly' as const,
    sourceAccount: 'barclays-current',
    nextExpectedDate: '2026-04-20',
    lastChargeDate: '2026-03-20',
  };

  it('accepts a complete upcoming-recurring item', () => {
    expect(UpcomingRecurringSchema.safeParse(baseItem).success).toBe(true);
  });

  it('accepts null lastChargeDate and logoUrl', () => {
    const result = UpcomingRecurringSchema.safeParse({
      ...baseItem,
      logoUrl: null,
      lastChargeDate: null,
    });
    expect(result.success).toBe(true);
  });

  it('rejects a missing nextExpectedDate', () => {
    const { nextExpectedDate: _drop, ...rest } = baseItem;
    void _drop;
    expect(UpcomingRecurringSchema.safeParse(rest).success).toBe(false);
  });

  it('rejects an invalid frequency', () => {
    const result = UpcomingRecurringSchema.safeParse({ ...baseItem, frequency: 'weekly' });
    expect(result.success).toBe(false);
  });
});

describe('UpcomingPaymentItemSchema', () => {
  const obligationItem = {
    kind: 'obligation' as const,
    id: 'auto-vat-2025-08-01',
    type: 'vat',
    name: 'VAT Aug-Oct 2025',
    entity: 'HMRC',
    expectedAmount: 11371.42,
    dueDate: '2025-12-07',
    status: 'paid',
    source: 'auto',
  };

  const recurringItem = {
    kind: 'recurring' as const,
    merchant: 'Domain Renewal',
    category: 'Software',
    colour: '#3b82f6',
    logoUrl: 'https://logo.clearbit.com/domain.com',
    amount: 25,
    sourceAccount: 'capital-on-tap',
    nextExpectedDate: '2026-11-15',
  };

  it('accepts an obligation item', () => {
    expect(UpcomingPaymentItemSchema.safeParse(obligationItem).success).toBe(true);
  });

  it('accepts a recurring item', () => {
    expect(UpcomingPaymentItemSchema.safeParse(recurringItem).success).toBe(true);
  });

  it('accepts obligation with null expectedAmount', () => {
    const result = UpcomingPaymentItemSchema.safeParse({ ...obligationItem, expectedAmount: null });
    expect(result.success).toBe(true);
  });

  it('accepts recurring with null logoUrl', () => {
    const result = UpcomingPaymentItemSchema.safeParse({ ...recurringItem, logoUrl: null });
    expect(result.success).toBe(true);
  });

  it('rejects items with missing kind discriminator', () => {
    const { kind: _drop, ...bad } = obligationItem;
    void _drop;
    expect(UpcomingPaymentItemSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects items with unknown kind', () => {
    const result = UpcomingPaymentItemSchema.safeParse({ ...obligationItem, kind: 'mystery' });
    expect(result.success).toBe(false);
  });

  it('rejects mixed shape (obligation fields on recurring kind)', () => {
    const result = UpcomingPaymentItemSchema.safeParse({ ...obligationItem, kind: 'recurring' });
    expect(result.success).toBe(false);
  });

  it('accepts obligation with personId set to a known PersonId', () => {
    const withPerson = { ...obligationItem, type: 'self-assessment', personId: 'david' };
    expect(UpcomingPaymentItemSchema.safeParse(withPerson).success).toBe(true);
  });

  it('accepts obligation with personId null or omitted', () => {
    expect(UpcomingPaymentItemSchema.safeParse({ ...obligationItem, personId: null }).success).toBe(true);
    const { ...withoutPerson } = obligationItem;
    expect(UpcomingPaymentItemSchema.safeParse(withoutPerson).success).toBe(true);
  });

  it('rejects obligation with an unknown personId', () => {
    const result = UpcomingPaymentItemSchema.safeParse({ ...obligationItem, personId: 'ghost' });
    expect(result.success).toBe(false);
  });
});

describe('UpcomingPaymentsResponseSchema', () => {
  it('accepts a mixed items array', () => {
    const fixture = {
      items: [
        {
          kind: 'obligation' as const,
          id: 'manual-sa-2024',
          type: 'self-assessment',
          name: 'Self Assessment 2024',
          entity: 'HMRC',
          expectedAmount: 3200,
          dueDate: '2026-01-31',
          status: 'pending',
          source: 'manual',
        },
        {
          kind: 'recurring' as const,
          merchant: 'Domain Renewal',
          category: 'Software',
          colour: '#3b82f6',
          logoUrl: null,
          amount: 25,
          sourceAccount: 'capital-on-tap',
          nextExpectedDate: '2026-11-15',
        },
      ],
    };
    const result = UpcomingPaymentsResponseSchema.safeParse(fixture);
    expect(result.success).toBe(true);
  });

  it('accepts an empty items array', () => {
    expect(UpcomingPaymentsResponseSchema.safeParse({ items: [] }).success).toBe(true);
  });

  it('rejects when items is missing', () => {
    expect(UpcomingPaymentsResponseSchema.safeParse({}).success).toBe(false);
  });
});

describe('DismissalSchema', () => {
  const base = {
    obligationId: 'auto-sa-david-2026-01-31',
    reason: 'Non-resident',
    dismissedAt: '2026-04-10T12:00:00.000Z',
  };

  it('accepts a well-formed dismissal', () => {
    expect(DismissalSchema.safeParse(base).success).toBe(true);
  });

  it('accepts null reason', () => {
    expect(DismissalSchema.safeParse({ ...base, reason: null }).success).toBe(true);
  });

  it('accepts auto-vat ids', () => {
    expect(DismissalSchema.safeParse({ ...base, obligationId: 'auto-vat-2025-05-01' }).success).toBe(true);
  });

  it('rejects non-auto obligation ids', () => {
    expect(DismissalSchema.safeParse({ ...base, obligationId: 'manual-123' }).success).toBe(false);
    expect(DismissalSchema.safeParse({ ...base, obligationId: 'sa-david-2026-01-31' }).success).toBe(false);
  });

  it('rejects when dismissedAt is missing', () => {
    const { dismissedAt: _drop, ...bad } = base;
    void _drop;
    expect(DismissalSchema.safeParse(bad).success).toBe(false);
  });
});

describe('CreateDismissalBodySchema', () => {
  it('accepts a minimal body (obligationId only)', () => {
    expect(CreateDismissalBodySchema.safeParse({ obligationId: 'auto-sa-david-2026-01-31' }).success).toBe(true);
  });

  it('accepts an optional reason', () => {
    expect(CreateDismissalBodySchema.safeParse({
      obligationId: 'auto-vat-2025-05-01',
      reason: 'Already paid out of band',
    }).success).toBe(true);
  });

  it('rejects non-auto ids', () => {
    expect(CreateDismissalBodySchema.safeParse({ obligationId: 'manual-123' }).success).toBe(false);
  });

  it('rejects overly long reasons', () => {
    const big = 'x'.repeat(501);
    expect(CreateDismissalBodySchema.safeParse({
      obligationId: 'auto-sa-david-2026-01-31',
      reason: big,
    }).success).toBe(false);
  });
});

describe('DismissalsListResponseSchema', () => {
  it('accepts an empty list', () => {
    expect(DismissalsListResponseSchema.safeParse({ dismissals: [] }).success).toBe(true);
  });

  it('accepts a list of well-formed dismissals', () => {
    expect(DismissalsListResponseSchema.safeParse({
      dismissals: [
        { obligationId: 'auto-sa-david-2026-01-31', reason: 'Dubai', dismissedAt: '2026-04-10T12:00:00.000Z' },
        { obligationId: 'auto-vat-2025-05-01', reason: null, dismissedAt: '2026-04-11T09:30:00.000Z' },
      ],
    }).success).toBe(true);
  });

  it('rejects when an entry has a non-auto id', () => {
    expect(DismissalsListResponseSchema.safeParse({
      dismissals: [
        { obligationId: 'manual-1', reason: null, dismissedAt: '2026-04-10T12:00:00.000Z' },
      ],
    }).success).toBe(false);
  });
});

describe('DebtCreateBodySchema matchAmounts', () => {
  const base = {
    id: 'my-loan',
    name: 'My Loan',
    merchantPattern: 'LOAN',
    sourceAccounts: ['barclays-current'],
    originalLoanAmount: 1000,
    openingBalance: 500,
    openingBalanceDate: '2026-04-19',
  };

  it('accepts a single-element matchAmounts', () => {
    expect(DebtCreateBodySchema.safeParse({ ...base, matchAmounts: [232.22] }).success).toBe(true);
  });

  it('accepts a multi-element matchAmounts', () => {
    expect(DebtCreateBodySchema.safeParse({ ...base, matchAmounts: [801.35, 1054.64, 306.35] }).success).toBe(true);
  });

  it('accepts an empty matchAmounts array', () => {
    expect(DebtCreateBodySchema.safeParse({ ...base, matchAmounts: [] }).success).toBe(true);
  });

  it('accepts omitted matchAmounts (optional)', () => {
    expect(DebtCreateBodySchema.safeParse(base).success).toBe(true);
  });

  it('rejects matchAmounts with a zero value', () => {
    expect(DebtCreateBodySchema.safeParse({ ...base, matchAmounts: [0] }).success).toBe(false);
  });

  it('rejects matchAmounts with a negative value', () => {
    expect(DebtCreateBodySchema.safeParse({ ...base, matchAmounts: [-1] }).success).toBe(false);
  });
});

describe('DebtUpdateBodySchema matchAmounts', () => {
  it('accepts a patch that clears matchAmounts to empty', () => {
    expect(DebtUpdateBodySchema.safeParse({ matchAmounts: [] }).success).toBe(true);
  });

  it('accepts a patch that sets matchAmounts to a single value', () => {
    expect(DebtUpdateBodySchema.safeParse({ matchAmounts: [192.66] }).success).toBe(true);
  });

  it('rejects a patch with a non-positive matchAmounts entry', () => {
    expect(DebtUpdateBodySchema.safeParse({ matchAmounts: [0] }).success).toBe(false);
  });
});

describe('DebtCreateBodySchema mortgage fields', () => {
  const base = {
    id: 'mtg',
    name: 'Mortgage',
    merchantPattern: 'MORTGAGE',
    sourceAccounts: ['natwest'],
    originalLoanAmount: 200000,
    openingBalance: 200000,
    openingBalanceDate: '2026-04-19',
  };

  it('accepts mortgage with all fields', () => {
    const result = DebtCreateBodySchema.safeParse({
      ...base,
      kind: 'mortgage',
      interestRate: 4.48,
      fixedRateEndDate: '2028-04-30',
      repaymentType: 'interest-only',
      propertyValueEstimate: 315553.21,
      propertyId: 'hunters-square-78',
    });
    expect(result.success).toBe(true);
  });

  it('defaults kind to consumer when omitted', () => {
    const result = DebtCreateBodySchema.safeParse(base);
    expect(result.success).toBe(true);
  });

  it('rejects invalid kind', () => {
    expect(DebtCreateBodySchema.safeParse({ ...base, kind: 'invalid' }).success).toBe(false);
  });

  it('rejects negative interestRate', () => {
    expect(DebtCreateBodySchema.safeParse({ ...base, interestRate: -1 }).success).toBe(false);
  });

  it('rejects invalid repaymentType', () => {
    expect(DebtCreateBodySchema.safeParse({ ...base, repaymentType: 'balloon' }).success).toBe(false);
  });

  it('accepts null for optional mortgage fields', () => {
    const result = DebtCreateBodySchema.safeParse({
      ...base,
      kind: 'mortgage',
      interestRate: null,
      fixedRateEndDate: null,
      repaymentType: null,
      propertyValueEstimate: null,
      propertyId: null,
    });
    expect(result.success).toBe(true);
  });
});

// ============================================
// Company / Entity Registry (Roadmap 1.1)
// ============================================

describe('EntityIdSchema', () => {
  it('accepts the two canonical entity ids', () => {
    expect(EntityIdSchema.safeParse('autonize-it-ltd').success).toBe(true);
    expect(EntityIdSchema.safeParse('autonize-it-fzco').success).toBe(true);
  });

  it('rejects unknown entity ids', () => {
    expect(EntityIdSchema.safeParse('autonize-it-us').success).toBe(false);
    expect(EntityIdSchema.safeParse('').success).toBe(false);
  });
});

describe('JurisdictionSchema', () => {
  it('accepts UK and UAE only', () => {
    expect(JurisdictionSchema.safeParse('UK').success).toBe(true);
    expect(JurisdictionSchema.safeParse('UAE').success).toBe(true);
    expect(JurisdictionSchema.safeParse('US').success).toBe(false);
    expect(JurisdictionSchema.safeParse('uk').success).toBe(false);
  });
});

describe('UkCompanySchema', () => {
  const validUk = {
    id: 'autonize-it-ltd',
    legal_name: 'Autonize IT Limited',
    trading_name: 'Autonize IT Ltd',
    kind: 'ltd',
    jurisdiction: 'UK',
    regulator: 'Companies House',
    formation_date: 'TBC',
    address: '53 Heath Park Road, Romford, RM2 5UL',
    currency: 'GBP',
    email: 'dmorrison@autonize-it.com',
    logo_path: 'autonize-it/logo.svg',
    accountant_name: 'TBC',
    accountant_email: 'TBC',
    vat_registered: true,
    active: true,
    updated_at: '2026-04-22',
    company_number: '08842112',
    vat_number: '292 1465 96',
    license_number: null,
    registration_number: null,
    bank_sort_code: '20-25-19',
    bank_account_number: '63648923',
    iban: null,
    swift_bic: null,
    ct_registered: true,
    qfzp_elected: null,
  };

  it('accepts the canonical UK Ltd row', () => {
    expect(UkCompanySchema.safeParse(validUk).success).toBe(true);
  });

  it('rejects a UK row with a non-null license_number (UAE-only field)', () => {
    const result = UkCompanySchema.safeParse({ ...validUk, license_number: '73348' });
    expect(result.success).toBe(false);
  });

  it('rejects a UK row with a non-null iban (UAE-only field)', () => {
    const result = UkCompanySchema.safeParse({ ...validUk, iban: 'GB00...' });
    expect(result.success).toBe(false);
  });

  it('rejects a UK row with a non-null qfzp_elected (UAE-only field)', () => {
    const result = UkCompanySchema.safeParse({ ...validUk, qfzp_elected: true });
    expect(result.success).toBe(false);
  });

  it('accepts a UK row with ct_registered as TBC', () => {
    expect(UkCompanySchema.safeParse({ ...validUk, ct_registered: 'TBC' }).success).toBe(true);
  });

  it('rejects a UK row with an empty company_number', () => {
    expect(UkCompanySchema.safeParse({ ...validUk, company_number: '' }).success).toBe(false);
  });
});

describe('UaeCompanySchema', () => {
  const validUae = {
    id: 'autonize-it-fzco',
    legal_name: 'Autonize IT Software Development – FZCO',
    trading_name: 'Autonize IT FZCO',
    kind: 'fzco',
    jurisdiction: 'UAE',
    regulator: 'IFZA (International Free Zone Authority)',
    formation_date: '2025-11-04',
    address: 'DSO-IFZA, IFZA Properties, Dubai Silicon Oasis, Dubai, UAE',
    currency: 'AED',
    email: 'dmorrison@autonize-it.com',
    logo_path: 'autonize-it/logo.svg',
    accountant_name: 'TBC',
    accountant_email: 'TBC',
    vat_registered: false,
    active: true,
    updated_at: '2026-04-22',
    company_number: null,
    vat_number: null,
    license_number: '73348',
    registration_number: '71347',
    bank_sort_code: null,
    bank_account_number: null,
    iban: 'TBC',
    swift_bic: 'TBC',
    ct_registered: 'TBC',
    qfzp_elected: 'TBC',
  };

  it('accepts the canonical UAE FZCO row', () => {
    expect(UaeCompanySchema.safeParse(validUae).success).toBe(true);
  });

  it('rejects a UAE row with a non-null company_number (UK-only field)', () => {
    const result = UaeCompanySchema.safeParse({ ...validUae, company_number: '08842112' });
    expect(result.success).toBe(false);
  });

  it('rejects a UAE row with a non-null bank_sort_code (UK-only field)', () => {
    const result = UaeCompanySchema.safeParse({ ...validUae, bank_sort_code: '20-25-19' });
    expect(result.success).toBe(false);
  });

  it('accepts a UAE row with explicit boolean ct_registered and qfzp_elected', () => {
    const result = UaeCompanySchema.safeParse({
      ...validUae,
      ct_registered: true,
      qfzp_elected: false,
    });
    expect(result.success).toBe(true);
  });

  it('rejects an invalid ct_registered value', () => {
    const result = UaeCompanySchema.safeParse({ ...validUae, ct_registered: 'maybe' });
    expect(result.success).toBe(false);
  });
});

describe('CompanySchema discriminated union', () => {
  it('narrows on jurisdiction to the UK shape', () => {
    const result = CompanySchema.safeParse({
      id: 'autonize-it-ltd',
      legal_name: 'Autonize IT Limited',
      trading_name: 'Autonize IT Ltd',
      kind: 'ltd',
      jurisdiction: 'UK',
      regulator: 'Companies House',
      formation_date: 'TBC',
      address: '53 Heath Park Road, Romford, RM2 5UL',
      currency: 'GBP',
      email: 'dmorrison@autonize-it.com',
      logo_path: null,
      accountant_name: null,
      accountant_email: null,
      vat_registered: true,
      active: true,
      updated_at: null,
      company_number: '08842112',
      vat_number: null,
      license_number: null,
      registration_number: null,
      bank_sort_code: null,
      bank_account_number: null,
      iban: null,
      swift_bic: null,
      ct_registered: true,
      qfzp_elected: null,
    });
    expect(result.success).toBe(true);
    if (result.success && result.data.jurisdiction === 'UK') {
      expect(result.data.company_number).toBe('08842112');
    }
  });

  it('refuses an object with a mismatched jurisdiction/identifier combination', () => {
    const result = CompanySchema.safeParse({
      id: 'autonize-it-fzco',
      legal_name: 'Autonize IT FZCO',
      trading_name: 'Autonize IT FZCO',
      kind: 'fzco',
      jurisdiction: 'UAE',
      regulator: 'IFZA',
      formation_date: '2025-11-04',
      address: 'Dubai',
      currency: 'AED',
      email: 'x@y.com',
      logo_path: null,
      accountant_name: null,
      accountant_email: null,
      vat_registered: false,
      active: true,
      updated_at: null,
      company_number: '08842112',
      vat_number: null,
      license_number: '73348',
      registration_number: '71347',
      bank_sort_code: null,
      bank_account_number: null,
      iban: null,
      swift_bic: null,
      ct_registered: 'TBC',
      qfzp_elected: 'TBC',
    });
    expect(result.success).toBe(false);
  });
});
