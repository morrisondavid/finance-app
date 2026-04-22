/**
 * Transaction-overrides domain — schema re-exports.
 *
 * The canonical row Zod schema lives in `shared/api-contracts.ts`
 * because the POST /classify endpoint parses requests and responses
 * against it. This file re-exports it under the canonical `schema.ts`
 * name so the transaction-overrides domain mirrors every other
 * registry directory.
 */

export {
  TransactionCategoryOverrideRowSchema,
  type TransactionCategoryOverrideRow,
} from '../../../shared/api-contracts.js';

export type { CategoryName } from '../../../shared/category-names.js';
