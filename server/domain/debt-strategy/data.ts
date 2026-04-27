/**
 * Debt-strategy domain — raw data loader for `plans.csv`.
 */

import path from 'path';
import { fileURLToPath } from 'url';
import { getPlansCsvPath, readPlansCsvFile } from './csv-io.js';
import type { Plan } from './schema.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const DEFAULT_DEBT_STRATEGY_DIR = path.join(__dirname, '../../../debt-strategy');

export function loadPlansData(
  debtStrategyDir: string = DEFAULT_DEBT_STRATEGY_DIR,
): readonly Plan[] {
  return readPlansCsvFile(getPlansCsvPath(debtStrategyDir));
}
