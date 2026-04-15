import { describe, it, expect } from 'vitest';
import { normalizeMerchant } from './merchant-normalizer.js';

describe('normalizeMerchant', () => {
  describe('known merchants (registry display names)', () => {
    it.each([
      ['SCOTTISH POWER         DIRECT DEBIT', 'Scottish Power'],
      ['NETFLIX.COM            CARD PAYMENT', 'Netflix'],
      ['SAINSBURYS T U0569     BECKTON       GBR', "Sainsbury's"],
      ['TESCO STORES 2345', 'Tesco'],
      ['BARCLAYS PARTNER FINANCE DD', 'Barclays Partner Finance'],
      ['HALIFAX                DIRECT DEBIT', 'Halifax Mortgage'],
      ['VIRGIN MEDIA PYMTS     REF: 12345', 'Virgin Media'],
      ['DELIVEROO', 'Deliveroo'],
      ['UBER EATS', 'Uber Eats'],
      ['UBER                   CARD PAYMENT', 'Uber'],
      ['HMRC VAT', 'HMRC'],
      ['DAVID MORRISON', 'David Morrison'],
      ['HEENA TAILOR', 'Heena Tailor'],
      ['NATWEST', 'NatWest Mortgage'],
    ] as const)('normalizes %j to %j', (raw, expected) => {
      expect(normalizeMerchant(raw)).toBe(expected);
    });
  });

  describe('fallback cleanup (unknown descriptions)', () => {
    it('title-cases the core segment after stripping noise tokens', () => {
      expect(normalizeMerchant('ACME WIDGETS 99999 CARD PAYMENT GBR')).toBe('Acme Widgets');
    });

    it('title-cases remaining words when short numeric tokens and payment noise are stripped', () => {
      expect(normalizeMerchant('ZZZLOCAL SHOP 1111 STO')).toBe('Zzzlocal Shop');
    });
  });

  describe('NatWest comma-separated format', () => {
    it('matches PAYPAL *STEAM when commas are normalized to spaces', () => {
      expect(
        normalizeMerchant(
          '5120 08APR26 , PAYPAL , *STEAM GAMES , 35314369001 GB',
        ),
      ).toBe('Steam Games');
    });
  });

  describe('Bounce Back Loan', () => {
    it('resolves BARCLAYS 0520A ref to Bounce Back Loan', () => {
      expect(normalizeMerchant('BARCLAYS 0520A6538148615 DDR')).toBe('Bounce Back Loan');
    });
  });
});
