/**
 * Self-bill ingestion orchestrator — pure composition.
 *
 * Consumes already-extracted PDF text and composes the registry-aware
 * steps that the pure `parseLaFosseSelfBill` cannot do on its own:
 *
 *   detect  → parse  → contract lookup  → duplicate check  →
 *     nextInvoiceIdForEntity  → canonical `Invoice` row
 *
 * Every failure mode is a variant of `IngestSelfBillResult` so the
 * route layer (`POST /api/invoices/ingest-self-bill`) can map each one
 * to a distinct HTTP status without try/catch.
 *
 * Persistence is deliberately out of scope here — the orchestrator
 * just returns the shaped `Invoice`; the route then calls
 * `createInvoice` to write it. That keeps the orchestrator
 * unit-testable against registry fixtures without touching disk.
 */

import type {
  Client,
  Contract,
  Invoice,
  InvoiceId,
} from '../../../shared/api-contracts.js';
import { shiftIsoDate } from '../../../shared/iso-date.js';
import { allInvoices } from './queries.js';
import { nextInvoiceIdForEntity } from './next-invoice-id.js';
import { getCompanyRegistry } from '../company/registry.js';
import { companyById } from '../company/queries.js';
import { findClientById } from '../clients/queries.js';
import { listContractsByClient } from '../contracts/queries.js';
import {
  detectSelfBillKind,
  type ParsedSelfBill,
  type ParseSelfBillResult,
  type SelfBillParserEntry,
  SELF_BILL_PARSERS,
} from './parsers/index.js';

/** PDF placement ref matches this first, else legacy `reference`. */
export function selfBillPlacementMatchKey(contract: Contract): string {
  const p = contract.placement_ref;
  if (p !== null && p !== '') return p;
  return contract.reference;
}

export interface IngestSelfBillInput {
  readonly rawText: string;
  readonly today: string;
  /** Override for tests. Defaults to `SELF_BILL_PARSERS`. */
  readonly parsers?: readonly SelfBillParserEntry[];
  /** Override for tests. Defaults to `allInvoices()`. */
  readonly existingInvoices?: readonly Invoice[];
}

export type IngestSelfBillResult =
  | { readonly ok: true; readonly invoice: Invoice; readonly parsed: ParsedSelfBill; readonly contract: Contract; readonly client: Client }
  | { readonly ok: false; readonly code: 'no-parser-match' }
  | {
      readonly ok: false;
      readonly code: 'parse-failed';
      readonly detail: string;
    }
  | {
      readonly ok: false;
      readonly code: 'client-not-found';
      readonly clientId: string;
    }
  | {
      readonly ok: false;
      readonly code: 'no-contract-match';
      readonly clientId: string;
      readonly placementRef: string;
    }
  | {
      readonly ok: false;
      readonly code: 'ambiguous-contract';
      readonly clientId: string;
      readonly placementRef: string;
      readonly contractIds: readonly string[];
    }
  | {
      readonly ok: false;
      readonly code: 'issuing-entity-not-found';
      readonly entityId: string;
    }
  | {
      readonly ok: false;
      readonly code: 'duplicate-supplier-invoice';
      readonly existingInvoiceId: InvoiceId;
      readonly supplierInvoiceNumber: string;
    };

/**
 * Compose a canonical `Invoice` from raw PDF text. Returns a
 * discriminated union — callers branch on `result.ok` without
 * try/catch.
 */
export function ingestSelfBill(input: IngestSelfBillInput): IngestSelfBillResult {
  const detect = detectSelfBillKind(input.rawText, input.parsers ?? SELF_BILL_PARSERS);
  if (!detect.ok) {
    return { ok: false, code: 'no-parser-match' };
  }

  const parseResult: ParseSelfBillResult = detect.entry.parse(input.rawText);
  if (!parseResult.ok) {
    return {
      ok: false,
      code: 'parse-failed',
      detail:
        parseResult.code === 'empty-text'
          ? 'PDF text was empty'
          : parseResult.detail,
    };
  }

  const parsed = parseResult.invoice;
  const clientId = detect.entry.clientId;

  const client = findClientById(clientId);
  if (client === null) {
    return { ok: false, code: 'client-not-found', clientId };
  }

  const contracts = listContractsByClient(clientId);
  const matches = contracts.filter(
    c => selfBillPlacementMatchKey(c) === parsed.placementRef,
  );
  if (matches.length === 0) {
    return {
      ok: false,
      code: 'no-contract-match',
      clientId,
      placementRef: parsed.placementRef,
    };
  }
  if (matches.length > 1) {
    return {
      ok: false,
      code: 'ambiguous-contract',
      clientId,
      placementRef: parsed.placementRef,
      contractIds: matches.map(c => c.id),
    };
  }

  const contract = matches[0]!;

  const company = companyById(contract.issuing_entity_id, getCompanyRegistry());
  if (company === null) {
    return {
      ok: false,
      code: 'issuing-entity-not-found',
      entityId: contract.issuing_entity_id,
    };
  }

  const existingInvoices = input.existingInvoices ?? allInvoices();

  // Duplicate check is by `payment_reference` — the canonical place we
  // store the supplier's own invoice number. Fast enough over the full
  // invoice list; the registry doesn't yet index by payment_reference
  // and this is the only writer that cares.
  const duplicate = existingInvoices.find(
    inv => inv.payment_reference === parsed.supplierInvoiceNumber,
  );
  if (duplicate !== undefined) {
    return {
      ok: false,
      code: 'duplicate-supplier-invoice',
      existingInvoiceId: duplicate.id,
      supplierInvoiceNumber: parsed.supplierInvoiceNumber,
    };
  }

  const id = nextInvoiceIdForEntity(
    contract.issuing_entity_id,
    company,
    existingInvoices,
  );

  const invoice: Invoice = {
    id,
    contract_id: contract.id,
    client_id: clientId,
    issuing_entity_id: contract.issuing_entity_id,
    // Canonical id lives in `invoice_number`; the supplier's own id
    // (`SB-277615`) rides in `payment_reference` so the reconciler can
    // match bank deposits that cite it.
    invoice_number: id,
    payment_reference: parsed.supplierInvoiceNumber,
    invoice_date: parsed.invoiceDate,
    period_start: parsed.periodStart,
    period_end: parsed.periodEnd,
    days_billed: parsed.daysBilled,
    description: `David Morrison - Consultant Services, ${parsed.jobTitle}`,
    currency: parsed.currency === 'GBP' || parsed.currency === 'AED'
      ? parsed.currency
      : 'GBP',
    subtotal: parsed.subtotal,
    vat_rate: parsed.vatRate,
    vat_amount: parsed.vatAmount,
    total: parsed.total,
    fx_rate_at_issue: null,
    fx_base_currency: null,
    mechanism: 'self-bill',
    // Route layer sets this to the `invoices/ingested/<id>.pdf` path
    // once it has persisted the uploaded file.
    pdf_path: null,
    status: 'issued',
    due_date: shiftIsoDate(parsed.invoiceDate, contract.payment_terms_days),
    created_at: input.today,
    updated_at: null,
  };

  return { ok: true, invoice, parsed, contract, client };
}
