/**
 * Contracts domain — public barrel.
 */

export {
  ContractSchema,
  ContractIdSchema,
  InvoiceCadenceSchema,
  InvoiceMechanismSchema,
  ConductRegsSchema,
  EngagementTaxStatusSchema,
  type Contract,
  type ContractId,
  type InvoiceCadence,
  type InvoiceMechanism,
  type ConductRegs,
  type EngagementTaxStatus,
} from './schema.js';

export {
  buildContractRegistry,
  buildContractRegistryFromData,
  clientEntityKey,
  getContractRegistry,
  invalidateContractRegistry,
  __resetContractRegistryForTests,
  type ContractRegistry,
  type BuildContractRegistryInput,
} from './registry.js';

export {
  allContracts,
  findContractById,
  findContractForTransaction,
  listActiveContracts,
  listContractsByClient,
  upsertContract,
  type FindContractForTransactionQuery,
  type UpsertContractInput,
} from './queries.js';

export {
  makeTestContractRegistry,
  type ContractRegistryFixtureInput,
} from './fixtures.js';

export {
  CONTRACTS_CSV_FILENAME,
  CONTRACT_CSV_HEADERS,
  getContractsCsvPath,
  parseContractRow,
  readContractsCsvFile,
  serializeContractRow,
  serializeContractsCsv,
  writeContractsCsvFile,
} from './csv-io.js';
