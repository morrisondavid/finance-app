import { describe, it, expect } from 'vitest';
import { PeopleDataSchema, PersonIdSchema, PersonSchema } from './schema.js';
import { PEOPLE_DATA } from './data.js';

describe('schema coherence with data.ts', () => {
  it('every entry in PEOPLE_DATA parses against PersonSchema', () => {
    for (const p of PEOPLE_DATA) {
      const parsed = PersonSchema.safeParse(p);
      if (!parsed.success) {
        throw new Error(
          `Person '${p.id}' failed schema: ${JSON.stringify(parsed.error.issues, null, 2)}`,
        );
      }
    }
  });

  it('the full data array parses against PeopleDataSchema', () => {
    const parsed = PeopleDataSchema.safeParse(PEOPLE_DATA);
    expect(parsed.success).toBe(true);
  });
});

describe('PersonIdSchema', () => {
  it('accepts kebab-case ids', () => {
    expect(PersonIdSchema.safeParse('david').success).toBe(true);
    expect(PersonIdSchema.safeParse('heena-tailor').success).toBe(true);
    expect(PersonIdSchema.safeParse('a1').success).toBe(true);
  });

  it('rejects uppercase or invalid characters', () => {
    expect(PersonIdSchema.safeParse('David').success).toBe(false);
    expect(PersonIdSchema.safeParse('david morrison').success).toBe(false);
    expect(PersonIdSchema.safeParse('').success).toBe(false);
    expect(PersonIdSchema.safeParse('1david').success).toBe(false);
  });
});

describe('PersonSchema validation', () => {
  it('requires id, name, and matchAliases', () => {
    const missingId = PersonSchema.safeParse({ name: 'x', matchAliases: [] });
    const missingName = PersonSchema.safeParse({ id: 'x', matchAliases: [] });
    const missingAliases = PersonSchema.safeParse({ id: 'x', name: 'x' });
    expect(missingId.success).toBe(false);
    expect(missingName.success).toBe(false);
    expect(missingAliases.success).toBe(false);
  });

  it('rejects empty name', () => {
    const result = PersonSchema.safeParse({ id: 'x', name: '', matchAliases: [] });
    expect(result.success).toBe(false);
  });

  it('accepts optional flags omitted or set', () => {
    const minimal = PersonSchema.safeParse({
      id: 'x',
      name: 'Xavier',
      matchAliases: ['XAVIER'],
    });
    const full = PersonSchema.safeParse({
      id: 'x',
      name: 'Xavier',
      displayName: 'X',
      filesSelfAssessment: true,
      isDirector: true,
      matchAliases: ['XAVIER'],
    });
    expect(minimal.success).toBe(true);
    expect(full.success).toBe(true);
  });
});
