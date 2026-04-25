/**
 * Cross-registry FK integrity test.
 *
 * Every `property_id` referenced by `obligations.csv` (rental-income +
 * landlord-insurance rows) and `debts.csv` (kind: mortgage rows) must
 * exist in the properties registry. Catches drift the moment a backfill,
 * rename, or seed edit breaks the join.
 */

import { describe, it, expect } from 'vitest';
import path from 'path';
import { fileURLToPath } from 'url';
import { buildPropertyRegistry } from './registry.js';
import { buildObligationRegistry } from '../obligations/registry.js';
import { getDebtsCsvPath, readDebtsFromCsvFile } from '../../db/debts-csv.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DEBTS_DIR = path.join(__dirname, '../../../debts');

describe('FK integrity: property_id references resolve everywhere', () => {
  const properties = buildPropertyRegistry();
  const obligations = buildObligationRegistry();
  const debts = readDebtsFromCsvFile(getDebtsCsvPath(DEBTS_DIR));

  it('every property_id on obligations resolves in the properties registry', () => {
    const referenced = new Set<string>();
    for (const o of obligations.all) {
      if (o.propertyId !== undefined && o.propertyId !== '') {
        referenced.add(o.propertyId);
      }
    }

    const orphaned: string[] = [];
    for (const id of referenced) {
      if (!properties.indexes.byId.has(id)) orphaned.push(id);
    }
    expect(orphaned, `Obligations reference unknown property_id(s): ${orphaned.join(', ')}`).toEqual([]);
  });

  it('every mortgage debt property_id resolves in the properties registry', () => {
    const referenced = new Set<string>();
    for (const d of debts) {
      if (d.kind === 'mortgage' && d.propertyId !== null && d.propertyId !== '') {
        referenced.add(d.propertyId);
      }
    }

    const orphaned: string[] = [];
    for (const id of referenced) {
      if (!properties.indexes.byId.has(id)) orphaned.push(id);
    }
    expect(orphaned, `Mortgage debts reference unknown property_id(s): ${orphaned.join(', ')}`).toEqual([]);
  });
});
