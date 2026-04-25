/**
 * Properties domain — raw data loader.
 *
 * Reads `properties/properties.csv` from disk via {@link readPropertiesCsvFile}.
 * The registry caches the parsed array; tests inject fixtures through
 * {@link buildPropertyRegistryFromData} directly.
 */

import path from 'path';
import { fileURLToPath } from 'url';
import { getPropertiesCsvPath, readPropertiesCsvFile } from './csv-io.js';
import type { Property } from './schema.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const DEFAULT_PROPERTIES_DIR = path.join(__dirname, '../../../properties');

export function loadPropertiesData(
  propertiesDir: string = DEFAULT_PROPERTIES_DIR,
): readonly Property[] {
  return readPropertiesCsvFile(getPropertiesCsvPath(propertiesDir));
}
