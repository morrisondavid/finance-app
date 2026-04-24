/**
 * Invoices domain — schema re-exports.
 *
 * Canonical Zod schemas live in `shared/api-contracts.ts` so API
 * response validation and registry validation key off the same
 * definitions. This file mirrors the convention used by every other
 * registry under `server/domain/`.
 */

export {
  InvoiceSchema,
  InvoiceIdSchema,
  InvoiceStatusSchema,
  InvoiceMechanismSchema,
  InvoicePaymentSchema,
  InvoicePaymentIdSchema,
  InvoicesListResponseSchema,
  type Invoice,
  type InvoiceId,
  type InvoiceStatus,
  type InvoiceMechanism,
  type InvoicePayment,
  type InvoicePaymentId,
  type InvoicesListResponse,
} from '../../../shared/api-contracts.js';
