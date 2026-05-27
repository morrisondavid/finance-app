/**
 * Invoices tab (Roadmap 1.3 — Phases 2 & 3).
 *
 * Renders every row in `invoices.csv` grouped by issuing entity, plus
 * two composition flows:
 *
 *   - **Generate invoice** — pick a **supplier-issued** contract,
 *     choose billing month, review the server-computed draft, save → PDF.
 *   - **Ingest self-bill PDFs** — upload one or more agency PDFs; the
 *     server ingests each file in turn (same route as a single upload).
 *
 * Invoice cards use local `invoice-card` styles (plain bordered tiles);
 * contract tiles keep their own layout on the Contracts tab.
 *
 * `openSupplierInvoiceForContract` / `openSelfBillIngestWithHint` are
 * called from the Contracts tab so a tile can jump straight into the
 * right flow (after switching to this tab — modals live under `#invoices`).
 */

import type {
  Contract,
  Client,
  Company,
  Invoice,
  CurrencyCode,
} from '../../../shared/api-contracts.js';
import { escapeHtml, openModal, closeModal } from '../utils/dom';
import { formatCurrency, formatIsoDateUk } from '../utils/formatting';
import { previousCompleteBillingMonthYYYYMM, todayIsoLocal } from '../../../shared/iso-date.js';
import { activateTabByName } from './tabs.js';

const GROUPS_ID = 'invoices-groups';
const STATUS_ID = 'invoices-status';
const GEN_BTN_ID = 'invoices-generate-btn';
const INGEST_BTN_ID = 'invoices-ingest-btn';

const GEN_MODAL_ID = 'invoices-generate-modal';
const GEN_MODAL_CLOSE_ID = 'invoices-generate-modal-close';
const GEN_MODAL_CANCEL_ID = 'invoices-generate-modal-cancel';
const GEN_FORM_ID = 'invoices-generate-form';
const GEN_CONTRACT_SELECT_ID = 'invoices-generate-contract-select';
const GEN_BILLING_MONTH_ID = 'invoices-generate-billing-month';
const GEN_DRAFT_FIELDS_ID = 'invoices-generate-draft-fields';
const GEN_OVERLAP_WARNING_ID = 'invoices-generate-overlap-warning';
const GEN_SUBMIT_ID = 'invoices-generate-submit';
const GEN_ERROR_ID = 'invoices-generate-error';
const GEN_ALLOW_OUTSIDE_GAP_WRAP_ID = 'invoices-generate-outside-gap-wrap';
const GEN_ALLOW_OUTSIDE_GAP_ID = 'invoices-generate-allow-outside-gap';

const INGEST_MODAL_ID = 'invoices-ingest-modal';
const INGEST_MODAL_CLOSE_ID = 'invoices-ingest-modal-close';
const INGEST_MODAL_CANCEL_ID = 'invoices-ingest-modal-cancel';
const INGEST_FORM_ID = 'invoices-ingest-form';
const INGEST_RESULT_ID = 'invoices-ingest-result';
const INGEST_ERROR_ID = 'invoices-ingest-error';
const INGEST_CONTEXT_HINT_ID = 'invoices-ingest-context-hint';
const INGEST_SUBMIT_ID = 'invoices-ingest-submit';

interface MonthlyInvoiceWorkload {
  readonly daysBilled: number;
  readonly ledgerWorkingDays: number;
  readonly match: boolean;
}

interface MonthlyInvoicePreviewOk {
  readonly contract_id: string;
  readonly billing_month: string;
  readonly previewFingerprint: string;
  readonly invoice: Invoice;
  readonly occupancy: {
    readonly blocked: boolean;
    readonly blockingInvoiceIds: readonly string[];
  };
  readonly gapList: { readonly outsideMonthlyGapList: boolean };
  readonly workload: MonthlyInvoiceWorkload;
}

let currentDraft: Invoice | null = null;
let monthlyPreviewFingerprint: string | null = null;
let lastMonthlyPreview: MonthlyInvoicePreviewOk | null = null;

