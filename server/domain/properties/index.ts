/**
 * Properties domain — public barrel.
 *
 * Consumers should import from this module rather than internal files.
 */

export {
  buildPropertyRegistry,
  buildPropertyRegistryFromData,
  getPropertyRegistry,
  invalidatePropertyRegistry,
  __resetPropertyRegistryForTests,
  type PropertyRegistry,
} from './registry.js';

export {
  PropertySchema,
  PropertyIdSchema,
  PropertiesDataSchema,
  type Property,
  type PropertyId,
  type PropertiesData,
} from './schema.js';

export {
  allProperties,
  allPropertyIds,
  propertyById,
  isPropertyId,
} from './queries.js';

export { makeTestPropertyRegistry } from './fixtures.js';

export {
  PROPERTIES_CSV_FILENAME,
  PROPERTY_CSV_HEADERS,
  parsePropertyRow,
  readPropertiesCsvFile,
  getPropertiesCsvPath,
} from './csv-io.js';

export { DEFAULT_PROPERTIES_DIR, loadPropertiesData } from './data.js';
