/**
 * Invoice draft builder — pure composition over Phase-1 primitives.
 *
 * The Phase 2 `GET /api/invoices/draft?contract_id=…` endpoint is
 * essentially "call this function and return the result". The UI then
 * lets the user tweak a handful of fields (primarily `days_billed`
 * and `description`) before `POST /api/invoices/generate` persists the
 * draft and renders the PDF.
 *
 * This file deliberately contains zero new math. Every calculation is
 * delegated to a Phase-1 primitive so the invoice the user sees and
 * the figures the Contracts-tab accrual banner shows can never drift
 * apart:
 *
 *   - `resolveNextPeriodStart` — "where does the next period begin?"
 *     (step 1/step 4 of the §1.3 fallback chain; Phase 4 fills in 2/3).
 *   - `calculateWorkload`        — working days, leave, subtotal.
 *   - `resolveInvoiceVatRate`    — VAT rate per issuing entity.
 *   - `nextSupplierInvoiceId`    — `DC-###` (Delta Capita) or
 *     `UK-####` / `FZ-####` for other clients.
 *
 * Callers supply every input explicitly (contract, client, company,
 * leave rows, existing invoices, `today`). The builder does not reach
 * into any registry, so it's trivial to test in isolation and safe to
 * reuse from any context.
 *
 * Consultant name is hard-coded to `"David Morrison"` for now. When
 * multi-consultant support lands, this should read from a
 * `consultant_name` column on `company.csv` or the consultant-profile
 * table that replaces it.
 */

import type {
  Client,
  Company,
  Contract,
  Invoice,
  LeaveRow,
} from '../../../shared/api-contracts.js';
import { monthRange, shiftIsoDate } from '../../../shared/iso-date.js';
import { calculateWorkload } from '../contracts/workload.js';
import { resolveInvoiceVatRate } from '../../config/tax-rates.js';
import { nextSupplierInvoiceId } from './next-invoice-id.js';
import { resolveNextPeriodStart } from './resolve-next-period.js';

// TODO: when multi-consultant support lands (Roadmap 1.2+), read the
// consultant's name from the issuing company's profile instead of
// hard-coding a single owner here.
const CONSULTANT_NAME = 'David Morrison';

export interface BuildDraftInput {
  readonly contract: Contract;
  readonly client: Client;
  readonly company: Company;
  readonly leaveRows: readonly LeaveRow[];
  /**
   * Invoices pre-filtered to this contract for
   * `resolveNextPeriodStart`, PLUS every invoice already issued by
   * `contract.issuing_entity_id` so `nextSupplierInvoiceId` can spot
   * the right max. In practice callers pass the full registry slice
   * for the entity and the builder uses it for both purposes — the
   * helpers below are resilient to extra rows.
   */
  readonly existingInvoices: readonly Invoice[];
  readonly today: string;
  /**
   * When set, invoice line dates use this calendar month (any ISO day in
   * the month) clamped to the contract instead of `resolveNextPeriodStart`
   * + the month containing `today`. Issuer still uses `today` for
   * `invoice_date` / `due_date`. Callers must pre-validate with
   * {@link resolveBillingMonthPeriod} (HTTP layer returns 400 when null).
   */
  readonly billing_month?: string | undefined;
  /** Entity-scoped public holidays forwarded to `calculateWorkload`. */
  readonly publicHolidayDates?: ReadonlySet<string>;
}

/** `min` for two ISO date strings. */
function minIso(a: string, b: string): string {
  return a <= b ? a : b;
}

/** `max` for two ISO date strings. */
function maxIso(a: string, b: string): string {
  return a >= b ? a : b;
}

/**
 * Billable window for a chosen calendar month clipped to the contract.
 * Returns `null` when the month does not overlap the engagement
 * (`period_start` would fall after `period_end`).
 */
export function resolveBillingMonthPeriod(
  contract: Contract,
  billingMonthAnyDay: string,
): { readonly periodStart: string; readonly periodEnd: string } | null {
  const { start: mStart, end: mEnd } = monthRange(billingMonthAnyDay);
  const periodStart = maxIso(mStart, contract.start_date);
  const periodEnd = minIso(mEnd, contract.end_date);
  if (periodStart > periodEnd) return null;
  return { periodStart, periodEnd };
}

/**
 * Compose a fresh draft invoice for `contract`. Status is always
 * `'draft'` and `pdf_path` is `null`; the generate endpoint flips both
 * of those once the PDF is rendered.
 *
 * A degenerate `[period_start, period_end]` (e.g. a contract that
 * ended before the calendar month began) yields a draft with zero
 * billable days — we return it rather than erroring so the UI can
 * surface the reason to the user and let them override manually.
 */
export function buildDraftInvoice(input: BuildDraftInput): Invoice {
  const { contract, client, company, leaveRows, existingInvoices, today,
    billing_month: billingMonth, publicHolidayDates } = input;

  const contractInvoices = existingInvoices
    .filter(inv => inv.contract_id === contract.id);

  let periodStart: string;
  let periodEnd: string;
  if (billingMonth !== undefined) {
    const resolved = resolveBillingMonthPeriod(contract, billingMonth);
    if (resolved === null) {
      throw new Error(
        'buildDraftInvoice: billing_month does not overlap contract — validate with resolveBillingMonthPeriod first',
      );
    }
    periodStart = resolved.periodStart;
    periodEnd = resolved.periodEnd;
  } else {
    periodStart = resolveNextPeriodStart({
      contract,
      invoices: contractInvoices,
      today,
    });

    const monthEnd = monthRange(today).end;
    periodEnd = minIso(monthEnd, contract.end_date);
  }

  const workload = calculateWorkload({
    contract,
    leaveRows,
    start: periodStart,
    end: periodEnd,
    publicHolidayDates,
  });

  const vatRate = resolveInvoiceVatRate(company);
  const subtotal = workload.subtotal;
  const vatAmount = subtotal * vatRate;
  const total = subtotal + vatAmount;

  const id = nextSupplierInvoiceId(
    client,
    company,
    contract.issuing_entity_id,
    existingInvoices,
  );

  const invoiceNumber = id;

  const invoiceDate = today;
  const dueDate = shiftIsoDate(invoiceDate, contract.payment_terms_days);

  const description =
    `${CONSULTANT_NAME} - Consultant Services, ${contract.job_title}`;

  return {
    id,
    contract_id: contract.id,
    client_id: contract.client_id,
    issuing_entity_id: contract.issuing_entity_id,
    invoice_number: invoiceNumber,
    payment_reference: invoiceNumber,
    invoice_date: invoiceDate,
    period_start: periodStart,
    period_end: periodEnd,
    days_billed: workload.workingDays,
    description,
    currency: contract.invoice_currency,
    subtotal,
    vat_rate: vatRate,
    vat_amount: vatAmount,
    total,
    fx_rate_at_issue: null,
    fx_base_currency: null,
    mechanism: 'supplier-issued',
    pdf_path: null,
    status: 'draft',
    due_date: dueDate,
    created_at: invoiceDate,
    updated_at: null,
  };
}
