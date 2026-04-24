import { describe, it, expect } from 'vitest';
import { interpolate } from './interpolate.js';
import { TemplateContextInvalid } from './errors.js';

describe('interpolate — leaf {{field}} tags', () => {
  it('substitutes a top-level field', () => {
    expect(interpolate('hello {{name}}!', { name: 'David' })).toBe('hello David!');
  });

  it('substitutes a nested field via dotted path', () => {
    expect(interpolate('{{client.legal_name}}', { client: { legal_name: 'Delta Capita Ltd' } }))
      .toBe('Delta Capita Ltd');
  });

  it('tolerates whitespace inside the tag', () => {
    expect(interpolate('{{  client.legal_name  }}', { client: { legal_name: 'X' } })).toBe('X');
  });

  it('coerces numbers and booleans via String()', () => {
    expect(interpolate('{{n}} / {{b}}', { n: 42, b: true })).toBe('42 / true');
  });

  it('throws TemplateContextInvalid when a path is undefined', () => {
    expect(() => interpolate('{{missing}}', {})).toThrow(TemplateContextInvalid);
  });

  it('throws TemplateContextInvalid when a nested path stops at null', () => {
    expect(() => interpolate('{{a.b.c}}', { a: { b: null } })).toThrow(TemplateContextInvalid);
  });

  it('throws TemplateContextInvalid when the path resolves to undefined on an object', () => {
    expect(() => interpolate('{{a.b.c}}', { a: { b: {} } })).toThrow(TemplateContextInvalid);
  });
});

describe('interpolate — {{#each}}', () => {
  it('iterates an array of strings using {{this}}', () => {
    const out = interpolate('{{#each dates}}- {{this}}\n{{/each}}', { dates: ['2026-05-04', '2026-05-05'] });
    expect(out).toBe('- 2026-05-04\n- 2026-05-05\n');
  });

  it('iterates an array of objects — bare field tags resolve on the element', () => {
    const out = interpolate(
      '{{#each items}}- {{label}}: {{value}}\n{{/each}}',
      { items: [{ label: 'a', value: 1 }, { label: 'b', value: 2 }] },
    );
    expect(out).toBe('- a: 1\n- b: 2\n');
  });

  it('falls back to outer-context resolution when the element does not own a field', () => {
    const out = interpolate(
      '{{#each items}}{{label}} ({{client.name}})\n{{/each}}',
      { items: [{ label: 'a' }, { label: 'b' }], client: { name: 'DC' } },
    );
    expect(out).toBe('a (DC)\nb (DC)\n');
  });

  it('renders nothing for an empty array', () => {
    expect(interpolate('[{{#each items}}{{this}}{{/each}}]', { items: [] })).toBe('[]');
  });

  it('throws when the target is not an array', () => {
    expect(() => interpolate('{{#each x}}{{this}}{{/each}}', { x: 'not-an-array' }))
      .toThrow(TemplateContextInvalid);
  });
});

describe('interpolate — {{#if}}', () => {
  it('renders the block when the value is truthy', () => {
    expect(interpolate('{{#if flag}}shown{{/if}}', { flag: true })).toBe('shown');
    expect(interpolate('{{#if name}}hi {{name}}{{/if}}', { name: 'D' })).toBe('hi D');
  });

  it('omits the block when the value is falsy', () => {
    expect(interpolate('a{{#if flag}}shown{{/if}}b', { flag: false })).toBe('ab');
    expect(interpolate('a{{#if flag}}shown{{/if}}b', { flag: 0 })).toBe('ab');
    expect(interpolate('a{{#if name}}shown{{/if}}b', { name: '' })).toBe('ab');
  });

  it('omits the block when the path is missing (does not throw)', () => {
    expect(interpolate('before{{#if nope}}shown{{/if}}after', {})).toBe('beforeafter');
  });

  it('treats arrays as truthy when non-empty, falsy when empty', () => {
    expect(interpolate('{{#if items}}yes{{/if}}', { items: ['a'] })).toBe('yes');
    expect(interpolate('{{#if items}}yes{{/if}}', { items: [] })).toBe('');
  });

  it('handles adjacent and sequential if blocks', () => {
    const tmpl = '{{#if a}}A{{/if}}{{#if b}}B{{/if}}';
    expect(interpolate(tmpl, { a: true, b: true })).toBe('AB');
    expect(interpolate(tmpl, { a: true, b: false })).toBe('A');
    expect(interpolate(tmpl, { a: false, b: true })).toBe('B');
  });
});

describe('interpolate — malformed input', () => {
  it('throws on a stray closing tag in substitution phase', () => {
    expect(() => interpolate('{{/if}}', {})).toThrow(TemplateContextInvalid);
  });
});
