import { getDb } from '../connection.js';

export function getFixedExpenseSimulationExclusions(): string[] {
  const rows = getDb()
    .prepare(`SELECT line_key FROM fixed_expense_simulation_exclusions ORDER BY line_key`)
    .all() as { line_key: string }[];
  return rows.map((r) => r.line_key);
}

export function replaceFixedExpenseSimulationExclusions(lineKeys: readonly string[]): void {
  const db = getDb();
  const tx = db.transaction(() => {
    db.prepare(`DELETE FROM fixed_expense_simulation_exclusions`).run();
    const ins = db.prepare(`INSERT INTO fixed_expense_simulation_exclusions (line_key) VALUES (?)`);
    for (const raw of lineKeys) {
      const k = raw.trim();
      if (k !== '') ins.run(k);
    }
  });
  tx();
}
