/**
 * Master-agreements domain — public barrel.
 */

export {
  MasterAgreementSchema,
  MasterAgreementIdSchema,
  type MasterAgreement,
  type MasterAgreementId,
} from './schema.js';

export {
  MASTER_AGREEMENTS_CSV_FILENAME,
  MASTER_AGREEMENT_CSV_HEADERS,
  getMasterAgreementsCsvPath,
  parseMasterAgreementRow,
  readMasterAgreementsCsvFile,
  serializeMasterAgreementRow,
  serializeMasterAgreementsCsv,
  writeMasterAgreementsCsvFile,
} from './csv-io.js';

export {
  loadMasterAgreements,
  invalidateMasterAgreements,
  __resetMasterAgreementsForTests,
} from './loader.js';
