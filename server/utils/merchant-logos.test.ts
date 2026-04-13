import { describe, it, expect } from 'vitest';
import { getMerchantLogoUrl } from './merchant-logos.js';

describe('getMerchantLogoUrl', () => {
  it('returns a Clearbit URL for known subscriptions', () => {
    expect(getMerchantLogoUrl('Netflix')).toBe('https://logo.clearbit.com/netflix.com');
    expect(getMerchantLogoUrl('Spotify')).toBe('https://logo.clearbit.com/spotify.com');
    expect(getMerchantLogoUrl('Disney+')).toBe('https://logo.clearbit.com/disneyplus.com');
  });

  it('returns a Clearbit URL for known utilities', () => {
    expect(getMerchantLogoUrl('Scottish Power')).toBe('https://logo.clearbit.com/scottishpower.co.uk');
    expect(getMerchantLogoUrl('Virgin Media')).toBe('https://logo.clearbit.com/virginmedia.com');
    expect(getMerchantLogoUrl('Thames Water')).toBe('https://logo.clearbit.com/thameswater.co.uk');
  });

  it('returns a Clearbit URL for known groceries', () => {
    expect(getMerchantLogoUrl('Tesco')).toBe('https://logo.clearbit.com/tesco.com');
    expect(getMerchantLogoUrl('Aldi')).toBe('https://logo.clearbit.com/aldi.co.uk');
    expect(getMerchantLogoUrl('Sainsburys')).toBe('https://logo.clearbit.com/sainsburys.co.uk');
  });

  it('returns a Clearbit URL for business/tech services', () => {
    expect(getMerchantLogoUrl('AWS')).toBe('https://logo.clearbit.com/aws.amazon.com');
    expect(getMerchantLogoUrl('GitHub')).toBe('https://logo.clearbit.com/github.com');
    expect(getMerchantLogoUrl('OpenAI')).toBe('https://logo.clearbit.com/openai.com');
  });

  it('returns null for unknown merchants', () => {
    expect(getMerchantLogoUrl('Random Shop')).toBeNull();
    expect(getMerchantLogoUrl('Some Café')).toBeNull();
    expect(getMerchantLogoUrl('')).toBeNull();
  });

  it('is case-insensitive', () => {
    expect(getMerchantLogoUrl('netflix')).toBe('https://logo.clearbit.com/netflix.com');
    expect(getMerchantLogoUrl('NETFLIX')).toBe('https://logo.clearbit.com/netflix.com');
    expect(getMerchantLogoUrl('Netflix')).toBe('https://logo.clearbit.com/netflix.com');
  });
});
