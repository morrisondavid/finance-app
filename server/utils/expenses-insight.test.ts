import { describe, it, expect } from 'vitest';
import {
  buildExpensesInsight,
  isSalaryIncome,
  debtTermForMerchant,
  NON_QOL_CATEGORIES,
  QOL_CATEGORIES,
} from './expenses-insight.js';
import { CATEGORY_NAMES } from './merchant-registry.js';
import type { ExpensesLineItem, ExpensesSection } from '../../shared/api-contracts.js';

// ---------------------------------------------------------------------------
// Helper — build a minimal ExpensesLineItem
// ---------------------------------------------------------------------------
function item(
  merchant: string,
  amount: number,
  category: string,
  ownership: 'personal' | 'business',
  sourceAccount = 'barclays-current',
): ExpensesLineItem {
  return {
    merchant,
    category,
    amount,
    frequency: 'monthly',
    sourceAccount,
    ownership,
    isVariable: false,
    billingDay: null,
    variance: [],
  };
}

function section(name: string, colour: string, items: ExpensesLineItem[]): ExpensesSection {
  return {
    name,
    colour,
    subtotal: items.reduce((s, i) => s + i.amount, 0),
    items,
  };
}

describe('QoL vs bills category partition', () => {
  it('every CategoryName is in exactly one of NON_QOL or QOL', () => {
    for (const c of CATEGORY_NAMES) {
      const inNon = NON_QOL_CATEGORIES.has(c);
      const inQol = QOL_CATEGORIES.has(c);
      expect(inNon !== inQol).toBe(true);
    }
  });

  it('union size matches CATEGORY_NAMES (no gaps, no overlap)', () => {
    expect(NON_QOL_CATEGORIES.size + QOL_CATEGORIES.size).toBe(CATEGORY_NAMES.length);
  });
});

// ---------------------------------------------------------------------------
// Spreadsheet fixture — matches Morrison spreadsheet screenshots exactly
//
// PERSONAL outgoings (Outgoings - Household):  £5,530.19
//   Mortgage Flat 56          £631.00   Housing
//   Mortgage Hunters Sq       £1,055.00 Housing
//   Mortgage 53 Heath Park    £2,222.00 Housing
//   Flat 56 Service           £190.00   Housing
//   Churchill Home Insurance  £77.00    Insurance
//   London Borough Havering   £283.00   Housing (council tax)
//   TV License                £13.25    Utilities
//   AXA Insurance             £26.00    Insurance
//   AVIVA Life                £102.00   Insurance
//   LV Life Insurance         £20.94    Insurance
//   LV Home Insurance         £20.00    Insurance
//   Car Insurance             £185.00   Insurance
//   Little Kickers            £45.00    Childcare & Education
//   Food                      £600.00   Groceries
//   Toiletries                £60.00    Health & Personal
//   ---
//   QoL items: Little Kickers (45) + Food (600) + Toiletries (60) = £705.00
//   Bills items: everything else = 5530.19 - 705 = £4,825.19
//
// BUSINESS outgoings:  £2,751.00
//   David Salary              £758.00   Business
//   Heena Salary              £758.00   Business
//   Bounce Back Loan          £520.00   Debt Repayment (medium term)
//   Cursor                    £78.00    Business
//   Shopify                   £25.00    Business
//   Funding Circle Loan       £400.00   Debt Repayment (short term)
//   Virgin                    £81.00    Utilities (business)
//   EE                        £85.00    Utilities (business)
//   Chat GPT                  £16.00    Business
//   Swell                     £20.00    Business
//   Proton Mail               £10.00    Business
//
// DEBT (cross-cutting):
//   Short Term:  Funding Circle (£400) + Novuna/other personal = total £1,215
//   But based on visible items: there are also personal debt items not fully
//   visible in screenshots. For this fixture we add some to reach £1,215 short.
//   Personal debt items in "Debt Repayment" category: £815 short-term personal debt
//   Medium Term: Bounce Back Loan = £520
//   Total Debt: £1,735.00
//
// INCOME (recurring monthly):
//   Salary lines: David Salary £758, Heena Salary £758 → totalSalary = £1,516
//   Passive lines: Rent £1,500, Dividends £659.92 → totalPassive = £2,159.92
//   Total Monthly Income: £3,675.92
//
// SUMMARY (spreadsheet):
//   Total Expenses                           £8,281.19
//   Net Expenses (salary included)           £6,121.27   = 8281.19 - 2159.92
//   Net Expenses (salary excluded)           £4,605.27   = 6121.27 - 1516
//   Net Personal Expenses (salary excluded)  £1,854.27   = 4605.27 - 2751
//   Business Expenses                        £2,751.00
//   Business Expenses (salary excluded)      £1,235.00   = 2751 - 1516
//   Total Salary                             £1,516.00
//   Personal Expenses                        £5,530.19
//   Quality of Life Expenses                 £705.00
//   Bills                                    £4,825.19
//   Total Passive Income                     £2,159.92
//   Money needed in joint account            £1,854.27
//   Debt Short Term                          £1,215.00
//   Debt Medium Term                         £520.00
//   Debt Total                               £1,735.00
// ---------------------------------------------------------------------------

