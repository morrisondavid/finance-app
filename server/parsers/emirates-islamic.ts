/**
 * Emirates Islamic CSV Parser
 *
 * CSV format:
 * - 2 preamble lines (account number + account name) before the header row
 * - Headers: Transaction Date, Value Date, Narration, Transaction Reference,
 *            Debit, Credit, Running Balance
 * - Date format: DD-MM-YYYY
 * - Separate Debit / Credit columns (not a single Amount column)
 * - Amounts may contain quoted commas (e.g. "4,200.00")
 */

import type { BankParser, CSVRow, Transaction, ValidationResult } from '../types.js';

function parseAmount(raw: string | undefined): number {
  if (!raw || raw.trim() === '' || raw.trim() === '0.00') return 0;
  const cleaned = raw.replace(/[",\s]/g, '').replace(/^0+(?=\d)/, '');
  return parseFloat(cleaned) || 0;
}

function parseDateDD_MM_YYYY(dateStr: string | undefined): Date | null {
  if (!dateStr) return null;
  const m = dateStr.match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if (!m) return null;
  return new Date(parseInt(m[3], 10), parseInt(m[2], 10) - 1, parseInt(m[1], 10));
}

const emiratesIslamicParser: BankParser = {
  columns: 'auto',

  dateColumn: 'Transaction Date',
  amountColumn: 'Credit',
  descriptionColumn: 'Narration',

  headers: [
    'Transaction Date', 'Value Date', 'Narration',
    'Transaction Reference', 'Debit', 'Credit', 'Running Balance',
  ] as const,

  requiredHeaders: ['Transaction Date', 'Narration', 'Debit', 'Credit'] as const,

  parseOptions: {
    skip_records_with_empty_values: false,
    relax_quotes: true,
  },

  validateHeaders(headers: string[]): ValidationResult {
    const normalised = headers.map(h => h.toLowerCase().trim());
    const missing = this.requiredHeaders.filter(
      req => !normalised.includes(req.toLowerCase()),
    );
    if (missing.length > 0) {
      return { valid: false, errors: [`Missing required headers: ${missing.join(', ')}`] };
    }
    return { valid: true };
  },

  parseDate: parseDateDD_MM_YYYY,

  extractFilenameDate(filename: string): string | null {
    // Pattern: Transaction_Summary_20Apr2026_020658
    const m = filename.match(/(\d{1,2})([A-Za-z]{3})(\d{4})/);
    if (!m) return null;
    const MONTHS: Record<string, string> = {
      jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
      jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
    };
    const day = m[1].padStart(2, '0');
    const month = MONTHS[m[2].toLowerCase()];
    if (!month) return null;
    return `${m[3]}-${month}-${day}`;
  },

  preprocess(content: string): string {
    const lines = content.split('\n');
    // Strip the two preamble lines (Account Number / Account Name)
    const headerIdx = lines.findIndex(l =>
      l.toLowerCase().includes('transaction date') && l.toLowerCase().includes('narration'),
    );
    return headerIdx >= 0 ? lines.slice(headerIdx).join('\n') : content;
  },

  transform(row: CSVRow, account: string): Transaction | null {
    const dateStr = row['Transaction Date'];
    const date = parseDateDD_MM_YYYY(dateStr);
    if (!date) return null;

    const debit = parseAmount(row['Debit']);
    const credit = parseAmount(row['Credit']);

    // Credits are income (positive), debits are expenses (negative)
    const amount = credit > 0 ? credit : -debit;
    if (amount === 0) return null;

    const description = (row['Narration'] ?? '').trim();

    return {
      date,
      description,
      amount,
      account,
      type: amount >= 0 ? 'income' : 'expense',
    };
  },
};

export default emiratesIslamicParser;