function defaultBillingPickerMonth(contract: Contract | null): string {
  const today = todayIsoLocal();
  if (
    contract !== null
    && contract.end_date !== null
    && contract.end_date < today
  ) {
    return contract.end_date.slice(0, 7);
  }
  return previousCompleteBillingMonthYYYYMM(today);
}

function extractErrorLine(rawText: string, status: number): string {
  try {
    const raw: unknown = JSON.parse(rawText);
    if (typeof raw !== 'object' || raw === null) return `${status}`;
    const o = raw as Record<string, unknown>;
    if (typeof o.message === 'string') return o.message;
    if (typeof o.error === 'string') return o.error;
  } catch {
    if (rawText.length > 0) return rawText.slice(0, 400);
  }
  return `Request failed (${status})`;
}

function getEl(id: string): HTMLElement | null {
  return document.getElementById(id);
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GET ${url} failed: ${res.status}`);
  return (await res.json()) as T;
}

interface InvoicesListResponse { readonly invoices: readonly Invoice[] }
interface ContractsListResponse { readonly contracts: readonly Contract[] }
interface ClientsListResponse { readonly clients: readonly Client[] }
interface CompaniesListResponse { readonly companies: readonly Company[] }

async function fetchMonthlyInvoicePreview(contractId: string, billingYm: string): Promise<MonthlyInvoicePreviewOk> {
  const res = await fetch('/api/invoices/monthly/preview', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contract_id: contractId, billing_month: billingYm }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(extractErrorLine(text, res.status));

  let raw: unknown;
  try {
    raw = JSON.parse(text) as unknown;
  } catch {
    throw new Error('Malformed JSON from monthly preview.');
  }

  if (typeof raw !== 'object' || raw === null) {
    throw new Error('Unexpected preview response.');
  }

  const o = raw as Record<string, unknown>;
  if (
    typeof o.previewFingerprint !== 'string'
    || typeof o.invoice !== 'object'
    || o.invoice === null
    || typeof o.occupancy !== 'object'
    || o.occupancy === null
    || typeof o.gapList !== 'object'
    || o.gapList === null
    || typeof o.workload !== 'object'
    || o.workload === null
  ) {
    throw new Error('Incomplete monthly preview payload.');
  }

  return raw as MonthlyInvoicePreviewOk;
}

function clearOutsideGapUi(): void {
  const wrap = getEl(GEN_ALLOW_OUTSIDE_GAP_WRAP_ID);
  const chk = getEl(GEN_ALLOW_OUTSIDE_GAP_ID);
  if (chk instanceof HTMLInputElement) chk.checked = false;
  if (wrap !== null) wrap.style.display = 'none';
}

function renderPreviewGuidanceFromServer(preview: MonthlyInvoicePreviewOk): void {
  const wrap = getEl(GEN_ALLOW_OUTSIDE_GAP_WRAP_ID);
  if (wrap !== null) {
    wrap.style.display = preview.gapList.outsideMonthlyGapList ? '' : 'none';
  }

  const el = getEl(GEN_OVERLAP_WARNING_ID);
  const lines: string[] = [];
  if (preview.occupancy.blocked) {
    lines.push(
      `This billing month already has invoice rows overlapping the calendar month (draft or issued): ${preview.occupancy.blockingInvoiceIds.join(', ')}.`,
    );
  }
  if (!preview.workload.match) {
    lines.push(
      `Days billed (${preview.workload.daysBilled}) differs from workload working days (${preview.workload.ledgerWorkingDays}) over the billed period.`,
    );
  }
  if (preview.gapList.outsideMonthlyGapList) {
    lines.push(
      'This month is outside the supplier “completed past months” gap list — use override only after confirming intentionally.',
    );
  }

  if (el !== null) {
    if (lines.length === 0) {
      el.textContent = '';
      el.style.display = 'none';
    } else {
      el.textContent = lines.join('\n');
      el.style.display = '';
    }
  }
}

function clearPreviewGuidance(): void {
  clearOutsideGapUi();
  const el = getEl(GEN_OVERLAP_WARNING_ID);
  if (el !== null) {
    el.textContent = '';
    el.style.display = 'none';
  }
}

function applyGenerateSubmitStateFromPreview(): void {
  if (lastMonthlyPreview === null || currentDraft === null) {
    setGenerateSubmitDisabled(true);
    return;
  }
  const chk = getEl(GEN_ALLOW_OUTSIDE_GAP_ID);
  const overrideGap = chk instanceof HTMLInputElement && chk.checked;
  const blockedByOccupancy = lastMonthlyPreview.occupancy.blocked;
  const blockedByGap = lastMonthlyPreview.gapList.outsideMonthlyGapList && !overrideGap;
  setGenerateSubmitDisabled(blockedByOccupancy || blockedByGap);
}

function getBillingMonthValue(): string {
  const el = getEl(GEN_BILLING_MONTH_ID);
  const fallbackYm = previousCompleteBillingMonthYYYYMM(todayIsoLocal());
  if (!(el instanceof HTMLInputElement)) return fallbackYm;
  const v = el.value.trim();
  return v.length >= 7 ? v.slice(0, 7) : fallbackYm;
}

function setBillingMonthValue(yyyyMm: string): void {
  const el = getEl(GEN_BILLING_MONTH_ID);
  if (!(el instanceof HTMLInputElement)) return;
  el.value = yyyyMm.length === 7 ? yyyyMm : yyyyMm.slice(0, 7);
}
// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

export async function loadInvoices(): Promise<void> {
  const groups = getEl(GROUPS_ID);
  if (groups === null) return;
  groups.innerHTML = '<div class="contracts-aggregate">Loading…</div>';

  try {
    const [invoicesRes, clientsRes, companiesRes, contractsRes] = await Promise.all([
      getJson<InvoicesListResponse>('/api/invoices'),
      getJson<ClientsListResponse>('/api/clients'),
      getJson<CompaniesListResponse>('/api/company'),
      getJson<ContractsListResponse>('/api/contracts'),
    ]);

    renderGroups(
      groups,
      invoicesRes.invoices,
      clientsRes.clients,
      companiesRes.companies,
    );
    populateContractSelect(contractsRes.contracts, clientsRes.clients);
  } catch (err) {
    groups.innerHTML = `<div class="clients-form-error">Failed to load invoices: ${escapeHtml(
      err instanceof Error ? err.message : String(err),
    )}</div>`;
  }
}

function renderGroups(
  host: HTMLElement,
  invoices: readonly Invoice[],
  clients: readonly Client[],
  companies: readonly Company[],
): void {
  if (invoices.length === 0) {
    host.innerHTML =
      '<div class="contracts-aggregate">No invoices yet. Use “Generate invoice” or “Ingest self-bill PDFs” to add one.</div>';
    return;
  }

  const clientById = new Map<string, Client>(clients.map(c => [c.id, c]));
  const companyById = new Map<string, Company>(companies.map(c => [c.id, c]));

  const byEntity = new Map<string, Invoice[]>();
  for (const inv of invoices) {
    const list = byEntity.get(inv.issuing_entity_id) ?? [];
    list.push(inv);
    byEntity.set(inv.issuing_entity_id, list);
  }

  const sections: string[] = [];
  for (const [entityId, rows] of byEntity) {
    const company = companyById.get(entityId);
    const heading = company?.trading_name ?? entityId;
    const sorted = [...rows].sort((a, b) =>
      a.invoice_date < b.invoice_date ? 1 : a.invoice_date > b.invoice_date ? -1 : 0,
    );
    const tiles = sorted
      .map(inv => renderTile(inv, clientById.get(inv.client_id) ?? null))
      .join('');
    sections.push(`
      <div class="contracts-section-divider">
        <h3 class="contracts-section-heading">${escapeHtml(heading)} <span class="contracts-muted">(${sorted.length})</span></h3>
      </div>
      <div class="invoices-tile-grid">${tiles}</div>
    `);
  }

  host.innerHTML = sections.join('');
}

/** Paid date / due line — paid invoices use a green tick + date (no duplicate status chip in meta). */
function invoicePaidOrDueRow(inv: Invoice): string {
  if (inv.status === 'paid') {
    const d = inv.updated_at ?? inv.invoice_date;
    const uk = formatIsoDateUk(d);
    const aria = `Paid on ${uk}`;
    return `<p class="invoice-card__paid invoice-card__paid--settled" aria-label="${escapeHtml(aria)}"><span class="invoice-card__tick" aria-hidden="true">✓</span><span class="invoice-card__paid-date">${escapeHtml(uk)}</span></p>`;
  }
  if (inv.status === 'partial') {
    const d = inv.updated_at ?? inv.invoice_date;
    return `<p class="invoice-card__paid invoice-card__paid--partial">${escapeHtml(`Partial · ${formatIsoDateUk(d)}`)}</p>`;
  }
  return `<p class="invoice-card__paid">${escapeHtml(`Due ${formatIsoDateUk(inv.due_date)}`)}</p>`;
}

function renderTile(invoice: Invoice, client: Client | null): string {
  const total = formatCurrency(invoice.total, invoice.currency);
  const clientName = client?.trading_name ?? invoice.client_id;
  const period = `${formatIsoDateUk(invoice.period_start)}–${formatIsoDateUk(invoice.period_end)}`;
  const pdfHref = `/api/invoices/${encodeURIComponent(invoice.id)}/pdf`;
  const pdfTitle =
    invoice.pdf_path === null
      ? 'Opens a PDF rebuilt from this invoice row (historical rows have no archived file).'
      : 'Open stored PDF';
  const statusChip =
    invoice.status === 'paid'
      ? ''
      : `<span class="badge badge--${invoice.status}">${escapeHtml(invoice.status)}</span>`;
  const mechShort = invoice.mechanism === 'self-bill' ? 'SB' : 'SI';
  const ledgerLine =
    invoice.id !== invoice.invoice_number
      ? `<p class="invoice-card__ledger">${escapeHtml(invoice.id)}</p>`
      : '';

  return `
    <article class="invoice-card">
      <div class="invoice-card__row invoice-card__row--top">
        <div class="invoice-card__id-block">
          <p class="invoice-card__number">${escapeHtml(invoice.invoice_number)}</p>
          ${ledgerLine}
        </div>
        <a class="btn btn-sm" href="${pdfHref}" target="_blank" rel="noopener" title="${escapeHtml(pdfTitle)}">PDF</a>
      </div>
      <p class="invoice-card__amount">${escapeHtml(total)}</p>
      ${invoicePaidOrDueRow(invoice)}
      <p class="invoice-card__meta">${[escapeHtml(period), escapeHtml(clientName), statusChip, escapeHtml(mechShort)].filter(Boolean).join(' · ')}</p>
    </article>
  `;
}

// ---------------------------------------------------------------------------
// Generate flow
// ---------------------------------------------------------------------------

function populateContractSelect(
  contracts: readonly Contract[],
  clients: readonly Client[],
): void {
  const select = getEl(GEN_CONTRACT_SELECT_ID);
  if (!(select instanceof HTMLSelectElement)) return;
  const clientById = new Map(clients.map(c => [c.id, c]));
  const supplier = contracts.filter(
    c => c.invoice_mechanism === 'supplier-issued',
  );
  const sorted = [...supplier].sort((a, b) => {
    if (a.active !== b.active) return a.active ? -1 : 1;
    if (a.end_date === null && b.end_date === null) return 0;
    if (a.end_date === null) return -1;
    if (b.end_date === null) return 1;
    return a.end_date >= b.end_date ? -1 : 1;
  });
  const options = [
    '<option value="">— Pick a contract —</option>',
    ...sorted.map(c => {
      const client = clientById.get(c.client_id);
      const inactive = c.active ? '' : ' · inactive';
      const label = `${client?.trading_name ?? c.client_id} · ${c.reference}${inactive}`;
      return `<option value="${escapeHtml(c.id)}">${escapeHtml(label)}</option>`;
    }),
  ];
  select.innerHTML = options.join('');
}

function openGenerateModal(): void {
  currentDraft = null;
  monthlyPreviewFingerprint = null;
  lastMonthlyPreview = null;
  clearGenerateError();
  clearPreviewGuidance();
  hideDraftFields();
  setGenerateSubmitDisabled(true);
  const form = getEl(GEN_FORM_ID);
  if (form instanceof HTMLFormElement) form.reset();
  setBillingMonthValue(defaultBillingPickerMonth(null));
  openModal(GEN_MODAL_ID);
}

export interface OpenSupplierInvoiceOptions {
  readonly billingMonth?: string;
}

/**
 * Switch to Invoices, load options, open Generate with `contract_id`
 * selected and the server draft applied (same as picking the contract
 * in the modal manually).
 *
 * @param billingMonth optional `YYYY-MM` for the billing-month control
 *        (defaults from contract end date when the engagement has ended).
 */
export async function openSupplierInvoiceForContract(
  contractId: string,
  options: OpenSupplierInvoiceOptions = {},
): Promise<void> {
  activateTabByName('invoices');
  await loadInvoices();
  currentDraft = null;
  monthlyPreviewFingerprint = null;
  lastMonthlyPreview = null;
  clearGenerateError();
  clearPreviewGuidance();
  hideDraftFields();
  setGenerateSubmitDisabled(true);
  const form = getEl(GEN_FORM_ID);
  if (form instanceof HTMLFormElement) form.reset();

  let billingMonth = options.billingMonth?.slice(0, 7);
  if (billingMonth === undefined || billingMonth.length !== 7) {
    const contractsRes = await getJson<ContractsListResponse>('/api/contracts');
    const c = contractsRes.contracts.find(x => x.id === contractId) ?? null;
    billingMonth = defaultBillingPickerMonth(c);
  }
  setBillingMonthValue(billingMonth);

  const select = getEl(GEN_CONTRACT_SELECT_ID);
  if (!(select instanceof HTMLSelectElement)) {
    openModal(GEN_MODAL_ID);
    return;
  }
  select.value = contractId;
  openModal(GEN_MODAL_ID);
  if (select.value !== contractId) {
    setGenerateError(
      'That contract is self-bill; use “Ingest self-bill PDFs” for agency invoices.',
    );
    return;
  }
  await onContractSelected(contractId);
}

/**
 * Switch to Invoices and open the self-bill ingest modal. `hintText` is
 * plain copy (set via `textContent`, safe for client names with odd chars).
 */
export function openSelfBillIngestWithHint(hintText: string): void {
  activateTabByName('invoices');
  void loadInvoices();
  clearIngestState();
  const form = getEl(INGEST_FORM_ID);
  if (form instanceof HTMLFormElement) form.reset();
  const hint = getEl(INGEST_CONTEXT_HINT_ID);
  if (hint !== null) {
    hint.textContent = hintText;
    hint.style.display = '';
  }
  openModal(INGEST_MODAL_ID);
}

function hideDraftFields(): void {
  const el = getEl(GEN_DRAFT_FIELDS_ID);
  if (el) el.style.display = 'none';
}

function showDraftFields(): void {
  const el = getEl(GEN_DRAFT_FIELDS_ID);
  if (el) el.style.display = '';
}

function setGenerateSubmitDisabled(disabled: boolean): void {
  const btn = getEl(GEN_SUBMIT_ID);
  if (btn instanceof HTMLButtonElement) btn.disabled = disabled;
}

function setGenerateError(message: string): void {
  const el = getEl(GEN_ERROR_ID);
  if (!el) return;
  el.textContent = message;
  el.style.display = '';
}

function clearGenerateError(): void {
  const el = getEl(GEN_ERROR_ID);
  if (!el) return;
  el.textContent = '';
  el.style.display = 'none';
}

async function onContractSelected(contractId: string): Promise<void> {
  monthlyPreviewFingerprint = null;
  lastMonthlyPreview = null;
  clearGenerateError();
  clearPreviewGuidance();
  hideDraftFields();
  setGenerateSubmitDisabled(true);
  currentDraft = null;
  if (contractId === '') return;

  try {
    const billingMonth = getBillingMonthValue();
    const preview = await fetchMonthlyInvoicePreview(contractId, billingMonth);
    lastMonthlyPreview = preview;
    monthlyPreviewFingerprint = preview.previewFingerprint;
    currentDraft = preview.invoice;
    populateDraftFields(preview.invoice);
    renderPreviewGuidanceFromServer(preview);
    showDraftFields();
    applyGenerateSubmitStateFromPreview();
  } catch (err) {
    setGenerateError(
      `Failed to build draft preview: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

function populateDraftFields(draft: Invoice): void {
  const form = getEl(GEN_FORM_ID);
  if (!(form instanceof HTMLFormElement)) return;
  const fd = form.elements;
  setInput(fd, 'id', draft.id);
  setInput(fd, 'invoice_date', draft.invoice_date);
  setInput(fd, 'period_start', draft.period_start);
  setInput(fd, 'period_end', draft.period_end);
  setInput(fd, 'days_billed', String(draft.days_billed));
  const rate = draft.subtotal / Math.max(draft.days_billed, 1);
  setInput(fd, 'day_rate_display', formatCurrency(rate, draft.currency));
  setInput(fd, 'subtotal_display', formatCurrency(draft.subtotal, draft.currency));
  setInput(fd, 'vat_display', formatCurrency(draft.vat_amount, draft.currency));
  setInput(fd, 'total_display', formatCurrency(draft.total, draft.currency));
  setInput(fd, 'due_date', draft.due_date);
  setInput(fd, 'description', draft.description);
}

function setInput(
  elements: HTMLFormControlsCollection,
  name: string,
  value: string,
): void {
  const el = elements.namedItem(name);
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    el.value = value;
  }
}

