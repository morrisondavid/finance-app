/**
 * Clients domain — public barrel.
 *
 * Consumers should import from this file rather than reaching into
 * `registry.ts` / `queries.ts` directly so the domain boundary stays
 * stable.
 */

export {
  ClientSchema,
  DirectClientSchema,
  AgencyClientSchema,
  ClientIdSchema,
  ClientKindSchema,
  TemplateKindSchema,
  type Client,
  type DirectClient,
  type AgencyClient,
  type ClientId,
  type ClientKind,
  type TemplateKind,
} from './schema.js';

export {
  buildClientRegistry,
  buildClientRegistryFromData,
  getClientRegistry,
  invalidateClientRegistry,
  __resetClientRegistryForTests,
  type ClientRegistry,
} from './registry.js';

export {
  allClients,
  findClientById,
  listClientsByKind,
  listActiveClients,
  resolveTemplatePath,
} from './queries.js';

export {
  makeTestClientRegistry,
  type ClientRegistryFixtureInput,
} from './fixtures.js';

export {
  CLIENTS_CSV_FILENAME,
  CLIENT_CSV_HEADERS,
  getClientsCsvPath,
  parseClientRow,
  readClientsCsvFile,
  serializeClientRow,
  serializeClientsCsv,
  writeClientsCsvFile,
} from './csv-io.js';
