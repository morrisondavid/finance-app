import { describe, it, expect } from 'vitest';
import { getRateSync, convertAmountSync } from './exchange-rates.js';

describe('exchange-rates', () => {
  describe('getRateSync', () => {
    it('returns 1 for same-currency pairs', () => {
      expect(getRateSync('GBP', 'GBP')).toBe(1);
      expect(getRateSync('AED', 'AED')).toBe(1);
      expect(getRateSync('USD', 'USD')).toBe(1);
    });

    it('returns hardcoded rate for AED/GBP', () => {
      expect(getRateSync('AED', 'GBP')).toBe(0.21);
    });

    it('returns hardcoded rate for GBP/AED', () => {
      expect(getRateSync('GBP', 'AED')).toBe(4.76);
    });

    it('returns hardcoded rate for USD/GBP', () => {
      expect(getRateSync('USD', 'GBP')).toBe(0.79);
    });
  });

  describe('convertAmountSync', () => {
    it('converts AED to GBP using the hardcoded rate', () => {
      const gbp = convertAmountSync(4824.33, 'AED', 'GBP');
      expect(gbp).toBeCloseTo(4824.33 * 0.21, 2);
    });

    it('converts GBP to AED using the hardcoded rate', () => {
      const aed = convertAmountSync(1000, 'GBP', 'AED');
      expect(aed).toBeCloseTo(4760, 0);
    });

    it('returns the same amount for same-currency conversion', () => {
      expect(convertAmountSync(500, 'GBP', 'GBP')).toBe(500);
    });

    it('converts USD to GBP using the hardcoded rate', () => {
      const gbp = convertAmountSync(100, 'USD', 'GBP');
      expect(gbp).toBeCloseTo(79, 2);
    });
  });
});
