/**
 * Master-agreements domain — schema re-exports.
 *
 * Master agreements are the legal umbrella above individual SOWs (e.g.
 * Delta Capita's contractor framework). Intentionally minimal — no
 * commercial terms, no working-pattern columns. Commercial terms live
 * on the contract rows that reference this master via FK.
 */

export {
  MasterAgreementSchema,
  MasterAgreementIdSchema,
  type MasterAgreement,
  type MasterAgreementId,
} from '../../../shared/api-contracts.js';
