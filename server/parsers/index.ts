import fs from 'fs';
import { parse } from 'csv-parse';
import barclaysParser from './barclays.js';
import natwestParser from './natwest.js';
import capitalOnTapParser from './capital-on-tap.js';
import barclaycardParser from './barclaycard.js';
import monzoParser from './monzo.js';
import type { BankParser, ParserMap, Transaction, CSVRow } from '../types.js';
import { isCreditCard, isValidAccountName } from '../types.js';

/**
 * Map account names to their parsers
 */
export const PARSERS: ParserMap = {
  'barclays-current': barclaysParser,
  'barclays-savings': barclaysParser,
  'natwest': natwestParser,
  'capital-on-tap': capitalOnTapParser,
  'barclaycard': barclaycardParser,
  'monzo-joint': monzoParser
};

/**
 * Credit card CSVs report purchases as positive and payments as negative,
 * but the balance model uses "credit limit as opening balance" where
 * purchases must reduce the balance (negative) and payments restore it
 * (positive).  This single post-parse step handles the inversion for
 * every credit-card account automatically — individual parsers stay
 * unaware of balance semantics.
 */
export function normaliseCreditCardAmounts(
  transaction: Transaction,
  account: string,
): Transaction {
  if (isValidAccountName(account) && isCreditCard(account)) {
    return { ...transaction, amount: -transaction.amount };
  }
  return transaction;
}

/**
 * Parse a CSV file and return normalized transactions
 */
export async function parseCSVFile(filePath: string, account: string): Promise<Transaction[]> {
  const parser: BankParser | undefined = PARSERS[account];
  
  if (!parser) {
    throw new Error(`No parser configured for account: ${account}`);
  }
  
  return new Promise((resolve, reject) => {
    const transactions: Transaction[] = [];
    const fileContent = fs.readFileSync(filePath, 'utf-8');
    
    // Some banks have headers that need to be skipped
    const preprocessed = parser.preprocess 
      ? parser.preprocess(fileContent) 
      : fileContent;
    
    const parseOptions = {
      columns: parser.columns === 'auto' ? true : parser.columns,
      skip_empty_lines: true,
      trim: true,
      relax_column_count: true,
      ...parser.parseOptions
    };
    
    parse(preprocessed, parseOptions, (err, records: CSVRow[]) => {
      if (err) {
        return reject(err);
      }
      
      for (const record of records) {
        try {
          const transaction = parser.transform(record, account);
          if (transaction) {
            transactions.push(normaliseCreditCardAmounts(transaction, account));
          }
        } catch (e) {
          // Skip malformed rows
          const error = e instanceof Error ? e.message : 'Unknown error';
          console.warn(`Skipping malformed row in ${filePath}:`, error);
        }
      }
      
      resolve(transactions);
    });
  });
}
