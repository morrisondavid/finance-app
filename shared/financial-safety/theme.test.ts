import { describe, expect, it } from 'vitest';
import { scoreToSafetyTheme } from './theme.js';

describe('scoreToSafetyTheme', () => {
  it('high score uses good band and higher hue', () => {
    const t = scoreToSafetyTheme(9);
    expect(t.band).toBe('good');
    expect(t.stress).toBeLessThan(0.34);
    expect(Number(t.css['--fs-score-hue'])).toBeGreaterThan(100);
  });

  it('low score uses poor band', () => {
    const t = scoreToSafetyTheme(2);
    expect(t.band).toBe('poor');
    expect(t.stress).toBeGreaterThan(0.66);
  });
});
