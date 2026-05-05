/**
 * Invoices domain — public barrel.
 *
 * Consumers should import from this file rather than reaching into
 * `registry.ts` / `queries.ts` directly so the domain boundary stays
 * stable.
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
} from './schema.js';

export {
  buildInvoiceRegistry,
  buildInvoiceRegistryFromData,
  getInvoiceRegistry,
  invalidateInvoiceRegistry,
  __resetInvoiceRegistryForTests,
  DEFAULT_INVOICES_DIR,
  type InvoiceRegistry,
} from './registry.js';

export {
  buildInvoicePaymentRegistry,
  buildInvoicePaymentRegistryFromData,
  getInvoicePaymentRegistry,
  invalidateInvoicePaymentRegistry,
  __resetInvoicePaymentRegistryForTests,
  DEFAULT_INVOICE_PAYMENTS_DIR,
  type InvoicePaymentRegistry,
} from './payments-registry.js';

export {
  allInvoices,
  findInvoiceById,
  listInvoicesByContractId,
  listInvoicesByIssuingEntityId,
  listInvoicesByStatus,
  latestInvoiceForContract,
  allInvoicePayments,
  listPaymentsForInvoice,
  findPaymentByBankTransaction,
} from './queries.js';

export {
  makeTestInvoiceRegistry,
  type InvoiceRegistryFixtureInput,
} from './fixtures.js';

export {
  resolveNextPeriodStart,
  type ResolveNextPeriodInput,
} from './resolve-next-period.js';

export {
  invoiceIdPrefixFor,
  nextInvoiceIdForEntity,
  nextSupplierInvoiceId,
} from './next-invoice-id.js';

export {
  nextDeltaCapitaInvoiceId,
  nextDeltaCapitaInvoiceNumber,
} from './client-invoice-number.js';

export {
  buildDraftInvoice,
  resolveBillingMonthPeriod,
  type BuildDraftInput,
} from './build-draft.js';

export {
  listSupplierMonthlyInvoiceGaps,
  type ListSupplierMonthlyInvoiceGapsInput,
} from './supplier-month-gaps.js';

export {
  writeIngestedPdf,
  getIngestedPdfDir,
  getIngestedPdfPath,
  getRelativeIngestedPdfPath,
  INGESTED_PDF_SUBDIR,
  type WriteIngestedPdfInput,
  type WriteIngestedPdfResult,
} from './pdf/ingested.js';

export {
  ingestSelfBill,
  type IngestSelfBillInput,
  type IngestSelfBillResult,
} from './ingest-self-bill.js';

export {
  persistIngestedSelfBillFromBuffer,
  type PersistIngestedSelfBillFromBufferResult,
} from './ingest-persist.js';

export {
  detectSelfBillKind,
  parseLaFosseSelfBill,
  extractPdfText,
  SELF_BILL_PARSERS,
  type ParseSelfBillResult,
  type ParsedSelfBill,
  type SelfBillParserEntry,
  type DetectSelfBillKindResult,
} from './parsers/index.js';

export {
  createInvoice,
  updateInvoice,
  recordInvoicePayments,
  type CreateInvoiceInput,
  type CreateInvoiceResult,
  type UpdateInvoiceInput,
  type UpdateInvoiceResult,
  type RecordInvoicePaymentsInput,
  type RecordInvoicePaymentsResult,
} from './mutations.js';

export {
  planReconciliation,
  type PlanReconciliationInput,
  type ReconcileTransaction,
  type ReconcileOptions,
  type ReconciliationPlan,
  type ReconciliationNote,
} from './reconcile-payments.js';

export {
  buildInvoiceDocDefinition,
} from './pdf/doc-definition.js';

export { renderInvoicePdf } from './pdf/render.js';

export {
  writeInvoicePdf,
  getGeneratedPdfDir,
  getGeneratedPdfPath,
  getRelativePdfPath,
  GENERATED_PDF_SUBDIR,
  type WriteInvoicePdfInput,
  type WriteInvoicePdfResult,
} from './pdf/write.js';

export {
  INVOICES_CSV_FILENAME,
  INVOICE_PAYMENTS_CSV_FILENAME,
  INVOICE_CSV_HEADERS,
  INVOICE_PAYMENT_CSV_HEADERS,
  getInvoicesCsvPath,
  getInvoicePaymentsCsvPath,
  parseInvoiceRow,
  parseInvoicePaymentRow,
  readInvoicesCsvFile,
  readInvoicePaymentsCsvFile,
  serializeInvoiceRow,
  serializeInvoicesCsv,
  writeInvoicesCsvFile,
  serializeInvoicePaymentRow,
  serializeInvoicePaymentsCsv,
  writeInvoicePaymentsCsvFile,
} from './csv-io.js';
