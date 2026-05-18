import { getDb } from '../connection.js';
import { replaceFixedExpenseSimulationExclusionsPersisted } from '../fixed-expense-simulation-exclusions-csv.js';

export function getFixedExpenseSimulationExclusions(): string[] {
  const rows = getDb()
    .prepare(`SELECT line_key FROM fixed_expense_simulation_exclusions ORDER BY line_key`)
    .all() as { line_key: string }[];
  return rows.map((r) => r.line_key);
}

export function replaceFixedExpenseSimulationExclusions(lineKeys: readonly string[]): void {
  replaceFixedExpenseSimulationExclusionsPersisted(lineKeys, getDb());
}
