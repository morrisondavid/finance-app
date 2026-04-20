import { describe, it, expect } from 'vitest';
import { assertNever } from './assert-never.js';

describe('assertNever', () => {
  it('throws when called at runtime (exhaustiveness violation)', () => {
    const unreachable = 'surprise' as never;
    expect(() => assertNever(unreachable)).toThrow(/exhaustiveness violation/);
  });

  it('serialises the offending value into the error message', () => {
    const unreachable = { category: 'new-category' } as never;
    expect(() => assertNever(unreachable)).toThrow(/new-category/);
  });

  it('is a compile-time no-op for an exhaustive switch', () => {
    type Direction = 'n' | 's';
    function label(d: Direction): string {
      switch (d) {
        case 'n': return 'north';
        case 's': return 'south';
        default: return assertNever(d);
      }
    }
    expect(label('n')).toBe('north');
    expect(label('s')).toBe('south');
  });
});
