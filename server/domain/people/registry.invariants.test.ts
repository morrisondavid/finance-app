import { describe, it, expect } from 'vitest';
import { buildPeopleRegistry } from './registry.js';
import { PEOPLE_DATA } from './data.js';

const reg = buildPeopleRegistry(PEOPLE_DATA);

describe('registry invariants — every person appears everywhere they should', () => {
  it('byId covers every entry in all', () => {
    for (const p of reg.all) {
      expect(reg.byId.get(p.id)).toBeDefined();
    }
  });

  it('allIds length matches all length', () => {
    expect(reg.allIds.length).toBe(reg.all.length);
  });

  it('allIds is in declaration order', () => {
    expect(reg.allIds).toEqual(reg.all.map(p => p.id));
  });
});

describe('registry invariants — index containment', () => {
  it('directors ⊂ allIds', () => {
    for (const id of reg.indexes.directors) {
      expect(reg.allIds).toContain(id);
    }
  });

  it('saFilers ⊂ allIds', () => {
    for (const id of reg.indexes.saFilers) {
      expect(reg.allIds).toContain(id);
    }
  });

  it('aliasRegexes keys ⊂ allIds', () => {
    for (const id of reg.indexes.aliasRegexes.keys()) {
      expect(reg.allIds).toContain(id);
    }
  });

  it('aliasRegexes covers every person id (no gaps)', () => {
    for (const id of reg.allIds) {
      expect(reg.indexes.aliasRegexes.has(id)).toBe(true);
    }
  });
});

describe('registry invariants — isDirector / filesSelfAssessment coherence', () => {
  it('every director has a record with isDirector === true', () => {
    for (const id of reg.indexes.directors) {
      expect(reg.byId.get(id)?.isDirector).toBe(true);
    }
  });

  it('every saFiler has a record with filesSelfAssessment === true', () => {
    for (const id of reg.indexes.saFilers) {
      expect(reg.byId.get(id)?.filesSelfAssessment).toBe(true);
    }
  });
});