function buildSpreadsheetFixture() {
  // ── Personal items ────────────────────────────────────────────────────
  // Amounts chosen so that personal total = £5,530.19 (including debt)
  const personalHousing = [
    item('Mortgage - Flat 56', 631, 'Housing', 'personal'),
    item('Mortgage - Hunters Sq', 1055, 'Housing', 'personal'),
    item('Mortgage - 53 Heath Park', 1407, 'Housing', 'personal'),
    item('Flat 56 - Service', 190, 'Housing', 'personal'),
    item('London Borough of Havering', 283, 'Housing', 'personal'),
  ];

  const personalInsurance = [
    item('Churchill - Home Insurance', 77, 'Insurance', 'personal'),
    item('AXA Insurance', 26, 'Insurance', 'personal'),
    item('AVIVA Life', 102, 'Insurance', 'personal'),
    item('LV Life Insurance', 20.94, 'Insurance', 'personal'),
    item('LV Home Insurance', 20, 'Insurance', 'personal'),
    item('Car Insurance', 185, 'Insurance', 'personal'),
  ];

  const personalUtilities = [
    item('TV License', 13.25, 'Utilities', 'personal'),
  ];

  const personalChildcare = [
    item('Little Kickers', 45, 'Childcare & Education', 'personal'),
  ];

  const personalGroceries = [
    item('Food', 600, 'Groceries', 'personal'),
  ];

  const personalHealth = [
    item('Toiletries', 60, 'Health & Personal', 'personal'),
  ];

  // Personal debt items — included in personalMonthlyFixed (they're bills)
  const personalDebt = [
    item('Santander', 250, 'Debt Repayment', 'personal'),
    item('MBNA', 200, 'Debt Repayment', 'personal'),
    item('Barclaycard', 365, 'Debt Repayment', 'personal'),
  ];
  // personalDebt total = 815 (all short-term)

  // ── Business items ────────────────────────────────────────────────────
  const businessGeneral = [
    item('David Salary', 758, 'Business', 'business'),
    item('Heena Salary', 758, 'Business', 'business'),
    item('Cursor', 78, 'Business', 'business'),
    item('Shopify', 25, 'Business', 'business'),
    item('Chat GPT', 16, 'Business', 'business'),
    item('Swell', 20, 'Business', 'business'),
    item('Proton Mail', 10, 'Business', 'business'),
  ];

  const businessUtilities = [
    item('Virgin', 81, 'Utilities', 'business'),
    item('EE', 85, 'Utilities', 'business'),
  ];

  const businessDebt = [
    item('Bounce Back Loan', 520, 'Debt Repayment', 'business'),
    item('Funding Circle Loan', 400, 'Debt Repayment', 'business'),
  ];

  // ── Build sections (matching how the route groups by category) ───────
  const housingSection = section('Housing', '#4f46e5', personalHousing);
  const insuranceSection = section('Insurance', '#0ea5e9', personalInsurance);
  const utilitiesSection = section('Utilities', '#f59e0b', [
    ...personalUtilities,
    ...businessUtilities,
  ]);
  const childcareSection = section('Childcare & Education', '#a855f7', personalChildcare);
  const groceriesSection = section('Groceries', '#22c55e', personalGroceries);
  const healthSection = section('Health & Personal', '#ec4899', personalHealth);
  const debtSection = section('Debt Repayment', '#ef4444', [
    ...personalDebt,
    ...businessDebt,
  ]);
  const businessSection = section('Business', '#6b7280', businessGeneral);

  const monthlyOutgoings: ExpensesSection[] = [
    housingSection,
    insuranceSection,
    utilitiesSection,
    childcareSection,
    groceriesSection,
    healthSection,
    debtSection,
    businessSection,
  ];

  // ── Pre-computed totals (same as what server/routes/budget.ts computes) ──
  let personalMonthlyFixed = 0;
  let businessMonthlyFixed = 0;

  for (const sec of monthlyOutgoings) {
    for (const it of sec.items) {
      if (it.ownership === 'business') {
        businessMonthlyFixed += it.amount;
      } else {
        personalMonthlyFixed += it.amount;
      }
    }
  }

  const totalMonthlyOutgoings = monthlyOutgoings.reduce((s, sec) => s + sec.subtotal, 0);

  // ── Income items ──────────────────────────────────────────────────────
  const incomeMonthlyItems: ExpensesLineItem[] = [
    item('David Salary', 758, 'Income', 'business'),
    item('Heena Salary', 758, 'Income', 'business'),
    item('Rent Received', 1500, 'Income', 'personal'),
    item('Dividends', 659.92, 'Income', 'personal'),
  ];
  const totalMonthlyIncome = incomeMonthlyItems.reduce((s, i) => s + i.amount, 0);

  return {
    monthlyOutgoings,
    incomeMonthlyItems,
    totalMonthlyOutgoings: Math.round(totalMonthlyOutgoings * 100) / 100,
    totalMonthlyIncome: Math.round(totalMonthlyIncome * 100) / 100,
    personalMonthlyFixed: Math.round(personalMonthlyFixed * 100) / 100,
    businessMonthlyFixed: Math.round(businessMonthlyFixed * 100) / 100,
  };
}

