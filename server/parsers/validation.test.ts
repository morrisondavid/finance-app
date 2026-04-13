import { describe, it, expect } from 'vitest';
import barclaysParser from './barclays.js';
import capitalOnTapParser from './capital-on-tap.js';
import natwestParser from './natwest.js';
import barclaycardParser from './barclaycard.js';

describe('Header Validation', () => {
  describe('Barclays', () => {
    it('validates correct headers', () => {
      const headers = ['Number', 'Date', 'Account', 'Amount', 'Subcategory', 'Memo'];
      expect(barclaysParser.validateHeaders(headers)).toEqual({ valid: true });
    });
    
    it('validates headers case-insensitively', () => {
      const headers = ['NUMBER', 'DATE', 'ACCOUNT', 'AMOUNT', 'SUBCATEGORY', 'MEMO'];
      expect(barclaysParser.validateHeaders(headers)).toEqual({ valid: true });
    });
    
    it('validates with only required headers', () => {
      const headers = ['Date', 'Amount'];
      expect(barclaysParser.validateHeaders(headers)).toEqual({ valid: true });
    });
    
    it('rejects missing Date column', () => {
      const headers = ['Number', 'Account', 'Amount'];
      const result = barclaysParser.validateHeaders(headers);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Missing required headers: Date');
    });
    
    it('rejects missing Amount column', () => {
      const headers = ['Number', 'Date', 'Account'];
      const result = barclaysParser.validateHeaders(headers);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Missing required headers: Amount');
    });
    
    it('rejects missing both required headers', () => {
      const headers = ['Number', 'Account', 'Memo'];
      const result = barclaysParser.validateHeaders(headers);
      expect(result.valid).toBe(false);
      expect(result.errors![0]).toContain('Date');
      expect(result.errors![0]).toContain('Amount');
    });
  });

  describe('Capital on Tap', () => {
    it('validates correct headers', () => {
      const headers = ['Clearance Date', 'Authorisation Date', 'Description', 'Amount'];
      expect(capitalOnTapParser.validateHeaders(headers)).toEqual({ valid: true });
    });
    
    it('validates headers case-insensitively', () => {
      const headers = ['CLEARANCE DATE', 'authorisation date', 'DESCRIPTION', 'amount'];
      expect(capitalOnTapParser.validateHeaders(headers)).toEqual({ valid: true });
    });
    
    it('rejects missing Clearance Date', () => {
      const headers = ['Authorisation Date', 'Description', 'Amount'];
      const result = capitalOnTapParser.validateHeaders(headers);
      expect(result.valid).toBe(false);
      expect(result.errors![0]).toContain('Clearance Date');
    });
  });

  describe('NatWest', () => {
    it('validates correct headers', () => {
      const headers = ['Date', 'Type', 'Description', 'Value', 'Balance'];
      expect(natwestParser.validateHeaders(headers)).toEqual({ valid: true });
    });
    
    it('validates headers case-insensitively', () => {
      const headers = ['DATE', 'type', 'DESCRIPTION', 'Value'];
      expect(natwestParser.validateHeaders(headers)).toEqual({ valid: true });
    });
    
    it('rejects missing Value', () => {
      const headers = ['Date', 'Type', 'Description'];
      const result = natwestParser.validateHeaders(headers);
      expect(result.valid).toBe(false);
      expect(result.errors![0]).toContain('Value');
    });
  });

  describe('Barclaycard', () => {
    it('validates correct headers', () => {
      const headers = ['Transaction Date', 'Merchant Name', 'Amount'];
      expect(barclaycardParser.validateHeaders(headers)).toEqual({ valid: true });
    });
    
    it('validates headers case-insensitively', () => {
      const headers = ['TRANSACTION DATE', 'merchant name', 'AMOUNT'];
      expect(barclaycardParser.validateHeaders(headers)).toEqual({ valid: true });
    });
    
    it('rejects missing Transaction Date', () => {
      const headers = ['Merchant Name', 'Amount'];
      const result = barclaycardParser.validateHeaders(headers);
      expect(result.valid).toBe(false);
      expect(result.errors![0]).toContain('Transaction Date');
    });
  });
});
