/**
 * Locks the §1.9 QoL/Malleable category tagging.
 *
 * Two invariants:
 * 1. The `qol: true` entries in `CATEGORY_CONFIG` exactly match the
 *    `QOL_STRICT_CATEGORIES` set in `shared/expenses-insight.ts`.
 *    They duplicate the truth (server config vs shared predicate);
 *    drift is caught here.
 * 2. The planner's three-way split (mandatory / QoL / malleable) is
 *    well-formed: every budgetable category has a definite tag, no
 *    overlaps, no gaps, mandatory categories don't carry the field.
 */

import { describe, it, expect } from 'vitest';
import { CATEGORY_CONFIG } from './categorizer.js';
import {
  QOL_STRICT_CATEGORIES,
  NON_QOL_CATEGORIES,
  isQoLCategory,
  isMandatoryCategory,
} from '../../shared/expenses-insight.js';
import { CATEGORY_NAMES, type CategoryName } from '../../shared/category-names.js';

describe('CategoryConfig.qol — sync with QOL_STRICT_CATEGORIES', () => {
  it('every CATEGORY_CONFIG entry with qol:true is in QOL_STRICT_CATEGORIES', () => {
    for (const [name, config] of Object.entries(CATEGORY_CONFIG)) {
      if (config.qol === true) {
        expect(
          QOL_STRICT_CATEGORIES.has(name as CategoryName),
          `${name} is qol:true in CATEGORY_CONFIG but missing from QOL_STRICT_CATEGORIES`,
        ).toBe(true);
      }
    }
  });

  it('every QOL_STRICT_CATEGORIES entry has qol:true in CATEGORY_CONFIG', () => {
    for (const name of QOL_STRICT_CATEGORIES) {
      expect(
        CATEGORY_CONFIG[name].qol,
        `${name} is in QOL_STRICT_CATEGORIES but not qol:true in CATEGORY_CONFIG`,
      ).toBe(true);
    }
  });

  it('mandatory (budgetable: false) categories never have a qol field', () => {
    for (const [name, config] of Object.entries(CATEGORY_CONFIG)) {
      if (!config.budgetable) {
        expect(
          config.qol,
          `${name} is mandatory (budgetable: false) but carries a qol field`,
        ).toBeUndefined();
      }
    }
  });

  it('every budgetable category has a definite qol tag (true or false)', () => {
    for (const [name, config] of Object.entries(CATEGORY_CONFIG)) {
      if (config.budgetable) {
        expect(
          typeof config.qol,
          `${name} is budgetable but its qol tag is ${config.qol} (must be true or false)`,
        ).toBe('boolean');
      }
    }
  });
});

describe('three-way split (mandatory / QoL / malleable)', () => {
  it('every category falls in exactly one bucket', () => {
    for (const name of CATEGORY_NAMES) {
      const mandatory = isMandatoryCategory(name);
      const qol = isQoLCategory(name);
      const config = CATEGORY_CONFIG[name];
      const malleable = config.budgetable && !qol && !mandatory;

      const matches = [mandatory, qol, malleable].filter(Boolean).length;
      expect(
        matches,
        `${name} matches ${matches} buckets (mandatory=${mandatory}, qol=${qol}, malleable=${malleable})`,
      ).toBeLessThanOrEqual(1);
    }
  });

  it('Groceries / Childcare & Education / Health & Personal are QoL', () => {
    expect(isQoLCategory('Groceries')).toBe(true);
    expect(isQoLCategory('Childcare & Education')).toBe(true);
    expect(isQoLCategory('Health & Personal')).toBe(true);
  });

  it('Eating Out / Transport / Shopping / Entertainment / Travel are NOT QoL (they are malleable)', () => {
    expect(isQoLCategory('Eating Out')).toBe(false);
    expect(isQoLCategory('Transport')).toBe(false);
    expect(isQoLCategory('Shopping')).toBe(false);
    expect(isQoLCategory('Entertainment')).toBe(false);
    expect(isQoLCategory('Travel')).toBe(false);
  });

  it('mandatory categories return false from isQoLCategory', () => {
    for (const name of NON_QOL_CATEGORIES) {
      expect(isQoLCategory(name)).toBe(false);
    }
  });

  it('unknown strings return false from isQoLCategory (no false positives)', () => {
    expect(isQoLCategory('Made-up Category')).toBe(false);
    expect(isQoLCategory('')).toBe(false);
  });
});
