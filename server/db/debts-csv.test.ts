import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  readDebtsFromCsvFile,
  writeDebtsToCsvFile,
  ensureDebtsCsvWithDefaults,
  getDebtsCsvPath,
  DEFAULT_DEBT_ROWS,
  type DebtCsvRow,
} from './debts-csv.js';

describe('debts CSV', () => {
  let tmpDir: string;
  let csvPath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'debts-csv-test-'));
    csvPath = getDebtsCsvPath(tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns [] when the CSV file does not exist', () => {
    expect(readDebtsFromCsvFile(csvPath)).toEqual([]);
  });

  it('round-trips every column', () => {
    const rows: DebtCsvRow[] = [
      {
        id: 'funding-circle',
        name: 'Funding Circle',
        merchantPattern: 'FUNDING CIRCLE',
        sourceAccounts: ['barclays-current'],
        originalLoanAmount: 18700,
        originalLoanDate: '2023-11-09',
        openingBalance: 13138.71,
        openingBalanceDate: '2026-04-19',
        archived: false,
        matchAmounts: [],
        kind: 'consumer',
        interestRate: null,
        fixedRateEndDate: null,
        repaymentType: null,
        propertyValueEstimate: null,
        propertyId: null,
      },
      {
        id: 'novuna',
        name: 'Novuna Finance',
        merchantPattern: 'NOVUNA',
        sourceAccounts: ['natwest'],
        originalLoanAmount: 13228,
        originalLoanDate: null,
        openingBalance: 5518.23,
        openingBalanceDate: '2026-04-19',
        archived: false,
        matchAmounts: [800.5, 750],
        kind: 'mortgage',
        interestRate: 4.48,
        fixedRateEndDate: '2028-04-30',
        repaymentType: 'interest-only',
        propertyValueEstimate: 315553.21,
        propertyId: 'hunters-square-78',
      },
    ];

    writeDebtsToCsvFile(csvPath, rows);
    const parsed = readDebtsFromCsvFile(csvPath);

    expect(parsed).toHaveLength(2);
    const fc = parsed.find(r => r.id === 'funding-circle')!;
    expect(fc.name).toBe('Funding Circle');
    expect(fc.merchantPattern).toBe('FUNDING CIRCLE');
    expect(fc.sourceAccounts).toEqual(['barclays-current']);
    expect(fc.originalLoanAmount).toBe(18700);
    expect(fc.originalLoanDate).toBe('2023-11-09');
    expect(fc.openingBalance).toBe(13138.71);
    expect(fc.openingBalanceDate).toBe('2026-04-19');
    expect(fc.archived).toBe(false);
    expect(fc.matchAmounts).toEqual([]);
    expect(fc.kind).toBe('consumer');
    expect(fc.interestRate).toBeNull();

    const n = parsed.find(r => r.id === 'novuna')!;
    expect(n.originalLoanDate).toBeNull();
    expect(n.matchAmounts).toEqual([800.5, 750]);
    expect(n.kind).toBe('mortgage');
    expect(n.interestRate).toBe(4.48);
    expect(n.fixedRateEndDate).toBe('2028-04-30');
    expect(n.repaymentType).toBe('interest-only');
    expect(n.propertyValueEstimate).toBe(315553.21);
    expect(n.propertyId).toBe('hunters-square-78');
  });

  it('round-trips matchAmounts array', () => {
    const rows: DebtCsvRow[] = [
      {
        id: 'bathroom-a',
        name: 'Bathroom Loan (A)',
        merchantPattern: 'Barclays Partner Finance',
        sourceAccounts: ['monzo-joint'],
        originalLoanAmount: 9191.26,
        originalLoanDate: null,
        openingBalance: 3850.2,
        openingBalanceDate: '2026-04-19',
        archived: false,
        matchAmounts: [232.22],
        kind: 'consumer',
        interestRate: null,
        fixedRateEndDate: null,
        repaymentType: null,
        propertyValueEstimate: null,
        propertyId: null,
      },
      {
        id: 'bathroom-b',
        name: 'Bathroom Loan (B)',
        merchantPattern: 'Barclays Partner Finance',
        sourceAccounts: ['monzo-joint'],
        originalLoanAmount: 7917.04,
        originalLoanDate: null,
        openingBalance: 3678.52,
        openingBalanceDate: '2026-04-19',
        archived: false,
        matchAmounts: [192.66],
        kind: 'consumer',
        interestRate: null,
        fixedRateEndDate: null,
        repaymentType: null,
        propertyValueEstimate: null,
        propertyId: null,
      },
    ];

    writeDebtsToCsvFile(csvPath, rows);
    const parsed = readDebtsFromCsvFile(csvPath);
    const a = parsed.find(r => r.id === 'bathroom-a')!;
    const b = parsed.find(r => r.id === 'bathroom-b')!;
    expect(a.matchAmounts).toEqual([232.22]);
    expect(b.matchAmounts).toEqual([192.66]);
  });

  it('writes a stable header row', () => {
    writeDebtsToCsvFile(csvPath, [DEFAULT_DEBT_ROWS[0]]);
    const content = fs.readFileSync(csvPath, 'utf8');
    expect(content.startsWith(
      'id,name,merchant_pattern,source_accounts,original_loan_amount,original_loan_date,opening_balance,opening_balance_date,archived,match_amounts,kind,interest_rate,fixed_rate_end_date,repayment_type,property_value_estimate,property_id\n',
    )).toBe(true);
  });

  it('supports semicolon-delimited multi-account source_accounts', () => {
    const rows: DebtCsvRow[] = [
      {
        id: 'multi',
        name: 'Multi',
        merchantPattern: 'MULTI',
        sourceAccounts: ['barclays-current', 'natwest'],
        originalLoanAmount: 1000,
        originalLoanDate: null,
        openingBalance: 500,
        openingBalanceDate: '2026-04-19',
        archived: false,
        matchAmounts: [],
        kind: 'consumer',
        interestRate: null,
        fixedRateEndDate: null,
        repaymentType: null,
        propertyValueEstimate: null,
        propertyId: null,
      },
    ];
    writeDebtsToCsvFile(csvPath, rows);
    const parsed = readDebtsFromCsvFile(csvPath);
    expect(parsed[0].sourceAccounts).toEqual(['barclays-current', 'natwest']);
  });

  it('round-trips archived flag', () => {
    const row: DebtCsvRow = {
      id: 'gone',
      name: 'Gone',
      merchantPattern: 'X',
      sourceAccounts: ['barclays-current'],
      originalLoanAmount: 100,
      originalLoanDate: null,
      openingBalance: 0,
      openingBalanceDate: '2026-04-19',
      archived: true,
      matchAmounts: [],
      kind: 'consumer',
      interestRate: null,
      fixedRateEndDate: null,
      repaymentType: null,
      propertyValueEstimate: null,
      propertyId: null,
    };
    writeDebtsToCsvFile(csvPath, [row]);
    expect(readDebtsFromCsvFile(csvPath)[0].archived).toBe(true);
  });

  it('ensureDebtsCsvWithDefaults writes header + 7 seeded rows when file is missing', () => {
    expect(fs.existsSync(csvPath)).toBe(false);
    ensureDebtsCsvWithDefaults(csvPath);
    expect(fs.existsSync(csvPath)).toBe(true);
    const parsed = readDebtsFromCsvFile(csvPath);
    expect(parsed).toHaveLength(8);
    expect(parsed.map(r => r.id).sort()).toEqual([
      'bathroom-loan-a',
      'bathroom-loan-b',
      'bounce-back-loan',
      'funding-circle',
      'mortgage-heath-park-road',
      'mortgage-hunters-square',
      'mortgage-thorney-house',
      'novuna',
    ]);
    const a = parsed.find(r => r.id === 'bathroom-loan-a')!;
    const b = parsed.find(r => r.id === 'bathroom-loan-b')!;
    const fc = parsed.find(r => r.id === 'funding-circle')!;
    expect(a.matchAmounts).toEqual([232.22]);
    expect(b.matchAmounts).toEqual([192.66]);
    expect(fc.matchAmounts).toEqual([]);
    // Consumer defaults have kind=consumer; mortgages have kind=mortgage.
    expect(fc.kind).toBe('consumer');
    const m1 = parsed.find(r => r.id === 'mortgage-hunters-square')!;
    expect(m1.kind).toBe('mortgage');
    expect(m1.interestRate).toBe(4.48);
    expect(m1.fixedRateEndDate).toBe('2028-04-30');
    expect(m1.repaymentType).toBe('interest-only');
    expect(m1.propertyValueEstimate).toBe(315553.21);
    expect(m1.propertyId).toBe('hunters-square-78');
    const m2 = parsed.find(r => r.id === 'mortgage-thorney-house')!;
    expect(m2.kind).toBe('mortgage');
    expect(m2.interestRate).toBe(6.74);
    expect(m2.fixedRateEndDate).toBeNull();
    const m3 = parsed.find(r => r.id === 'mortgage-heath-park-road')!;
    expect(m3.kind).toBe('mortgage');
    expect(m3.interestRate).toBe(4.4);
    expect(m3.fixedRateEndDate).toBe('2029-06-30');
    expect(m3.repaymentType).toBe('repayment');
    expect(m3.propertyValueEstimate).toBe(630000);
    expect(m3.propertyId).toBe('heath-park-road-53');
    expect(m3.matchAmounts).toEqual([2221.63, 3431.96]);
  });

  it('ensureDebtsCsvWithDefaults is a no-op when the file already exists', () => {
    fs.writeFileSync(csvPath, 'id,name,merchant_pattern,source_accounts,original_loan_amount,original_loan_date,opening_balance,opening_balance_date,archived,match_amounts,kind,interest_rate,fixed_rate_end_date,repayment_type,property_value_estimate,property_id\n', 'utf8');
    const before = fs.readFileSync(csvPath, 'utf8');
    ensureDebtsCsvWithDefaults(csvPath);
    const after = fs.readFileSync(csvPath, 'utf8');
    expect(after).toBe(before);
  });

  describe('validation', () => {
    const header =
      'id,name,merchant_pattern,source_accounts,original_loan_amount,original_loan_date,opening_balance,opening_balance_date,archived,match_amounts,kind,interest_rate,fixed_rate_end_date,repayment_type,property_value_estimate,property_id\n';

    beforeEach(() => {
      vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('drops rows with invalid source_accounts token', () => {
      fs.writeFileSync(
        csvPath,
        `${header}bad-source,Bad Source,X,not-an-account,1000,,500,2026-04-19,\n`,
        'utf8',
      );
      expect(readDebtsFromCsvFile(csvPath)).toHaveLength(0);
    });

    it('drops rows with empty source_accounts', () => {
      fs.writeFileSync(
        csvPath,
        `${header}no-source,No Source,X,,1000,,500,2026-04-19,\n`,
        'utf8',
      );
      expect(readDebtsFromCsvFile(csvPath)).toHaveLength(0);
    });

    it('drops rows with non-numeric original_loan_amount', () => {
      fs.writeFileSync(
        csvPath,
        `${header}bad-amt,Bad,X,barclays-current,NOT_A_NUMBER,,500,2026-04-19,\n`,
        'utf8',
      );
      expect(readDebtsFromCsvFile(csvPath)).toHaveLength(0);
    });

    it('drops rows with original_loan_amount <= 0', () => {
      fs.writeFileSync(
        csvPath,
        `${header}zero,Zero,X,barclays-current,0,,500,2026-04-19,\n`,
        'utf8',
      );
      expect(readDebtsFromCsvFile(csvPath)).toHaveLength(0);
    });

    it('drops rows with negative opening_balance', () => {
      fs.writeFileSync(
        csvPath,
        `${header}neg,Neg,X,barclays-current,1000,,-1,2026-04-19,\n`,
        'utf8',
      );
      expect(readDebtsFromCsvFile(csvPath)).toHaveLength(0);
    });

    it('drops rows with missing id or name or pattern', () => {
      fs.writeFileSync(
        csvPath,
        `${header},No id,X,barclays-current,1000,,500,2026-04-19,\n`
          + `no-name,,X,barclays-current,1000,,500,2026-04-19,\n`
          + `no-pattern,No Pattern,,barclays-current,1000,,500,2026-04-19,\n`,
        'utf8',
      );
      expect(readDebtsFromCsvFile(csvPath)).toHaveLength(0);
    });

    it('drops rows with invalid opening_balance_date', () => {
      fs.writeFileSync(
        csvPath,
        `${header}bad-date,Bad Date,X,barclays-current,1000,,500,19-04-2026,\n`,
        'utf8',
      );
      expect(readDebtsFromCsvFile(csvPath)).toHaveLength(0);
    });

    it('duplicate ids — last row wins', () => {
      fs.writeFileSync(
        csvPath,
        `${header}dup,First,X,barclays-current,1000,,500,2026-04-19,,\n`
          + `dup,Second,X,barclays-current,2000,,1500,2026-04-19,,\n`,
        'utf8',
      );
      const parsed = readDebtsFromCsvFile(csvPath);
      expect(parsed).toHaveLength(1);
      expect(parsed[0].name).toBe('Second');
      expect(parsed[0].openingBalance).toBe(1500);
    });

    it('drops rows with non-numeric match_amounts value', () => {
      fs.writeFileSync(
        csvPath,
        `${header}bad-ma,Bad,X,barclays-current,1000,,500,2026-04-19,,abc\n`,
        'utf8',
      );
      expect(readDebtsFromCsvFile(csvPath)).toHaveLength(0);
    });

    it('drops rows with match_amounts value <= 0', () => {
      fs.writeFileSync(
        csvPath,
        `${header}zero-ma,Zero,X,barclays-current,1000,,500,2026-04-19,,-5\n`
          + `zero2-ma,ZeroTwo,X,barclays-current,1000,,500,2026-04-19,,0\n`,
        'utf8',
      );
      expect(readDebtsFromCsvFile(csvPath)).toHaveLength(0);
    });

    it('treats empty match_amounts as empty array', () => {
      fs.writeFileSync(
        csvPath,
        `${header}legacy,Legacy,X,barclays-current,1000,,500,2026-04-19,,\n`,
        'utf8',
      );
      const parsed = readDebtsFromCsvFile(csvPath);
      expect(parsed).toHaveLength(1);
      expect(parsed[0].matchAmounts).toEqual([]);
    });

    it('parses semicolon-delimited match_amounts', () => {
      fs.writeFileSync(
        csvPath,
        `${header}multi-ma,Multi,X,barclays-current,1000,,500,2026-04-19,,801.35;1054.64;306.35\n`,
        'utf8',
      );
      const parsed = readDebtsFromCsvFile(csvPath);
      expect(parsed).toHaveLength(1);
      expect(parsed[0].matchAmounts).toEqual([801.35, 1054.64, 306.35]);
    });

    it('missing kind defaults to consumer (backward compat)', () => {
      fs.writeFileSync(
        csvPath,
        `${header}old,Old Debt,X,barclays-current,1000,,500,2026-04-19,,\n`,
        'utf8',
      );
      const parsed = readDebtsFromCsvFile(csvPath);
      expect(parsed).toHaveLength(1);
      expect(parsed[0].kind).toBe('consumer');
      expect(parsed[0].interestRate).toBeNull();
      expect(parsed[0].repaymentType).toBeNull();
    });

    it('reads legacy match_amount header as single-element matchAmounts (backward compat)', () => {
      const legacyHeader = 'id,name,merchant_pattern,source_accounts,original_loan_amount,original_loan_date,opening_balance,opening_balance_date,archived,match_amount\n';
      fs.writeFileSync(
        csvPath,
        `${legacyHeader}old,Old,X,barclays-current,1000,,500,2026-04-19,,232.22\n`,
        'utf8',
      );
      const parsed = readDebtsFromCsvFile(csvPath);
      expect(parsed).toHaveLength(1);
      expect(parsed[0].matchAmounts).toEqual([232.22]);
    });

    it('round-trips mortgage fields through CSV', () => {
      const rows: DebtCsvRow[] = [
        {
          id: 'mtg',
          name: 'Mortgage',
          merchantPattern: 'MORTGAGE',
          sourceAccounts: ['natwest'],
          originalLoanAmount: 200000,
          originalLoanDate: null,
          openingBalance: 200000,
          openingBalanceDate: '2026-04-19',
          archived: false,
          matchAmounts: [800],
          kind: 'mortgage',
          interestRate: 4.48,
          fixedRateEndDate: '2028-04-30',
          repaymentType: 'interest-only',
          propertyValueEstimate: 300000,
          propertyId: 'prop-1',
        },
      ];
      writeDebtsToCsvFile(csvPath, rows);
      const parsed = readDebtsFromCsvFile(csvPath);
      expect(parsed).toHaveLength(1);
      expect(parsed[0].kind).toBe('mortgage');
      expect(parsed[0].interestRate).toBe(4.48);
      expect(parsed[0].fixedRateEndDate).toBe('2028-04-30');
      expect(parsed[0].repaymentType).toBe('interest-only');
      expect(parsed[0].propertyValueEstimate).toBe(300000);
      expect(parsed[0].propertyId).toBe('prop-1');
    });
  });
});
