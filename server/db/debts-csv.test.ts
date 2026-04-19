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

    const n = parsed.find(r => r.id === 'novuna')!;
    expect(n.originalLoanDate).toBeNull();
  });

  it('writes a stable header row', () => {
    writeDebtsToCsvFile(csvPath, [DEFAULT_DEBT_ROWS[0]]);
    const content = fs.readFileSync(csvPath, 'utf8');
    expect(content.startsWith(
      'id,name,merchant_pattern,source_accounts,original_loan_amount,original_loan_date,opening_balance,opening_balance_date,archived\n',
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
    };
    writeDebtsToCsvFile(csvPath, [row]);
    expect(readDebtsFromCsvFile(csvPath)[0].archived).toBe(true);
  });

  it('ensureDebtsCsvWithDefaults writes header + 3 seeded rows when file is missing', () => {
    expect(fs.existsSync(csvPath)).toBe(false);
    ensureDebtsCsvWithDefaults(csvPath);
    expect(fs.existsSync(csvPath)).toBe(true);
    const parsed = readDebtsFromCsvFile(csvPath);
    expect(parsed).toHaveLength(3);
    expect(parsed.map(r => r.id).sort()).toEqual([
      'bounce-back-loan',
      'funding-circle',
      'novuna',
    ]);
  });

  it('ensureDebtsCsvWithDefaults is a no-op when the file already exists', () => {
    fs.writeFileSync(csvPath, 'id,name,merchant_pattern,source_accounts,original_loan_amount,original_loan_date,opening_balance,opening_balance_date,archived\n', 'utf8');
    const before = fs.readFileSync(csvPath, 'utf8');
    ensureDebtsCsvWithDefaults(csvPath);
    const after = fs.readFileSync(csvPath, 'utf8');
    expect(after).toBe(before);
  });

  describe('validation', () => {
    const header =
      'id,name,merchant_pattern,source_accounts,original_loan_amount,original_loan_date,opening_balance,opening_balance_date,archived\n';

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
        `${header}dup,First,X,barclays-current,1000,,500,2026-04-19,\n`
          + `dup,Second,X,barclays-current,2000,,1500,2026-04-19,\n`,
        'utf8',
      );
      const parsed = readDebtsFromCsvFile(csvPath);
      expect(parsed).toHaveLength(1);
      expect(parsed[0].name).toBe('Second');
      expect(parsed[0].openingBalance).toBe(1500);
    });
  });
});
