import { describe, it, expect } from 'vitest';
import {
  expenseTxnMatchesMerchantModal,
  transactionDescriptionMatchesDrillSearch,
} from './merchant-drill-search.js';
import type { RawTransaction } from './recurring-pipeline.js';

describe('transactionDescriptionMatchesDrillSearch', () => {
  it('matches NatWest-style Uber Eats lines when search is display label', () => {
    expect(
      transactionDescriptionMatchesDrillSearch('5120 15APR26 UBER *EATS NATWEST GBR', 'Uber Eats'),
    ).toBe(true);
  });

  it('matches plain UBER EATS', () => {
    expect(transactionDescriptionMatchesDrillSearch('UBER EATS LONDON', 'Uber Eats')).toBe(true);
  });

  it('does not match Uber rides', () => {
    expect(transactionDescriptionMatchesDrillSearch('UBER PAYMENTS UK', 'Uber Eats')).toBe(false);
  });

  it('uses substring match for other merchants', () => {
    expect(transactionDescriptionMatchesDrillSearch('CURSOR AI SUBSCRIPTION', 'Cursor')).toBe(true);
  });

  it('matches MCE Advisors when bank text uses MCE + Advisory wording', () => {
    expect(
      transactionDescriptionMatchesDrillSearch('MCE ADVISORY LTD LONDON', 'MCE Advisors'),
    ).toBe(true);
    expect(transactionDescriptionMatchesDrillSearch('PAYMENT TO MCE', 'MCE Advisors')).toBe(false);
  });

  it('matches Emirates airline-shaped lines (digits / ON / AIR after the word) and not place-name noise', () => {
    expect(transactionDescriptionMatchesDrillSearch('EMIRATES AIRLINE DXB', 'Emirates')).toBe(true);
    expect(transactionDescriptionMatchesDrillSearch('EMIRATES 622081985 FRANCE', 'Emirates')).toBe(true);
    expect(transactionDescriptionMatchesDrillSearch('H-HOTEL EMIRATES HILLS DUBAI', 'Emirates')).toBe(
      false,
    );
    expect(transactionDescriptionMatchesDrillSearch('SOMEMIRATESAIR', 'Emirates')).toBe(false);
    expect(transactionDescriptionMatchesDrillSearch('EMIRATES MALL', 'Emirates')).toBe(false);
  });

  it('excludes U.A.EMIRATES / UNITED ARAB EMIRATES style text from Emirates airline drill', () => {
    expect(
      transactionDescriptionMatchesDrillSearch('THE H HOTEL LLC U.A.EMIRATES AMOUNT IN', 'Emirates'),
    ).toBe(false);
    expect(transactionDescriptionMatchesDrillSearch('MASAFI CO LLC U.A.EMIRATES', 'Emirates')).toBe(false);
    expect(transactionDescriptionMatchesDrillSearch('PAYMENT UNITED ARAB EMIRATES', 'Emirates')).toBe(
      false,
    );
    expect(transactionDescriptionMatchesDrillSearch('EMIRATES 622063450 ON 13 FEB BDC', 'Emirates')).toBe(
      true,
    );
  });

  it('matches Pan Pacific when modal title includes cleanFallback date noise', () => {
    expect(
      transactionDescriptionMatchesDrillSearch(
        'PAN PACIFIC LONDON ON 27 OCT BDC',
        'Pan Pacific London On 27 Oct Bdc',
      ),
    ).toBe(true);
  });
});

function rawTxn(p: Partial<RawTransaction> & Pick<RawTransaction, 'id' | 'description' | 'amount'>): RawTransaction {
  return {
    date: '2026-01-01',
    account: 'natwest',
    type: 'expense',
    ...p,
  };
}

describe('expenseTxnMatchesMerchantModal', () => {
  it('uses pipeline display merchant when there is no specialised drill', () => {
    const t = rawTxn({
      id: 1,
      description: 'BYRON REDSTAR HAWK CLUB LONDON',
      amount: -3000,
    });
    expect(expenseTxnMatchesMerchantModal(t, 'Byron Redstar Sponsorship')).toBe(true);
    expect(transactionDescriptionMatchesDrillSearch(t.description, 'Byron Redstar Sponsorship')).toBe(false);
  });

  it('uses specialised Emirates description rules', () => {
    expect(
      expenseTxnMatchesMerchantModal(rawTxn({ id: 1, description: 'EMIRATES 622081985 FRANCE', amount: -1 }), 'Emirates'),
    ).toBe(true);
    expect(
      expenseTxnMatchesMerchantModal(
        rawTxn({ id: 2, description: 'THE H HOTEL LLC U.A.EMIRATES AMOUNT IN', amount: -1 }),
        'Emirates',
      ),
    ).toBe(false);
  });
});
