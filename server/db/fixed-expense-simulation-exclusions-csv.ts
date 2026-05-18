/**
 * CSV backing for `fixed_expense_simulation_exclusions` (`data/fixed-expense-simulation-exclusions.csv`).
 */
import fs from 'fs';
import path from 'path';
import type { Database } from 'better-sqlite3';
import { REPO_ROOT } from '../repo-root.js';
import { readCsvRecords } from '../utils/csv-decoders.js';
import { recomputeAndPersistDataManifest } from '../data-manifest.js';

const CSV_PATH = path.join(REPO_ROOT, 'data', 'fixed-expense-simulation-exclusions.csv');

export function readFixedExpenseSimulationExclusionsFromCsv(): string[] {
  if (!fs.existsSync(CSV_PATH)) return [];
  const rows = readCsvRecords(CSV_PATH);
  const keys: string[] = [];
  for (const r of rows) {
    const k = (r.line_key ?? '').trim();
    if (k !== '') keys.push(k);
  }
  return keys;
}

export function writeFixedExpenseSimulationExclusionsCsv(lineKeys: readonly string[]): void {
  const dir = path.dirname(CSV_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const uniq = [...new Set(lineKeys.map(k => k.trim()).filter(k => k !== ''))].sort();
  const lines = ['line_key', ...uniq];
  const content = `${lines.join('\n')}\n`;
  const tmp = `${CSV_PATH}.tmp`;
  fs.writeFileSync(tmp, content, 'utf-8');
  fs.renameSync(tmp, CSV_PATH);
}

export function applyFixedExpenseExclusionsCsvToDb(db: Database): void {
  const keys = readFixedExpenseSimulationExclusionsFromCsv();
  db.prepare(`DELETE FROM fixed_expense_simulation_exclusions`).run();
  const ins = db.prepare(`INSERT INTO fixed_expense_simulation_exclusions (line_key) VALUES (?)`);
  for (const k of keys) {
    ins.run(k);
  }
}

export function replaceFixedExpenseSimulationExclusionsPersisted(
  lineKeys: readonly string[],
  db: Database,
): void {
  writeFixedExpenseSimulationExclusionsCsv(lineKeys);
  db.prepare(`DELETE FROM fixed_expense_simulation_exclusions`).run();
  const ins = db.prepare(`INSERT INTO fixed_expense_simulation_exclusions (line_key) VALUES (?)`);
  for (const raw of lineKeys) {
    const k = raw.trim();
    if (k !== '') ins.run(k);
  }
  recomputeAndPersistDataManifest();
}