async function submitGenerate(ev: SubmitEvent): Promise<void> {
  ev.preventDefault();
  if (currentDraft === null || monthlyPreviewFingerprint === null) {
    setGenerateError('Draft preview missing — choose a contract and billing month.');
    return;
  }

  const form = getEl(GEN_FORM_ID);
  if (!(form instanceof HTMLFormElement)) return;

  const contractSelect = getEl(GEN_CONTRACT_SELECT_ID);
  const contractId =
    contractSelect instanceof HTMLSelectElement ? contractSelect.value.trim() : '';
  if (contractId === '') {
    setGenerateError('Pick a contract.');
    return;
  }

  const daysInput = form.elements.namedItem('days_billed');
  const descInput = form.elements.namedItem('description');
  const periodEndInput = form.elements.namedItem('period_end');
  const rawDays =
    daysInput instanceof HTMLInputElement ? Number(daysInput.value) : currentDraft.days_billed;
  const description =
    descInput instanceof HTMLTextAreaElement ? descInput.value : currentDraft.description;
  const periodEnd =
    periodEndInput instanceof HTMLInputElement ? periodEndInput.value : currentDraft.period_end;

  const daysInt = Number.isFinite(rawDays) ? Math.round(rawDays) : NaN;
  if (!Number.isInteger(daysInt) || daysInt <= 0) {
    setGenerateError('Days billed must be a positive whole number.');
    return;
  }

  const chk = getEl(GEN_ALLOW_OUTSIDE_GAP_ID);
  const allowOutsideGapList = chk instanceof HTMLInputElement && chk.checked;

  const payload = {
    contract_id: contractId,
    billing_month: getBillingMonthValue(),
    previewFingerprint: monthlyPreviewFingerprint,
    allowOutsideGapList,
    days_billed: daysInt,
    description,
    period_end: periodEnd,
  };

  setGenerateSubmitDisabled(true);
  try {
    const res = await fetch('/api/invoices/monthly/commit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const text = await res.text();
    if (!res.ok) {
      setGenerateError(extractErrorLine(text, res.status));
      return;
    }

    let raw: unknown;
    try {
      raw = JSON.parse(text) as unknown;
    } catch {
      setGenerateError('Malformed JSON after commit.');
      return;
    }
    if (
      typeof raw !== 'object'
      || raw === null
      || typeof (raw as { invoice?: unknown }).invoice !== 'object'
      || (raw as { invoice: unknown }).invoice === null
      || typeof (raw as { invoice: { id?: unknown } }).invoice.id !== 'string'
    ) {
      setGenerateError('Commit succeeded but invoice payload was unexpected.');
      return;
    }

    const issuedId = (raw as { invoice: { id: string } }).invoice.id;
    closeModal(GEN_MODAL_ID);
    window.open(`/api/invoices/${encodeURIComponent(issuedId)}/pdf`, '_blank');
    await loadInvoices();
  } finally {
    applyGenerateSubmitStateFromPreview();
  }
}

// ---------------------------------------------------------------------------
// Ingest flow
// ---------------------------------------------------------------------------

function openIngestModal(): void {
  clearIngestState();
  const form = getEl(INGEST_FORM_ID);
  if (form instanceof HTMLFormElement) form.reset();
  openModal(INGEST_MODAL_ID);
}

function clearIngestState(): void {
  const hint = getEl(INGEST_CONTEXT_HINT_ID);
  if (hint !== null) {
    hint.textContent = '';
    hint.style.display = 'none';
  }
  const err = getEl(INGEST_ERROR_ID);
  if (err) {
    err.textContent = '';
    err.style.display = 'none';
  }
  const result = getEl(INGEST_RESULT_ID);
  if (result) {
    result.textContent = '';
    result.style.display = 'none';
  }
}

function setIngestError(message: string): void {
  const el = getEl(INGEST_ERROR_ID);
  if (!el) return;
  el.textContent = message;
  el.style.display = '';
}

function setIngestResult(message: string): void {
  const el = getEl(INGEST_RESULT_ID);
  if (!el) return;
  el.textContent = message;
  el.style.display = '';
}

function setIngestSubmitDisabled(disabled: boolean): void {
  const btn = getEl(INGEST_SUBMIT_ID);
  if (btn instanceof HTMLButtonElement) btn.disabled = disabled;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isPdfFile(file: File): boolean {
  return file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
}

interface IngestOneSuccess {
  readonly supplierInvoiceNumber: string;
  readonly invoiceId: string;
  readonly total: number;
  readonly currency: CurrencyCode;
}

function narrowCurrency(value: string): CurrencyCode {
  return value === 'AED' ? 'AED' : 'GBP';
}

function parseIngestSuccessBody(raw: unknown): IngestOneSuccess | null {
  if (!isRecord(raw)) return null;
  const inv = raw.invoice;
  const parsed = raw.parsed;
  if (!isRecord(inv) || !isRecord(parsed)) return null;
  if (typeof inv.id !== 'string' || typeof inv.currency !== 'string') return null;
  if (typeof parsed.supplierInvoiceNumber !== 'string' || typeof parsed.total !== 'number') {
    return null;
  }
  return {
    supplierInvoiceNumber: parsed.supplierInvoiceNumber,
    invoiceId: inv.id,
    total: parsed.total,
    currency: narrowCurrency(inv.currency),
  };
}

async function readIngestFailureMessage(res: Response): Promise<string> {
  const raw: unknown = await res.json().catch(() => null);
  if (isRecord(raw) && typeof raw.error === 'string') return raw.error;
  return `Failed (${res.status})`;
}

async function readDuplicateIngestMessage(res: Response): Promise<string> {
  const raw: unknown = await res.json().catch(() => null);
  let suffix = '';
  if (isRecord(raw) && isRecord(raw.detail)) {
    const id = raw.detail.existingInvoiceId;
    if (typeof id === 'string') suffix = ` as ${id}`;
  }
  return `Already ingested${suffix}.`;
}

async function ingestOneSelfBillPdf(
  file: File,
): Promise<{ ok: true; summary: IngestOneSuccess } | { ok: false; message: string }> {
  const data = new FormData();
  data.append('pdf', file);
  const res = await fetch('/api/invoices/ingest-self-bill', {
    method: 'POST',
    body: data,
  });
  if (res.status === 409) {
    return { ok: false, message: await readDuplicateIngestMessage(res) };
  }
  if (!res.ok) {
    return { ok: false, message: await readIngestFailureMessage(res) };
  }
  const raw: unknown = await res.json();
  const summary = parseIngestSuccessBody(raw);
  if (summary === null) {
    return { ok: false, message: 'Unexpected response from server.' };
  }
  return { ok: true, summary };
}

async function submitIngest(ev: SubmitEvent): Promise<void> {
  ev.preventDefault();
  clearIngestState();

  const form = getEl(INGEST_FORM_ID);
  if (!(form instanceof HTMLFormElement)) return;

  const fileInput = form.elements.namedItem('pdf');
  if (!(fileInput instanceof HTMLInputElement) || fileInput.files === null) {
    setIngestError('Please select at least one PDF.');
    return;
  }

  const files = Array.from(fileInput.files);
  if (files.length === 0) {
    setIngestError('Please select at least one PDF.');
    return;
  }

  const nonPdf = files.filter(f => !isPdfFile(f));
  if (nonPdf.length > 0) {
    setIngestError(
      nonPdf.length === files.length
        ? 'Every selected file must be a PDF.'
        : `Some files are not PDFs (${nonPdf.length} of ${files.length}). Remove them or choose only PDFs.`,
    );
    return;
  }

  setIngestSubmitDisabled(true);
  const okLines: string[] = [];
  const errParts: string[] = [];

  try {
    for (const file of files) {
      const outcome = await ingestOneSelfBillPdf(file);
      if (outcome.ok) {
        const s = outcome.summary;
        okLines.push(
          `${s.supplierInvoiceNumber} → ${s.invoiceId} (${formatCurrency(s.total, s.currency)})`,
        );
      } else {
        errParts.push(`${file.name}: ${outcome.message}`);
      }
    }

    if (okLines.length > 0) {
      setIngestResult(
        okLines.length === 1
          ? `Ingested ${okLines[0]}.`
          : `Ingested ${okLines.length} files: ${okLines.join('; ')}.`,
      );
      await loadInvoices();
    }
    if (errParts.length > 0) {
      setIngestError(errParts.join(' '));
    }
  } catch (err) {
    setIngestError(err instanceof Error ? err.message : String(err));
  } finally {
    setIngestSubmitDisabled(false);
  }
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

export function initInvoices(): void {
  getEl(GEN_BTN_ID)?.addEventListener('click', () => openGenerateModal());
  getEl(INGEST_BTN_ID)?.addEventListener('click', () => openIngestModal());
  getEl(GEN_MODAL_CLOSE_ID)?.addEventListener('click', () => closeModal(GEN_MODAL_ID));
  getEl(GEN_MODAL_CANCEL_ID)?.addEventListener('click', () => closeModal(GEN_MODAL_ID));
  getEl(INGEST_MODAL_CLOSE_ID)?.addEventListener('click', () => closeModal(INGEST_MODAL_ID));
  getEl(INGEST_MODAL_CANCEL_ID)?.addEventListener('click', () => closeModal(INGEST_MODAL_ID));

  const contractSelect = getEl(GEN_CONTRACT_SELECT_ID);
  contractSelect?.addEventListener('change', ev => {
    const target = ev.target;
    if (target instanceof HTMLSelectElement) void onContractSelected(target.value);
  });

  getEl(GEN_BILLING_MONTH_ID)?.addEventListener('change', () => {
    const select = getEl(GEN_CONTRACT_SELECT_ID);
    if (select instanceof HTMLSelectElement && select.value !== '') {
      void onContractSelected(select.value);
    }
  });

  getEl(GEN_ALLOW_OUTSIDE_GAP_ID)?.addEventListener('change', () => {
    applyGenerateSubmitStateFromPreview();
  });

  const genForm = getEl(GEN_FORM_ID);
  genForm?.addEventListener('submit', ev => {
    if (ev instanceof SubmitEvent) void submitGenerate(ev);
  });

  const ingestForm = getEl(INGEST_FORM_ID);
  ingestForm?.addEventListener('submit', ev => {
    if (ev instanceof SubmitEvent) void submitIngest(ev);
  });

  // Unused import guard so status container ref isn't tree-shaken.
  getEl(STATUS_ID);
}
