/**
 * Writer for `commitments/commitments.csv`. Handles upsert and delete for
 * user-editable declaration rows; the seed file is never written to from
 * the runtime — it's a git-tracked bootstrap shipped with the repo.
 */

import fs from 'fs';
import {
  readCommitmentsCsvFile,
  getCommitmentsUserCsvPath,
  COMMITMENT_CSV_HEADERS,
} from './csv-io.js';
import { escapeCsvField, atomicWriteCsv } from '../../utils/csv-helpers.js';
import { __resetDeclaredCommitmentRegistryForTests } from './registry.js';
import type {
  DeclaredCommitment,
  DeclaredOutgoing,
  DeclaredIncoming,
  PersonId,
} from '../../../shared/api-contracts.js';

function hasOwnership(c: DeclaredCommitment): c is Extract<DeclaredIncoming, { category: 'rental-income' }> {
  return c.category === 'rental-income';
}
function hasPersonId(c: DeclaredCommitment): c is Extract<DeclaredOutgoing, { category: 'payroll' | 'tax-manual' }> {
  return c.category === 'payroll' || c.category === 'tax-manual';
}
function hasAmountTolerance(c: DeclaredCommitment): c is Extract<DeclaredOutgoing, { category: 'payroll' }> {
  return c.category === 'payroll';
}
function hasDueDate(c: DeclaredCommitment): c is Extract<DeclaredOutgoing, { category: 'insurance' | 'tax-manual' }> {
  return c.category === 'insurance' || c.category === 'tax-manual';
}

function ownershipAt(c: DeclaredCommitment, key: PersonId): string {
  if (!hasOwnership(c)) return '';
  const v = c.ownership[key];
  return v === undefined ? '' : String(v);
}

function commitmentToCsvRow(c: DeclaredCommitment): string {
  const cells = [
    escapeCsvField(c.id),
    escapeCsvField(c.category),
    escapeCsvField(c.cadence),
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
  ];
  return cells.join(',');
}

function ensureFile(csvPath: string): void {
  if (fs.existsSync(csvPath)) return;
  const dir = csvPath.replace(/\/[^/]+$/, '');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(csvPath, `${COMMITMENT_CSV_HEADERS.join(',')}\n`, 'utf8');
}

function writeAll(csvPath: string, rows: readonly DeclaredCommitment[]): void {
  const sorted = [...rows].sort((a, b) => a.id.localeCompare(b.id));
  const lines = [COMMITMENT_CSV_HEADERS.join(',')];
  for (const r of sorted) lines.push(commitmentToCsvRow(r));
  atomicWriteCsv(csvPath, `${lines.join('\n')}\n`);
  __resetDeclaredCommitmentRegistryForTests();
}

export interface CommitmentsWriter {
  upsert(commitment: DeclaredCommitment): void;
  remove(id: string): boolean;
}

export function buildCommitmentsWriter(commitmentsDir: string): CommitmentsWriter {
  const userCsv = getCommitmentsUserCsvPath(commitmentsDir);
  return {
    upsert(commitment) {
      ensureFile(userCsv);
      const current = readCommitmentsCsvFile(userCsv);
      const idx = current.findIndex(c => c.id === commitment.id);
      if (idx >= 0) current[idx] = commitment;
      else current.push(commitment);
      writeAll(userCsv, current);
    },
    remove(id) {
      if (!fs.existsSync(userCsv)) return false;
      const current = readCommitmentsCsvFile(userCsv);
      const next = current.filter(c => c.id !== id);
      if (next.length === current.length) return false;
      writeAll(userCsv, next);
      return true;
    },
  };
}

