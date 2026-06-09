/**
 * Tests for TrueLayer Data API resource segment routing.
 */

import { describe, it, expect } from 'vitest';
import { trueLayerDataResourceSegment } from './truelayer-data-resource.js';

describe('trueLayerDataResourceSegment', () => {
  it('returns accounts for current and savings ledger accounts', () => {
    expect(trueLayerDataResourceSegment('barclays-current')).toBe('accounts');
    expect(trueLayerDataResourceSegment('barclays-savings')).toBe('accounts');
    expect(trueLayerDataResourceSegment('natwest')).toBe('accounts');
    expect(trueLayerDataResourceSegment('monzo-joint')).toBe('accounts');
    expect(trueLayerDataResourceSegment('wise-ltd')).toBe('accounts');
  });

  it('returns cards for credit-card ledger accounts', () => {
    expect(trueLayerDataResourceSegment('barclaycard')).toBe('cards');
    expect(trueLayerDataResourceSegment('santander-everyday')).toBe('cards');
    expect(trueLayerDataResourceSegment('mbna')).toBe('cards');
    expect(trueLayerDataResourceSegment('capital-on-tap')).toBe('cards');
  });
});