// ===========================================================================
// isSalaryIncome
// ===========================================================================
describe('isSalaryIncome', () => {
  it('identifies salary keywords', () => {
    expect(isSalaryIncome('David Salary')).toBe(true);
    expect(isSalaryIncome('Heena Salary')).toBe(true);
    expect(isSalaryIncome('PAYE Wages')).toBe(true);
    expect(isSalaryIncome('Monthly Payroll')).toBe(true);
    expect(isSalaryIncome('Employment Income')).toBe(true);
    expect(isSalaryIncome('Autonize Ltd')).toBe(true);
    expect(isSalaryIncome('AutonizeItLimited')).toBe(true);
  });

  it('registry display name Autonize IT matches salary heuristic (align with merchant-registry)', () => {
    expect(isSalaryIncome('Autonize IT')).toBe(true);
  });

  it('rejects passive income', () => {
    expect(isSalaryIncome('Rent Received')).toBe(false);
    expect(isSalaryIncome('Dividends')).toBe(false);
    expect(isSalaryIncome('Dividend Payment')).toBe(false);
    expect(isSalaryIncome('From Savings')).toBe(false);
    expect(isSalaryIncome('Interest Credit')).toBe(false);
    expect(isSalaryIncome('Cashback Reward')).toBe(false);
  });

  it('rejects unrelated merchants', () => {
    expect(isSalaryIncome('Tesco')).toBe(false);
    expect(isSalaryIncome('Mortgage Payment')).toBe(false);
    expect(isSalaryIncome('Funding Circle Loan')).toBe(false);
    expect(isSalaryIncome('Virgin Media')).toBe(false);
  });
});

