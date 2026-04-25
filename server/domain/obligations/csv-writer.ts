/**
 * Writer for `obligations/obligations.csv`. Handles upsert and delete for
 * user-editable declaration rows; the seed file is never written to from
 * the runtime — it's a git-tracked bootstrap shipped with the repo.
 */

import fs from 'fs';
import {
  readObligationsCsvFile,
  getObligationsUserCsvPath,
  OBLIGATION_CSV_HEADERS,
} from './csv-io.js';
import { escapeCsvField, atomicWriteCsv } from '../../utils/csv-helpers.js';
import { __resetObligationRegistryForTests } from './registry.js';
import type {
  Obligation,
  OutgoingObligation,
  IncomingObligation,
  PersonId,
} from '../../../shared/api-contracts.js';

function hasOwnership(c: Obligation): c is Extract<IncomingObligation, { category: 'rental-income' }> {
  return c.category === 'rental-income';
}
function hasPersonId(c: Obligation): c is Extract<OutgoingObligation, { category: 'payroll' | 'tax-manual' }> {
  return c.category === 'payroll' || c.category === 'tax-manual';
}
function hasAmountTolerance(
  c: Obligation,
): c is Extract<OutgoingObligation, { category: 'payroll' | 'insurance' }> {
  return c.category === 'payroll' || c.category === 'insurance';
}
function hasDueDate(c: Obligation): c is Extract<OutgoingObligation, { category: 'insurance' | 'tax-manual' }> {
  return c.category === 'insurance' || c.category === 'tax-manual';
}
function hasTaxType(c: Obligation): c is Extract<OutgoingObligation, { category: 'tax-manual' }> {
  return c.category === 'tax-manual';
}

function ownershipAt(c: Obligation, key: PersonId): string {
  if (!hasOwnership(c)) return '';
  const v = c.ownership[key];
  return v === undefined ? '' : String(v);
}

function obligationToCsvRow(c: Obligation): string {
  const cells = [
    escapeCsvField(c.id),
    escapeCsvField(c.category),
    escapeCsvField(c.frequency),
    escapeCsvField(c.merchant),
    escapeCsvField(c.displayName ?? ''),
    escapeCsvField(c.account ?? ''),
    String(c.amount),
    escapeCsvField(c.currency),
    escapeCsvField(c.notes ?? ''),
    ownershipAt(c, 'david'),
    ownershipAt(c, 'heena'),
    hasPersonId(c) ? escapeCsvField(c.personId ?? '') : '',
    hasAmountTolerance(c) && c.amountTolerance !== undefined ? String(c.amountTolerance) : '',
    hasDueDate(c) ? escapeCsvField(c.dueDate ?? '') : '',
    hasTaxType(c) ? escapeCsvField(c.taxType ?? '') : '',
    escapeCsvField(c.propertyId ?? ''),
  ];
  return cells.join(',');
}

function ensureFile(csvPath: string): void {
  if (fs.existsSync(csvPath)) return;
  const dir = csvPath.replace(/\/[^/]+$/, '');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(csvPath, `${OBLIGATION_CSV_HEADERS.join(',')}\n`, 'utf8');
}

function writeAll(csvPath: string, rows: readonly Obligation[]): void {
  const sorted = [...rows].sort((a, b) => a.id.localeCompare(b.id));
  const lines = [OBLIGATION_CSV_HEADERS.join(',')];
  for (const r of sorted) lines.push(obligationToCsvRow(r));
  atomicWriteCsv(csvPath, `${lines.join('\n')}\n`);
  __resetObligationRegistryForTests();
}

export interface ObligationsWriter {
  upsert(obligation: Obligation): void;
  remove(id: string): boolean;
}

export function buildObligationsWriter(obligationsDir: string): ObligationsWriter {
  const userCsv = getObligationsUserCsvPath(obligationsDir);
  return {
    upsert(obligation) {
      ensureFile(userCsv);
      const current = readObligationsCsvFile(userCsv);
      const idx = current.findIndex(c => c.id === obligation.id);
      if (idx >= 0) current[idx] = obligation;
      else current.push(obligation);
      writeAll(userCsv, current);
    },
    remove(id) {
      if (!fs.existsSync(userCsv)) return false;
      const current = readObligationsCsvFile(userCsv);
      const next = current.filter(c => c.id !== id);
      if (next.length === current.length) return false;
      writeAll(userCsv, next);
      return true;
    },
  };
}

