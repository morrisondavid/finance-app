/**
 * Reserves domain — raw data loader.
 */

import path from 'path';
import { fileURLToPath } from 'url';
import { getReservesCsvPath, readReservesCsvFile } from './csv-io.js';
import type { Reserve } from './schema.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const DEFAULT_RESERVES_DIR = path.join(__dirname, '../../../reserves');

export function loadReservesData(
  reservesDir: string = DEFAULT_RESERVES_DIR,
): readonly Reserve[] {
  return readReservesCsvFile(getReservesCsvPath(reservesDir));
}