// ===========================================================================
// debtTermForMerchant
// ===========================================================================
describe('debtTermForMerchant', () => {
  it('classifies Bounce Back Loan as medium term', () => {
    expect(debtTermForMerchant('Bounce Back Loan')).toBe('medium');
  });

  it('classifies Novuna as medium term (finance agreement)', () => {
    expect(debtTermForMerchant('Novuna')).toBe('medium');
    expect(debtTermForMerchant('Novuna - Decking Finance')).toBe('medium');
  });

  it('classifies Ford Credit as medium term', () => {
    expect(debtTermForMerchant('Ford Credit')).toBe('medium');
  });

  it('classifies Credit Style as medium term', () => {
    expect(debtTermForMerchant('Credit Style')).toBe('medium');
  });

  it('classifies Funding Circle as short term (revolving)', () => {
    expect(debtTermForMerchant('Funding Circle Loan')).toBe('short');
    expect(debtTermForMerchant('Funding Circle')).toBe('short');
  });

  it('classifies revolving credit / cards as short term', () => {
    expect(debtTermForMerchant('Santander')).toBe('short');
    expect(debtTermForMerchant('MBNA')).toBe('short');
    expect(debtTermForMerchant('Barclaycard')).toBe('short');
    expect(debtTermForMerchant('Capital On Tap')).toBe('short');
  });

  it('registry-aligned display names for term split', () => {
    expect(debtTermForMerchant('Novuna Finance')).toBe('medium');
    expect(debtTermForMerchant('Barclays Partner Finance')).toBe('medium');
    expect(debtTermForMerchant('Bounce Back Loan')).toBe('medium');
  });
});

