import { getMovementsCsvPath, readMovementsCsvFile } from './movements-csv-io.js';
import { DEFAULT_DEBT_STRATEGY_DIR } from './data.js';
import type { Movement } from './movements-schema.js';

export function loadMovementsData(
  debtStrategyDir: string = DEFAULT_DEBT_STRATEGY_DIR,
): readonly Movement[] {
  return readMovementsCsvFile(getMovementsCsvPath(debtStrategyDir));
}