// ===========================================================================
// buildExpensesInsight — full spreadsheet scenario
// ===========================================================================
describe('buildExpensesInsight', () => {
  describe('with full spreadsheet fixture', () => {
    const fix = buildSpreadsheetFixture();
    const insight = buildExpensesInsight(
      fix.monthlyOutgoings,
      fix.incomeMonthlyItems,
      fix.totalMonthlyOutgoings,
      fix.totalMonthlyIncome,
      fix.personalMonthlyFixed,
      fix.businessMonthlyFixed,
    );

    // Verify fixture internal consistency first
    it('fixture: personal + business = total outgoings', () => {
      expect(fix.personalMonthlyFixed + fix.businessMonthlyFixed)
        .toBeCloseTo(fix.totalMonthlyOutgoings, 2);
    });

    it('fixture: total outgoings matches spreadsheet £8,281.19', () => {
      expect(fix.totalMonthlyOutgoings).toBeCloseTo(8281.19, 2);
    });

    it('fixture: personal fixed matches spreadsheet £5,530.19', () => {
      expect(fix.personalMonthlyFixed).toBeCloseTo(5530.19, 2);
    });

    it('fixture: business fixed matches spreadsheet £2,751.00', () => {
      expect(fix.businessMonthlyFixed).toBeCloseTo(2751, 2);
    });

    it('fixture: total income matches spreadsheet £3,675.92', () => {
      expect(fix.totalMonthlyIncome).toBeCloseTo(3675.92, 2);
    });

    // ── Main insight values ─────────────────────────────────────────────
    it('Total Expenses = £8,281.19', () => {
      expect(insight.totalFixedMonthlyExpenses).toBeCloseTo(8281.19, 2);
    });

    it('Total Salary = £1,516.00 (David 758 + Heena 758)', () => {
      expect(insight.totalSalary).toBeCloseTo(1516, 2);
    });

    it('Total Passive Income = £2,159.92 (Rent 1500 + Dividends 659.92)', () => {
      expect(insight.totalPassiveIncome).toBeCloseTo(2159.92, 2);
    });

    it('Net Expenses (salary included) = Total − Passive = £6,121.27 shortfall', () => {
      expect(insight.netExpensesSalaryIncludedShortfall).toBeCloseTo(6121.27, 2);
      expect(insight.netExpensesSalaryIncludedSurplus).toBe(0);
    });

    it('Net Expenses (salary excluded) = Net(sal incl) − Salary = £4,605.27 shortfall', () => {
      expect(insight.netExpensesSalaryExcludedShortfall).toBeCloseTo(4605.27, 2);
      expect(insight.netExpensesSalaryExcludedSurplus).toBe(0);
    });

    it('Net Personal (salary excluded) = Net(sal excl) − Business = £1,854.27 shortfall', () => {
      expect(insight.netPersonalExpensesSalaryExcludedShortfall).toBeCloseTo(1854.27, 2);
      expect(insight.netPersonalExpensesSalaryExcludedSurplus).toBe(0);
    });

    it('Money needed = personal shortfall; surplus 0', () => {
      expect(insight.moneyNeededJointAccount).toBeCloseTo(1854.27, 2);
      expect(insight.jointAccountMonthlySurplus).toBe(0);
    });

    it('Business Expenses = £2,751.00', () => {
      expect(insight.businessExpenses).toBeCloseTo(2751, 2);
    });

    it('Business Expenses (salary excluded) = Business − Salary = £1,235.00', () => {
      expect(insight.businessExpensesSalaryExcluded).toBeCloseTo(1235, 2);
    });

    it('Personal Expenses = £5,530.19 (sum of ALL personal items incl debt)', () => {
      expect(insight.personalExpenses).toBeCloseTo(5530.19, 2);
    });

    it('Quality of Life Expenses = £705.00 (Little Kickers 45 + Food 600 + Toiletries 60)', () => {
      expect(insight.qualityOfLifeExpenses).toBeCloseTo(705, 2);
    });

    it('Bills = Personal − QoL = £4,825.19', () => {
      expect(insight.billsExpenses).toBeCloseTo(4825.19, 2);
    });

    it('Bills + QoL = Personal Expenses', () => {
      expect(insight.billsExpenses + insight.qualityOfLifeExpenses)
        .toBeCloseTo(insight.personalExpenses, 2);
    });

    // ── Debt ────────────────────────────────────────────────────────────
    it('Debt Short Term = £1,215.00 (Funding Circle 400 + personal cards 815)', () => {
      expect(insight.debtShortTerm).toBeCloseTo(1215, 2);
    });

    it('Debt Medium Term = £520.00 (Bounce Back only)', () => {
      expect(insight.debtMediumTerm).toBeCloseTo(520, 2);
    });

    it('Debt Total = £1,735.00', () => {
      expect(insight.debtTotal).toBeCloseTo(1735, 2);
    });

    it('Debt Total = Short + Medium', () => {
      expect(insight.debtTotal).toBeCloseTo(
        insight.debtShortTerm + insight.debtMediumTerm, 2);
    });
  });

  // ========================================================================
  // Net formula chain — verify each step depends correctly on the previous
  // ========================================================================
  describe('net formula chain', () => {
    const totalOut = 5000;
    const totalIn = 2000;
    const personalFixed = 3500;
    const businessFixed = 1500;

    const incomeItems: ExpensesLineItem[] = [
      item('Salary Payment', 800, 'Income', 'business'),
      item('Rent Received', 1200, 'Income', 'personal'),
    ];

    const sections: ExpensesSection[] = [
      section('Housing', '#000', [
        item('Mortgage', 2000, 'Housing', 'personal'),
        item('Council Tax', 200, 'Housing', 'personal'),
      ]),
      section('Groceries', '#000', [
        item('Tesco', 300, 'Groceries', 'personal'),
      ]),
      section('Business', '#000', [
        item('Cursor', 500, 'Business', 'business'),
      ]),
      section('Debt Repayment', '#000', [
        item('Barclaycard', 1000, 'Debt Repayment', 'personal'),
        item('Funding Circle', 1000, 'Debt Repayment', 'business'),
      ]),
    ];

    const ins = buildExpensesInsight(
      sections, incomeItems, totalOut, totalIn, personalFixed, businessFixed,
    );

    it('salary = 800 (Salary Payment)', () => {
      expect(ins.totalSalary).toBeCloseTo(800, 2);
    });

    it('passive = totalIncome − salary = 1200', () => {
      expect(ins.totalPassiveIncome).toBeCloseTo(1200, 2);
    });

    it('net(sal incl) = totalOut − passive = 3800 shortfall', () => {
      expect(ins.netExpensesSalaryIncludedShortfall).toBeCloseTo(3800, 2);
      expect(ins.netExpensesSalaryIncludedSurplus).toBe(0);
    });

    it('net(sal excl) = net(sal incl) − salary = 3000 shortfall', () => {
      expect(ins.netExpensesSalaryExcludedShortfall).toBeCloseTo(3000, 2);
      expect(ins.netExpensesSalaryExcludedSurplus).toBe(0);
    });

    it('net personal(sal excl) = net(sal excl) − business = 1500 shortfall', () => {
      expect(ins.netPersonalExpensesSalaryExcludedShortfall).toBeCloseTo(1500, 2);
      expect(ins.netPersonalExpensesSalaryExcludedSurplus).toBe(0);
    });

    it('joint need = personal shortfall; surplus mirrors personal', () => {
      expect(ins.moneyNeededJointAccount).toBe(ins.netPersonalExpensesSalaryExcludedShortfall);
      expect(ins.jointAccountMonthlySurplus).toBe(ins.netPersonalExpensesSalaryExcludedSurplus);
    });

    it('business(sal excl) = max(0, business − salary) = 700', () => {
      expect(ins.businessExpensesSalaryExcluded).toBeCloseTo(700, 2);
    });
  });

  // ========================================================================
  // Surplus path: amounts never negative — shortfall/surplus split
  // ========================================================================
  describe('surplus when income covers fixed costs (matches real-world joint surplus)', () => {
    const totalOut = 5438.97;
    const totalIn = 7058; // 3258 salary + 3800 passive
    const personalFixed = 4947.48;
    const businessFixed = 491.49;
    const incomeItems: ExpensesLineItem[] = [
      item('PAYE Salary', 3258, 'Income', 'business'),
      item('Rent Received', 3800, 'Income', 'personal'),
    ];

    const ins = buildExpensesInsight([], incomeItems, totalOut, totalIn, personalFixed, businessFixed);

    it('after passive: shortfall £1,638.97 (costs exceed passive alone)', () => {
      expect(ins.netExpensesSalaryIncludedShortfall).toBeCloseTo(1638.97, 2);
      expect(ins.netExpensesSalaryIncludedSurplus).toBe(0);
    });

    it('after salary: surplus £1,619.03 (salary covers gap vs passive)', () => {
      expect(ins.netExpensesSalaryExcludedShortfall).toBe(0);
      expect(ins.netExpensesSalaryExcludedSurplus).toBeCloseTo(1619.03, 2);
    });

    it('after business carve-out: personal surplus £2,110.52', () => {
      expect(ins.netPersonalExpensesSalaryExcludedShortfall).toBe(0);
      expect(ins.netPersonalExpensesSalaryExcludedSurplus).toBeCloseTo(2110.52, 2);
    });

    it('money needed is £0; joint surplus equals personal surplus', () => {
      expect(ins.moneyNeededJointAccount).toBe(0);
      expect(ins.jointAccountMonthlySurplus).toBeCloseTo(2110.52, 2);
    });
  });

  // ========================================================================
  // Personal Expenses = full personal sum (NOT minus debt)
  // ========================================================================
  describe('personal expenses includes all personal items', () => {
    const personalItems = [
      item('Mortgage', 1000, 'Housing', 'personal'),
      item('Tesco', 300, 'Groceries', 'personal'),
      item('Barclaycard', 500, 'Debt Repayment', 'personal'),
    ];
    const businessItems = [
      item('Cursor', 200, 'Business', 'business'),
    ];

    const sections: ExpensesSection[] = [
      section('Housing', '#000', [personalItems[0]]),
      section('Groceries', '#000', [personalItems[1]]),
      section('Debt Repayment', '#000', [personalItems[2]]),
      section('Business', '#000', businessItems),
    ];

    const personalFixed = 1800; // 1000 + 300 + 500
    const businessFixed = 200;
    const totalOut = 2000;

    const ins = buildExpensesInsight(
      sections,
      [],
      totalOut,
      0,
      personalFixed,
      businessFixed,
    );

    it('personalExpenses = 1800 (mortgage + groceries + debt)', () => {
      expect(ins.personalExpenses).toBeCloseTo(1800, 2);
    });

    it('QoL = 300 (groceries only)', () => {
      expect(ins.qualityOfLifeExpenses).toBeCloseTo(300, 2);
    });

    it('Bills = 1500 (mortgage 1000 + debt 500)', () => {
      expect(ins.billsExpenses).toBeCloseTo(1500, 2);
    });

    it('Bills + QoL = personalExpenses', () => {
      expect(ins.billsExpenses + ins.qualityOfLifeExpenses)
        .toBeCloseTo(ins.personalExpenses, 2);
    });
  });

  // ========================================================================
  // Bills + QoL invariant always equals personalExpenses
  // ========================================================================
  describe('Bills + QoL = personalExpenses invariant', () => {
    const scenarios = [
      {
        name: 'all QoL',
        personal: [item('Tesco', 500, 'Groceries', 'personal')],
        business: [],
        expectedQoL: 500,
        expectedBills: 0,
      },
      {
        name: 'all bills',
        personal: [item('Mortgage', 2000, 'Housing', 'personal')],
        business: [],
        expectedQoL: 0,
        expectedBills: 2000,
      },
      {
        name: 'mixed with debt',
        personal: [
          item('Mortgage', 1000, 'Housing', 'personal'),
          item('Tesco', 300, 'Groceries', 'personal'),
          item('MBNA', 400, 'Debt Repayment', 'personal'),
          item('Little Kickers', 45, 'Childcare & Education', 'personal'),
        ],
        business: [
          item('Cursor', 200, 'Business', 'business'),
          item('Bounce Back', 500, 'Debt Repayment', 'business'),
        ],
        expectedQoL: 345, // 300 + 45
        expectedBills: 1400, // 1000 + 400
      },
      {
        name: 'no personal items',
        personal: [],
        business: [item('Cursor', 500, 'Business', 'business')],
        expectedQoL: 0,
        expectedBills: 0,
      },
    ];

    for (const sc of scenarios) {
      it(`${sc.name}: Bills + QoL = personalExpenses`, () => {
        const allItems = [...sc.personal, ...sc.business];
        const sections: ExpensesSection[] = [];
        const byCategory = new Map<string, ExpensesLineItem[]>();
        for (const it of allItems) {
          const list = byCategory.get(it.category) ?? [];
          list.push(it);
          byCategory.set(it.category, list);
        }
        for (const [cat, items] of byCategory) {
          sections.push(section(cat, '#000', items));
        }

        const personalFixed = sc.personal.reduce((s, i) => s + i.amount, 0);
        const businessFixed = sc.business.reduce((s, i) => s + i.amount, 0);
        const totalOut = personalFixed + businessFixed;

        const ins = buildExpensesInsight(
          sections, [], totalOut, 0, personalFixed, businessFixed,
        );

        expect(ins.qualityOfLifeExpenses).toBeCloseTo(sc.expectedQoL, 2);
        expect(ins.billsExpenses).toBeCloseTo(sc.expectedBills, 2);
        expect(ins.billsExpenses + ins.qualityOfLifeExpenses)
          .toBeCloseTo(ins.personalExpenses, 2);
      });
    }
  });

  // ========================================================================
  // Debt totals include all ownership types
  // ========================================================================
  describe('debt totals cross-cut ownership', () => {
    const sections: ExpensesSection[] = [
      section('Debt Repayment', '#000', [
        item('Barclaycard', 300, 'Debt Repayment', 'personal'),
        item('MBNA', 200, 'Debt Repayment', 'personal'),
        item('Bounce Back Loan', 520, 'Debt Repayment', 'business'),
        item('Funding Circle', 400, 'Debt Repayment', 'business'),
      ]),
    ];

    const ins = buildExpensesInsight(sections, [], 1420, 0, 500, 920);

    it('short term = Barclaycard + MBNA + Funding Circle = 900', () => {
      expect(ins.debtShortTerm).toBeCloseTo(900, 2);
    });

    it('medium term = Bounce Back = 520', () => {
      expect(ins.debtMediumTerm).toBeCloseTo(520, 2);
    });

    it('total = 1420', () => {
      expect(ins.debtTotal).toBeCloseTo(1420, 2);
    });
  });

  // ========================================================================
  // Edge: salary exceeds business → businessExpensesSalaryExcluded = 0
  // ========================================================================
  describe('edge: salary exceeds business expenses', () => {
    const sections: ExpensesSection[] = [
      section('Business', '#000', [
        item('Cursor', 100, 'Business', 'business'),
      ]),
    ];

    const incomeItems: ExpensesLineItem[] = [
      item('David Salary', 758, 'Income', 'business'),
    ];

    const ins = buildExpensesInsight(sections, incomeItems, 100, 758, 0, 100);

    it('businessExpensesSalaryExcluded floored at 0', () => {
      expect(ins.businessExpensesSalaryExcluded).toBe(0);
    });
  });

  // ========================================================================
  // Edge: zero income → passive = 0, salary = 0, nets = totalOut
  // ========================================================================
  describe('edge: zero income', () => {
    const sections: ExpensesSection[] = [
      section('Housing', '#000', [
        item('Mortgage', 2000, 'Housing', 'personal'),
      ]),
    ];

    const ins = buildExpensesInsight(sections, [], 2000, 0, 2000, 0);

    it('totalSalary = 0', () => {
      expect(ins.totalSalary).toBe(0);
    });

    it('totalPassiveIncome = 0', () => {
      expect(ins.totalPassiveIncome).toBe(0);
    });

    it('net(sal incl) = totalOut shortfall', () => {
      expect(ins.netExpensesSalaryIncludedShortfall).toBeCloseTo(2000, 2);
      expect(ins.netExpensesSalaryIncludedSurplus).toBe(0);
    });

    it('net(sal excl) = totalOut shortfall', () => {
      expect(ins.netExpensesSalaryExcludedShortfall).toBeCloseTo(2000, 2);
      expect(ins.netExpensesSalaryExcludedSurplus).toBe(0);
    });

    it('net personal(sal excl) = totalOut shortfall', () => {
      expect(ins.netPersonalExpensesSalaryExcludedShortfall).toBeCloseTo(2000, 2);
      expect(ins.netPersonalExpensesSalaryExcludedSurplus).toBe(0);
    });
  });

  // ========================================================================
  // Edge: all income is passive (no salary)
  // ========================================================================
  describe('edge: all income is passive', () => {
    const sections: ExpensesSection[] = [
      section('Housing', '#000', [
        item('Mortgage', 3000, 'Housing', 'personal'),
      ]),
    ];
    const incomeItems: ExpensesLineItem[] = [
      item('Rent Received', 2000, 'Income', 'personal'),
      item('Dividends', 500, 'Income', 'personal'),
    ];

    const ins = buildExpensesInsight(sections, incomeItems, 3000, 2500, 3000, 0);

    it('salary = 0', () => {
      expect(ins.totalSalary).toBe(0);
    });

    it('passive = 2500', () => {
      expect(ins.totalPassiveIncome).toBeCloseTo(2500, 2);
    });

    it('net(sal incl) = 3000 − 2500 = 500 shortfall', () => {
      expect(ins.netExpensesSalaryIncludedShortfall).toBeCloseTo(500, 2);
      expect(ins.netExpensesSalaryIncludedSurplus).toBe(0);
    });

    it('net(sal excl) = 500 − 0 = 500 shortfall', () => {
      expect(ins.netExpensesSalaryExcludedShortfall).toBeCloseTo(500, 2);
      expect(ins.netExpensesSalaryExcludedSurplus).toBe(0);
    });
  });

  // ========================================================================
  // Dividend split detection
  // ========================================================================
  describe('dividend split', () => {
    it('detects Heena and David dividend lines', () => {
      const incomeItems: ExpensesLineItem[] = [
        item('Heena Dividend Payment', 500, 'Income', 'personal'),
        item('David Dividend Payment', 400, 'Income', 'personal'),
        item('Rent Received', 1000, 'Income', 'personal'),
      ];

      const ins = buildExpensesInsight([], incomeItems, 0, 1900, 0, 0);
      expect(ins.dividendHeena).toBeCloseTo(500, 2);
      expect(ins.dividendDavid).toBeCloseTo(400, 2);
    });

    it('returns null when no dividends exist', () => {
      const incomeItems: ExpensesLineItem[] = [
        item('Rent Received', 1000, 'Income', 'personal'),
      ];

      const ins = buildExpensesInsight([], incomeItems, 0, 1000, 0, 0);
      expect(ins.dividendHeena).toBeNull();
      expect(ins.dividendDavid).toBeNull();
    });
  });

  // ========================================================================
  // Rounding precision — guard against floating-point drift
  // ========================================================================
  describe('rounding precision', () => {
    it('handles amounts with many decimal places', () => {
      const sections: ExpensesSection[] = [
        section('Housing', '#000', [
          item('Mortgage', 1333.33, 'Housing', 'personal'),
        ]),
        section('Utilities', '#000', [
          item('Power', 66.67, 'Utilities', 'personal'),
        ]),
      ];

      const ins = buildExpensesInsight(sections, [], 1400, 0, 1400, 0);

      expect(ins.totalFixedMonthlyExpenses).toBe(1400);
      expect(ins.personalExpenses).toBe(1400);
      const sum = ins.billsExpenses + ins.qualityOfLifeExpenses;
      expect(Math.abs(sum - ins.personalExpenses)).toBeLessThan(0.02);
    });
  });
});
