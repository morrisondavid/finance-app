/**
 * Contracts tab — tiled layout over the Contracts API.
 *
 * Responsibilities (unchanged from first cut; shape is what changed):
 *   - `initContracts()` — one-time DOM binding.
 *   - `loadContracts()` — parallel fetch of contracts + clients +
 *     aggregate accrual, then a single render pass.
 *   - Per-tile leave drawer — expanded in place under the stats.
 *   - Record Leave modal — scope selector, date range, editable email
 *     preview per selected contract, copy-to-clipboard handoff.
 *
 * Nothing in this file sends email. The preview is a copy-paste aid
 * whose text is seeded from the server-rendered template and can be
 * tweaked in-place; the primary action (`Holiday`) only writes
 * leave rows into `working-days/leave.csv`.
 */

import { escapeHtml, openModal, closeModal } from '../utils/dom';
import { formatCurrency, formatIsoDateUk, formatIsoDateUkLong } from '../utils/formatting';
import { daysBetween, todayIsoLocal } from '../../../shared/iso-date.js';
import type {
  AccrualResponse,
  AggregateAccrualResponse,
  Client,
  Company,
  Contract,
  CurrencyCode,
  EntityId,
  ExpensesSheetResponse,
  LeaveRequest,
  LeaveRow,
  LeaveType,
  SupplierMonthGap,
  SupplierMonthGapsResponse,
  TemplatePreviewRequest,
  TemplatePreviewResponse,
} from '../../../shared/api-contracts.js';
import { openSelfBillIngestWithHint, openSupplierInvoiceForContract } from './invoices.js';
import { initLeaveCalendar, updateLeaveCalendarContracts } from './leave-calendar.js';

const LIST_ID = 'contracts-list';
const LIST_DIVIDER_ID = 'contracts-list-divider';
const BANNER_ID = 'contracts-aggregate-banner';
const GAPS_BANNER_ID = 'contracts-invoice-gaps-banner';
const MODAL_ID = 'contracts-leave-modal';
const SCOPE_ID = 'contracts-leave-scope';
const PREVIEWS_ID = 'contracts-leave-previews';
const FORM_ID = 'contracts-leave-form';
const MODAL_TITLE_ID = 'contracts-leave-modal-title';
const BOOK_ALL_BTN_ID = 'contracts-book-all-btn';
const MODAL_CLOSE_ID = 'contracts-leave-modal-close';
const MODAL_CANCEL_ID = 'contracts-leave-modal-cancel';

const AGENCY_MODAL_ID = 'contracts-agency-modal';
const AGENCY_MODAL_TITLE_ID = 'contracts-agency-modal-title';
const AGENCY_MODAL_BODY_ID = 'contracts-agency-modal-body';
const AGENCY_MODAL_CLOSE_ID = 'contracts-agency-modal-close';

const RENEW_MODAL_ID = 'contracts-renew-modal';
const RENEW_MODAL_TITLE_ID = 'contracts-renew-modal-title';
const RENEW_FORM_ID = 'contracts-renew-form';
const RENEW_MODAL_CLOSE_ID = 'contracts-renew-modal-close';
const RENEW_MODAL_CANCEL_ID = 'contracts-renew-modal-cancel';

let contracts: Contract[] = [];
let clientsById: Map<string, Client> = new Map();
let companiesById: Map<EntityId, Company> = new Map();
let aggregate: AggregateAccrualResponse | null = null;
let perContract: Map<string, AccrualResponse> = new Map();
let openDrawerIds: Set<string> = new Set();
let leaveByContract: Map<string, LeaveRow[]> = new Map();
let previewDebounce: ReturnType<typeof setTimeout> | null = null;
/**
 * Total fixed monthly outgoings across every account — the same headline
 * number the Fixed Expenses tab shows under "spend". Sourced from
 * `/api/expenses/overview` (`summary.totalMonthlyOutgoings`, which is
 * defined as identical to `insight.totalFixedMonthlyExpenses` in
 * `shared/expenses-insight.ts`). Used by the combined hero tile as the
 * threshold for the "does retained income cover the bills?" visual cue.
 * `null` when the fetch failed or hasn't run — the hero tile falls back
 * to the neutral blue style when the threshold is unknown.
 */
let fixedMonthlyExpenses: number | null = null;
/** Monthly supplier-issued gaps from `GET /api/invoices/supplier-month-gaps`. */
let supplierMonthGaps: readonly SupplierMonthGap[] = [];
let leaveCalendarInitialised = false;

function getEl(id: string): HTMLElement | null {
  return document.getElementById(id);
}

// ---------------------------------------------------------------------------
// Display helpers
// ---------------------------------------------------------------------------

/**
 * Tile headline = end-client name. For agency contracts, the agency
 * itself is "silent metadata" that sits on a secondary line as a
 * clickable pill (see `agencyMetaHtml`). For direct contracts, the
 * client is the end client.
 */
function endClientNameFor(contract: Contract): string {
  const client = clientsById.get(contract.client_id);
  if (client === undefined) return contract.id;
  if (client.kind === 'agency') return client.end_client_legal_name;
  return client.trading_name;
}

/** Short identifier used in modal titles / preview headings. */
function displayNameFor(contract: Contract): string {
  return endClientNameFor(contract);
}

function cadenceLabel(contract: Contract): string {
  return contract.invoice_cadence === 'weekly' ? 'Weekly invoicing' : 'Monthly invoicing';
}

function clientKindLabel(contract: Contract): string {
  const client = clientsById.get(contract.client_id);
  if (client === undefined) return '';
  return client.kind === 'agency' ? 'Agency' : 'Direct';
}

function contractDateRange(contract: Contract): string {
  const end = formatIsoDateUkLong(contract.end_date);
  return `${formatIsoDateUkLong(contract.start_date)} → ${end}`;
}

/**
 * Hover text for the "Worked / Leave since last payment" stats.
 *
 * Renders the owed window as a human-readable date range so the user
 * can see exactly what days feed the figure without having to mentally
 * reconstruct "since last payment". When owed_window_start coincides
 * with period_start, we're in the fallback case (no matched payment
 * yet) — call that out explicitly so the user knows the number isn't
 * anchored to a specific invoice.
 */
function owedWindowTooltip(accrual: AccrualResponse): string {
  const start = formatIsoDateUkLong(accrual.owed_window_start);
  const end = formatIsoDateUkLong(accrual.owed_window_end);
  const anchoredToMonthStart = accrual.owed_window_start === accrual.period_start;
  const suffix = anchoredToMonthStart
    ? ' (no matched payment — counting from the start of this month)'
    : '';
  return `${start} – ${end}${suffix}`;
}

/** A contract is "ended" once its end_date is strictly before today. */
export function isEnded(contract: Contract, today: string = todayIsoLocal()): boolean {
  return contract.end_date < today;
}

/**
 * Whole days from `today` to the contract's end_date. Positive for
 * future expiries, zero on the day itself, negative if already past.
 */
export function daysUntilEnd(
  contract: Pick<Contract, 'end_date'>,
  today: string = todayIsoLocal(),
): number {
  return daysBetween(contract.end_date, today);
}

/**
 * Partition contracts into `active` vs `ended` by end_date-before-today.
 * The boundary is strict: a contract ending exactly on `today` is still
 * active, matching {@link isEnded}.
 */
export function partitionContracts(
  all: readonly Contract[],
  today: string = todayIsoLocal(),
): { active: Contract[]; ended: Contract[] } {
  const active: Contract[] = [];
  const ended: Contract[] = [];
  for (const c of all) {
    if (isEnded(c, today)) ended.push(c);
    else active.push(c);
  }
  return { active, ended };
}

/**
 * A contract flags a missing-email warning on its tile when its
 * end-client primary contact email is still `TBC` (or empty). This is
 * the data that blocks the `leave` / `sickness` / `invoice-cover`
 * template previews from rendering, so surfacing it on the tile means
 * the user sees the cause before they open the modal.
 */
function missingEndClientEmail(contract: Contract): boolean {
  const client = clientsById.get(contract.client_id);
  if (client === undefined) return false;
  if (client.kind !== 'agency') return false;
  return client.end_client_primary_contact_email === 'TBC';
}

// ---------------------------------------------------------------------------
// Fetch helpers
// ---------------------------------------------------------------------------

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GET ${url} failed: ${res.status}`);
  return (await res.json()) as T;
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`POST ${url} failed (${res.status}): ${errorText}`);
  }
  return (await res.json()) as T;
}

async function deleteJson(url: string): Promise<void> {
  const res = await fetch(url, { method: 'DELETE' });
  if (!res.ok) {
    throw new Error(`DELETE ${url} failed: ${res.status}`);
  }
}

// ---------------------------------------------------------------------------
// Rendering — aggregate banner + tile grid
// ---------------------------------------------------------------------------

/**
 * Map `Company.jurisdiction` onto an ISO 3166-1 alpha-2 country code
 * suitable for the `flag-icons` CSS sprite (`fi-<code>`). Centralised
 * so adding a new jurisdiction is a one-file change and the compiler
 * flags any missed mapping.
 *
 * Returns `null` when the jurisdiction isn't something we have a flag
 * for, so the caller can omit the flag cleanly rather than render a
 * broken "missing sprite" box.
 */
function jurisdictionFlagCode(jurisdiction: Company['jurisdiction']): string | null {
  switch (jurisdiction) {
    case 'UK':
      return 'gb';
    case 'UAE':
      return 'ae';
    default:
      return null;
  }
}

/**
 * Small flag badge rendered in the top-right of each entity rollup
 * tile. Pure CSS sprite from the `flag-icons` package — no <img>, no
 * JS runtime. `aria-label` keeps it announced for screen readers; the
 * sprite itself is decorative.
 */
function jurisdictionFlagHtml(company: Company): string {
  const code = jurisdictionFlagCode(company.jurisdiction);
  if (code === null) return '';
  return `<span
    class="fi fi-${code} contracts-aggregate-tile__flag"
    role="img"
    aria-label="${escapeHtml(company.jurisdiction)} jurisdiction"
    title="${escapeHtml(company.jurisdiction)}"
  ></span>`;
}

/**
 * Jurisdiction label for the aggregate tile subtitle. Short, matches
 * the `UK · Ltd` / `UAE · FZCO` mental model the user carries.
 */
function entitySubtitle(company: Company, contractCount: number): string {
  const jurisdiction = company.jurisdiction;
  const kind = company.kind === 'ltd' ? 'Ltd' : 'FZCO';
  const noun = contractCount === 1 ? 'contract' : 'contracts';
  return `${jurisdiction} · ${kind} · ${contractCount} ${noun}`;
}

/**
 * Headline for the aggregate tile. Prefers the company's
 * `trading_name` (what users actually call the entity); falls back to
 * the raw entity id only when the company registry lookup misses —
 * which in a healthy system means a contract references a deleted
 * entity, and the registry gate tests should be shouting before we
 * ever hit this branch.
 */
function entityHeadline(entityId: EntityId, company: Company | undefined): string {
  return company ? company.trading_name : entityId;
}

/**
 * One row of the stacked "claims" list (Incoming / VAT / CT). Centralised
 * so the combined hero tile and each per-entity tile share the exact
 * same markup — which is what guarantees the "Incoming" row lines up
 * vertically across every tile in the grid.
 *
 * `amount` is already formatted (so callers can choose whether to
 * prefix with "−"); `placeholder = true` hides the amount and renders
 * a muted em-dash in the slot, preserving height without implying a
 * real zero.
 */
function claimRowHtml(args: {
  modifier: 'incoming' | 'vat' | 'ct';
  label: string;
  amount: string;
  note: string;
  placeholder?: boolean;
}): string {
  const { modifier, label, amount, note, placeholder = false } = args;
  const classes = [
    'contracts-aggregate-tile__claim',
    `contracts-aggregate-tile__claim--${modifier}`,
    placeholder ? 'contracts-aggregate-tile__claim--placeholder' : '',
  ]
    .filter(Boolean)
    .join(' ');
  return `<div class="${classes}">
    <span class="contracts-aggregate-tile__claim-label">${escapeHtml(label)}</span>
    <span class="contracts-aggregate-tile__claim-amount">${placeholder ? '—' : amount}</span>
    <span class="contracts-aggregate-tile__claim-note">${escapeHtml(note)}</span>
  </div>`;
}

/**
 * Three fixed slots — Incoming, VAT, CT — so every tile has the same
 * number of rows and the Incoming line sits at the same offset
 * regardless of whether VAT/CT apply.
 */
function claimsBlockHtml(entry: {
  currency: CurrencyCode;
  projected_period_total: number;
  incoming_period_total: number;
  vat_reserve_period: number;
  ct_reserve_period: number;
}): string {
  const ctPercent = Math.round(
    (entry.ct_reserve_period / Math.max(entry.projected_period_total, 1e-9)) * 100,
  );
  const rows = [
    claimRowHtml({
      modifier: 'incoming',
      label: 'Incoming',
      amount: formatCurrency(entry.incoming_period_total, entry.currency),
      note: 'hits the account',
    }),
    entry.vat_reserve_period > 0
      ? claimRowHtml({
          modifier: 'vat',
          label: 'VAT',
          amount: `−${formatCurrency(entry.vat_reserve_period, entry.currency)}`,
          note: 'to HMRC',
        })
      : claimRowHtml({
          modifier: 'vat',
          label: 'VAT',
          amount: '',
          note: 'not registered',
          placeholder: true,
        }),
    entry.ct_reserve_period > 0
      ? claimRowHtml({
          modifier: 'ct',
          label: 'CT reserve',
          amount: `−${formatCurrency(entry.ct_reserve_period, entry.currency)}`,
          note: `(${ctPercent}%)`,
        })
      : claimRowHtml({
          modifier: 'ct',
          label: 'CT reserve',
          amount: '',
          note: 'QFZP qualifying',
          placeholder: true,
        }),
  ];
  return `<div class="contracts-aggregate-tile__claims">${rows.join('')}</div>`;
}

/**
 * Compose the "covers / short of fixed expenses" verdict line for the
 * combined hero tile. Returns the HTML snippet plus a modifier class
 * so the tile can restyle itself green (surplus) or red (shortfall).
 *
 * - `retained >= expenses` → `--positive` ("covers £X of fixed expenses,
 *   £Y left over").
 * - `retained <  expenses` → `--negative` ("£Y short of covering £X
 *   fixed expenses this month").
 * - `expenses === null`    → `--neutral` (fetch failed; no verdict —
 *   we stay silent rather than guess).
 *
 * The threshold deliberately ignores fixed *income* per the user's
 * mental model: "if retained contracting income alone clears the
 * monthly bills, that's a dopamine hit". Passive / salary / rental
 * income on top is a bonus, not what gates the green state.
 */
function retainedVerdict(
  retained: number,
  currency: CurrencyCode,
  expenses: number | null,
): { modifier: 'positive' | 'negative' | 'neutral'; html: string } {
  if (expenses === null) {
    return { modifier: 'neutral', html: '' };
  }
  const expensesLabel = formatCurrency(expenses, currency);
  if (retained >= expenses) {
    const surplus = formatCurrency(retained - expenses, currency);
    return {
      modifier: 'positive',
      html: `<div class="contracts-aggregate-tile__verdict">
        <span class="contracts-aggregate-tile__verdict-icon" aria-hidden="true">✓</span>
        Covers ${expensesLabel} of fixed monthly expenses —
        <strong>${surplus}</strong> left over.
      </div>`,
    };
  }
  const shortfall = formatCurrency(expenses - retained, currency);
  return {
    modifier: 'negative',
    html: `<div class="contracts-aggregate-tile__verdict">
      <span class="contracts-aggregate-tile__verdict-icon" aria-hidden="true">!</span>
      <strong>${shortfall}</strong> short of covering ${expensesLabel} fixed
      monthly expenses this month.
    </div>`,
  };
}

/**
 * Hero tile — the headline "retained across everything this month"
 * number. Spans the full grid width. Only emitted when `totals` is
 * non-null (i.e. every entity shares a currency; FX conversion for
 * mixed-currency totals is deferred to Roadmap 3.2).
 *
 * When `fixedMonthlyExpenses` is known, the tile flips between a
 * green "covers your bills" state and a red "short of your bills"
 * state — the dopamine hit / warning the user asked for.
 */
function combinedTileHtml(
  totals: NonNullable<AggregateAccrualResponse['totals']>,
  expenses: number | null,
): string {
  const retained = formatCurrency(totals.retained_period, totals.currency);
  const accrued = formatCurrency(totals.accrued_to_date, totals.currency);
  const entityNoun = totals.entity_count === 1 ? 'entity' : 'entities';
  const contractNoun = totals.contract_count === 1 ? 'contract' : 'contracts';
  const verdict = retainedVerdict(totals.retained_period, totals.currency, expenses);
  const classes = [
    'contracts-aggregate-tile',
    'contracts-aggregate-tile--combined',
    `contracts-aggregate-tile--${verdict.modifier}`,
  ].join(' ');
  return `<div class="${classes}">
    <div class="contracts-aggregate-tile__head">
      <div class="contracts-aggregate-tile__trading-name">This month, retained after tax</div>
      <div class="contracts-aggregate-tile__subtitle">
        across ${totals.entity_count} ${entityNoun} · ${totals.contract_count} ${contractNoun}
      </div>
    </div>
    <div class="contracts-aggregate-tile__retained contracts-aggregate-tile__retained--hero">
      <div class="contracts-aggregate-tile__retained-amount">${retained}</div>
      <div class="contracts-aggregate-tile__retained-note">
        Yours to keep — VAT and CT reserved separately.
      </div>
    </div>
    ${verdict.html}
    <div class="contracts-aggregate-tile__divider"></div>
    ${claimsBlockHtml(totals)}
    <div class="contracts-aggregate-tile__sub">accrued ${accrued}</div>
  </div>`;
}

function entityTileHtml(entry: AggregateAccrualResponse['entities'][number]): string {
  const company = companiesById.get(entry.issuing_entity_id);
  const headline = entityHeadline(entry.issuing_entity_id, company);
  const subtitle = company ? entitySubtitle(company, entry.contract_count) : '';
  const flag = company ? jurisdictionFlagHtml(company) : '';
  const retained = formatCurrency(entry.retained_period, entry.currency);
  const accrued = formatCurrency(entry.accrued_to_date, entry.currency);

  return `<div class="contracts-aggregate-tile">
    ${flag}
    <div class="contracts-aggregate-tile__head">
      <div class="contracts-aggregate-tile__trading-name">${escapeHtml(headline)}</div>
      ${
        subtitle
          ? `<div class="contracts-aggregate-tile__subtitle">${escapeHtml(subtitle)}</div>`
          : ''
      }
    </div>
    ${claimsBlockHtml(entry)}
    <div class="contracts-aggregate-tile__divider"></div>
    <div class="contracts-aggregate-tile__retained">
      <div class="contracts-aggregate-tile__retained-label">Retained</div>
      <div class="contracts-aggregate-tile__retained-amount">${retained}</div>
      <div class="contracts-aggregate-tile__retained-note">
        Yours to keep — VAT and CT reserved separately.
      </div>
    </div>
    <div class="contracts-aggregate-tile__sub">accrued ${accrued}</div>
  </div>`;
}

function renderInvoiceGapsBanner(): void {
  const el = getEl(GAPS_BANNER_ID);
  if (el === null) return;
  if (supplierMonthGaps.length === 0) {
    el.innerHTML = '';
    el.hidden = true;
    return;
  }
  el.hidden = false;
  const items = supplierMonthGaps.map(g => {
    const client = clientsById.get(g.client_id);
    const contract = contracts.find(c => c.id === g.contract_id);
    const name = escapeHtml(client?.trading_name ?? g.client_id);
    const ref = escapeHtml(contract?.reference ?? g.contract_id);
    const monthUk = escapeHtml(formatIsoDateUk(g.month_start));
    const bm = escapeHtml(g.month_start.slice(0, 7));
    const cid = escapeHtml(g.contract_id);
    return `<li class="contracts-invoice-gaps-banner__item">
      <span class="contracts-invoice-gaps-banner__copy"><strong>${name}</strong> · ${ref} — no supplier invoice for ${monthUk}</span>
      <button type="button" class="btn btn-sm" data-role="invoice-gap" data-contract-id="${cid}" data-billing-month="${bm}">Generate…</button>
    </li>`;
  }).join('');
  el.innerHTML = `<div class="contracts-invoice-gaps-banner__inner">
    <p class="contracts-invoice-gaps-banner__title">Missing invoices (monthly supplier-issued)</p>
    <ul class="contracts-invoice-gaps-banner__list">${items}</ul>
  </div>`;
}

function renderAggregateBanner(): void {
  const el = getEl(BANNER_ID);
  if (!el) return;
  if (aggregate === null || aggregate.entities.length === 0) {
    el.innerHTML = '';
    return;
  }
  const combined =
    aggregate.totals !== null
      ? combinedTileHtml(aggregate.totals, fixedMonthlyExpenses)
      : '';
  const entities = aggregate.entities.map(entityTileHtml).join('');
  el.innerHTML = combined + entities;
}

/**
 * Agency metadata line: shows "via <agency>" as a clickable pill that
 * opens a detail popover. For direct contracts, returns empty string.
 */
function agencyMetaHtml(contract: Contract): string {
  const client = clientsById.get(contract.client_id);
  if (client === undefined || client.kind !== 'agency') return '';
  return `<button
    type="button"
    class="contracts-agency-pill"
    data-role="agency"
    data-contract-id="${escapeHtml(contract.id)}"
    title="${escapeHtml(`Via ${client.trading_name} — click for contact details`)}"
  >
    via ${escapeHtml(client.trading_name)}
  </button>`;
}

/**
 * Compose the "Ends in Nd" badge for contracts inside their renewal
 * warning window. Returns empty string for contracts that are already
 * ended, open-ended, or still outside the window.
 *
 * Severity split matches the `contract-ending-soon` warning-tab rules:
 * ≤14 days = red (critical), otherwise = amber (warn).
 */
function endingSoonBadgeHtml(contract: Contract, today: string): string {
  if (isEnded(contract, today)) return '';
  const daysLeft = daysUntilEnd(contract, today);
  if (daysLeft > contract.renewal_warning_days) return '';
  const className = daysLeft <= 14
    ? 'contracts-badge--ending-critical'
    : 'contracts-badge--ending-warn';
  return `<span class="contracts-badge ${className}">Ends in ${daysLeft}d</span>`;
}

function renderTile(contract: Contract): string {
  const accrual = perContract.get(contract.id);
  const currency = accrual?.currency ?? contract.day_rate_currency;
  const worked = accrual ? String(accrual.worked_days_to_date) : '—';
  const accrued = accrual
    ? formatCurrency(accrual.accrued_to_date, currency)
    : '—';
  const projected = accrual
    ? formatCurrency(accrual.projected_period_total, currency)
    : '—';
  const leaveInPeriod = accrual ? accrual.leave_days_in_period : 0;
  const isOpen = openDrawerIds.has(contract.id);
  const drawerHtml = isOpen ? renderDrawer(contract.id) : '';
  const id = escapeHtml(contract.id);
  const today = todayIsoLocal();
  const kindLabel = clientKindLabel(contract);
  const kindBadgeClass = kindLabel === 'Agency' ? 'contracts-badge--agency' : 'contracts-badge--direct';
  const agencyMeta = agencyMetaHtml(contract);
  const ended = isEnded(contract, today);
  const missingEmail = missingEndClientEmail(contract);
  const warningIcon = missingEmail
    ? `<span
        class="contracts-warning-icon"
        title="End-client primary contact email is missing in clients/clients.csv — template previews can't render until you fill it in."
        aria-label="Missing end-client primary contact email"
      >!</span>`
    : '';
  const endedBadge = ended
    ? `<span class="contracts-badge contracts-badge--ended">Ended</span>`
    : '';
  const endingBadge = endingSoonBadgeHtml(contract, today);
  const tileClasses = [
    'contracts-tile',
    ended ? 'is-ended' : '',
  ]
    .filter(Boolean)
    .join(' ');

  const totalValue =
    accrual?.total_contract_value != null
      ? formatCurrency(accrual.total_contract_value, currency)
      : null;
  const totalDays =
    accrual?.total_contract_working_days != null
      ? accrual.total_contract_working_days
      : null;

  return `<article
    class="${tileClasses}"
    data-contract-id="${id}"
  >
    <header class="contracts-tile__head">
      <h3 class="contracts-tile__title">${escapeHtml(endClientNameFor(contract))}${warningIcon}</h3>
      <div class="contracts-tile__meta">
        ${agencyMeta}
        ${kindLabel ? `<span class="contracts-badge ${kindBadgeClass}">${kindLabel}</span>` : ''}
        <span class="contracts-badge contracts-badge--cadence">${cadenceLabel(contract)}</span>
        ${endingBadge}
        ${endedBadge}
      </div>
      <div class="contracts-tile__subtitle">${escapeHtml(contractDateRange(contract))}</div>
    </header>

    <div class="contracts-tile__stats">
      <div>
        <div class="contracts-stat__label">Day rate</div>
        <div class="contracts-stat__value">${formatCurrency(contract.day_rate, contract.day_rate_currency)}</div>
      </div>
      <div${accrual ? ` title="${escapeHtml(owedWindowTooltip(accrual))}"` : ''}>
        <div class="contracts-stat__label">Worked since last payment</div>
        <div class="contracts-stat__value">${worked} d</div>
      </div>
      <div${accrual ? ` title="${escapeHtml(owedWindowTooltip(accrual))}"` : ''}>
        <div class="contracts-stat__label">Leave since last payment</div>
        <div class="contracts-stat__value">${leaveInPeriod} d</div>
      </div>
      <div class="contracts-stat--income">
        <div class="contracts-stat__label">Accrued</div>
        <div class="contracts-stat__value">${accrued}</div>
      </div>
      <div class="contracts-stat--income">
        <div class="contracts-stat__label">Projected this month</div>
        <div class="contracts-stat__value">${projected}</div>
      </div>
      ${totalValue !== null ? `<div class="contracts-stat--income" title="Total working days: ${totalDays}d across the full contract window (start to end, excl. weekends &amp; bank holidays)">
        <div class="contracts-stat__label">Total contract value</div>
        <div class="contracts-stat__value">${escapeHtml(totalValue)}</div>
      </div>` : ''}
      <div>
        <div class="contracts-stat__label">Mechanism</div>
        <div class="contracts-stat__value">${escapeHtml(contract.invoice_mechanism.replace(/-/g, ' '))}</div>
      </div>
    </div>

    <footer class="contracts-tile__footer">
      <div class="contracts-tile__footer-actions">
        <button type="button" class="btn btn-ghost" data-role="download" data-contract-id="${id}">Contract</button>
        ${!ended
          ? `<button type="button" class="btn btn-ghost" data-role="renew" data-contract-id="${id}">Renew</button>`
          : ''}
        ${contract.invoice_mechanism === 'supplier-issued'
          ? `<button type="button" class="btn btn-ghost" data-role="invoice" data-contract-id="${id}" data-invoice-mechanism="${escapeHtml(contract.invoice_mechanism)}">Invoice</button>`
          : ''}
        ${!ended
          ? `<button type="button" class="btn btn-primary" data-role="book" data-contract-id="${id}">Holiday</button>`
          : ''}
      </div>
      <button type="button" class="contracts-link-button" data-role="toggle" data-contract-id="${id}">
        ${isOpen ? 'Hide leave log' : 'Show leave log'}
      </button>
    </footer>

    ${drawerHtml}
  </article>`;
}

function renderDrawer(contractId: string): string {
  const rows = leaveByContract.get(contractId);
  if (rows === undefined) {
    return `<div class="contracts-tile__drawer" data-role="drawer">
      <div class="contracts-leave-empty">Loading leave log…</div>
    </div>`;
  }
  if (rows.length === 0) {
    return `<div class="contracts-tile__drawer" data-role="drawer">
      <div class="contracts-leave-empty">No leave recorded.</div>
    </div>`;
  }
  const today = todayIsoLocal();
  const items = rows
    .map(row => {
      const canRemove = row.date >= today;
      const remove = canRemove
        ? `<button type="button" class="contracts-leave-row__remove" data-role="remove" data-contract-id="${escapeHtml(contractId)}" data-leave-id="${escapeHtml(row.id)}">Remove</button>`
        : '<span></span>';
      const notes = row.notes !== null && row.notes !== ''
        ? ` · ${escapeHtml(row.notes)}`
        : '';
      return `<div class="contracts-leave-row">
        <span>${escapeHtml(formatIsoDateUkLong(row.date))}${notes}</span>
        <span class="contracts-leave-row__type">${escapeHtml(row.type)}</span>
        ${remove}
      </div>`;
    })
    .join('');
  return `<div class="contracts-tile__drawer" data-role="drawer">${items}</div>`;
}

function renderList(): void {
  const el = getEl(LIST_ID);
  if (!el) return;
  // The "Your contracts" divider only makes sense when there's an
  // aggregate banner above it to divide from; hide it in the empty
  // state so we don't leave an orphaned border-top floating at the
  // top of the tab.
  const divider = getEl(LIST_DIVIDER_ID);
  if (divider !== null) {
    divider.style.display = contracts.length === 0 ? 'none' : '';
  }
  if (contracts.length === 0) {
    el.innerHTML = '<div class="contracts-empty">No contracts configured yet.</div>';
    return;
  }
  const { active, ended } = partitionContracts(contracts);
  const activeSection = active.length > 0
    ? `<section class="contracts-active">${active.map(renderTile).join('')}</section>`
    : '';
  const endedSection = ended.length > 0
    ? `<details class="contracts-ended-panel">
         <summary>Ended contracts (${ended.length})</summary>
         <div class="contracts-ended-panel__body">${ended.map(renderTile).join('')}</div>
       </details>`
    : '';
  el.innerHTML = `${activeSection}${endedSection}`;
}

// ---------------------------------------------------------------------------
// Drawer actions
// ---------------------------------------------------------------------------

async function toggleDrawer(contractId: string): Promise<void> {
  if (openDrawerIds.has(contractId)) {
    openDrawerIds.delete(contractId);
    leaveByContract.delete(contractId);
    renderList();
    return;
  }
  openDrawerIds.add(contractId);
  renderList();
  try {
    const { leave } = await getJson<{ leave: LeaveRow[] }>(
      `/api/contracts/${encodeURIComponent(contractId)}/leave`,
    );
    leaveByContract.set(contractId, leave);
    renderList();
  } catch (err) {
    console.error('[contracts] failed to load leave log', err);
  }
}

async function handleRemoveLeave(contractId: string, leaveId: string): Promise<void> {
  try {
    await deleteJson(
      `/api/contracts/${encodeURIComponent(contractId)}/leave/${encodeURIComponent(leaveId)}`,
    );
    const { leave } = await getJson<{ leave: LeaveRow[] }>(
      `/api/contracts/${encodeURIComponent(contractId)}/leave`,
    );
    leaveByContract.set(contractId, leave);
    await refreshAccrual();
  } catch (err) {
    console.error('[contracts] failed to remove leave', err);
    alert(err instanceof Error ? err.message : 'Failed to remove leave');
  }
}

// ---------------------------------------------------------------------------
// Record Leave modal
// ---------------------------------------------------------------------------

function datesBetween(start: string, end: string): string[] {
  if (start === '' || end === '' || end < start) return [];
  const out: string[] = [];
  const [y, m, d] = start.split('-').map(Number);
  const cursor = new Date(Date.UTC(y, m - 1, d));
  while (cursor.toISOString().slice(0, 10) <= end) {
    out.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return out;
}

function selectedScopeIds(): string[] {
  const inputs = document.querySelectorAll<HTMLInputElement>(
    `#${SCOPE_ID} input[type="checkbox"]:checked`,
  );
  return Array.from(inputs).map(el => el.value);
}

function readForm(): { dates: string[]; type: LeaveType; notes: string | null } | null {
  const form = getEl(FORM_ID) as HTMLFormElement | null;
  if (!form) return null;
  const data = new FormData(form);
  const startDate = String(data.get('startDate') ?? '');
  const endDate = String(data.get('endDate') ?? '');
  const type = String(data.get('type') ?? 'holiday') as LeaveType;
  const rawNotes = String(data.get('notes') ?? '').trim();
  const notes = rawNotes === '' ? null : rawNotes;
  const dates = datesBetween(startDate, endDate);
  if (dates.length === 0) return null;
  return { dates, type, notes };
}

function openRecordLeaveModal(preselectedContractId: string | null): void {
  const scopeEl = getEl(SCOPE_ID);
  if (scopeEl) {
    const today = todayIsoLocal();
    const current = contracts.filter(c => !isEnded(c, today));
    if (current.length === 0) {
      scopeEl.innerHTML = '<div class="contracts-leave-empty">No current contracts to record leave against.</div>';
    } else {
      scopeEl.innerHTML = current
        .map(c => {
          const checked = preselectedContractId === null || preselectedContractId === c.id;
          return `<label class="contracts-scope-row">
            <input type="checkbox" value="${escapeHtml(c.id)}" ${checked ? 'checked' : ''} />
            <span class="contracts-scope-row__name">${escapeHtml(displayNameFor(c))}</span>
            <span class="contracts-scope-row__ref">${escapeHtml(c.reference)}</span>
          </label>`;
        })
        .join('');
    }
  }
  const title = getEl(MODAL_TITLE_ID);
  if (title) {
    title.textContent = preselectedContractId === null
      ? 'Holiday — all active contracts'
      : `Holiday — ${displayNameFor(contracts.find(c => c.id === preselectedContractId) ?? { client_id: '', id: preselectedContractId } as Contract)}`;
  }
  const form = getEl(FORM_ID) as HTMLFormElement | null;
  if (form) form.reset();
  const previewsEl = getEl(PREVIEWS_ID);
  if (previewsEl) previewsEl.innerHTML = '';
  openModal(MODAL_ID);
}

interface PreviewResult {
  contractId: string;
  preview: TemplatePreviewResponse | null;
  error: string | null;
}

/**
 * Map a server error payload to a copy-paste-friendly sentence. Keeps
 * server `detail` as the base but rewrites the most common cases so
 * users see what to fix rather than the raw "TemplateContextInvalid"
 * error code.
 */
function friendlyPreviewError(body: { error?: string; detail?: string }, contract: Contract | undefined): string {
  const detail = body.detail ?? 'Preview could not be generated.';
  if (body.error === 'TemplateContextInvalid' && detail.includes('end_client_primary_contact_email')) {
    const client = contract ? clientsById.get(contract.client_id) : undefined;
    const who = client?.end_client_legal_name ?? 'the end client';
    const agency = client?.trading_name ?? 'the agency';
    return `Can't generate a preview: we don't have an email for ${who}'s primary contact yet. Edit clients/clients.csv and set end_client_primary_contact_email for ${agency}. Booking leave still works — the preview is just a copy-paste aid.`;
  }
  if (body.error === 'TemplateContextInvalid') {
    return `${detail}. Fix the referenced field in clients/clients.csv and reopen this dialog.`;
  }
  if (body.error === 'DirectClientHasNoAgencyRenewalFlow') {
    return detail;
  }
  return detail;
}

async function fetchPreviewFor(contractId: string, request: TemplatePreviewRequest): Promise<PreviewResult> {
  const url = `/api/contracts/${encodeURIComponent(contractId)}/leave-preview`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    });
    if (res.ok) {
      const preview = (await res.json()) as TemplatePreviewResponse;
      return { contractId, preview, error: null };
    }
    const body = (await res.json().catch(() => ({}))) as { error?: string; detail?: string };
    const contract = contracts.find(c => c.id === contractId);
    return { contractId, preview: null, error: friendlyPreviewError(body, contract) };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Network error';
    return { contractId, preview: null, error: message };
  }
}

async function fetchPreviews(): Promise<PreviewResult[]> {
  const form = readForm();
  const scope = selectedScopeIds();
  if (form === null || scope.length === 0) return [];
  const request: TemplatePreviewRequest = {
    dates: form.dates,
    type: form.type,
    notes: form.notes,
  };
  return Promise.all(scope.map(id => fetchPreviewFor(id, request)));
}

function renderPreviews(results: PreviewResult[]): void {
  const previewsEl = getEl(PREVIEWS_ID);
  if (!previewsEl) return;
  if (results.length === 0) {
    previewsEl.innerHTML = '';
    return;
  }
  previewsEl.innerHTML = results
    .map(({ contractId, preview, error }) => {
      const contract = contracts.find(c => c.id === contractId);
      const heading = contract !== undefined ? displayNameFor(contract) : contractId;
      if (preview === null) {
        return `<div class="contracts-preview" data-preview-id="${escapeHtml(contractId)}">
          <div class="contracts-preview__head">
            <h4 class="contracts-preview__title">${escapeHtml(heading)}</h4>
          </div>
          <div class="contracts-preview__error">${escapeHtml(error ?? '')}</div>
        </div>`;
      }
      return `<div class="contracts-preview" data-preview-id="${escapeHtml(contractId)}">
        <div class="contracts-preview__head">
          <h4 class="contracts-preview__title">${escapeHtml(heading)}</h4>
          <button type="button" class="contracts-preview__copy" data-role="copy" data-contract-id="${escapeHtml(contractId)}">Copy email</button>
        </div>
        <div class="contracts-preview__grid">
          <div class="contracts-preview__label">To</div>
          <input type="text" data-field="to" value="${escapeHtml(preview.recipients.to.join(', '))}" />
          <div class="contracts-preview__label">CC</div>
          <input type="text" data-field="cc" value="${escapeHtml(preview.recipients.cc.join(', '))}" />
          <div class="contracts-preview__label">Subject</div>
          <input type="text" data-field="subject" value="${escapeHtml(preview.subject)}" />
          <div class="contracts-preview__label">Body</div>
          <textarea data-field="body">${escapeHtml(preview.body)}</textarea>
        </div>
      </div>`;
    })
    .join('');
}

async function refreshPreviews(): Promise<void> {
  const results = await fetchPreviews();
  renderPreviews(results);
}

function scheduleRefresh(): void {
  if (previewDebounce !== null) clearTimeout(previewDebounce);
  previewDebounce = setTimeout(() => {
    void refreshPreviews();
  }, 250);
}

function formatEmailForClipboard(panel: HTMLElement): string {
  const field = (name: string): string => {
    const el = panel.querySelector<HTMLInputElement | HTMLTextAreaElement>(
      `[data-field="${name}"]`,
    );
    return el?.value ?? '';
  };
  return [
    `To: ${field('to')}`,
    `CC: ${field('cc')}`,
    `Subject: ${field('subject')}`,
    '',
    field('body'),
  ].join('\n');
}

async function copyPreview(contractId: string): Promise<void> {
  const panel = document.querySelector<HTMLElement>(
    `[data-preview-id="${CSS.escape(contractId)}"]`,
  );
  if (!panel) return;
  const text = formatEmailForClipboard(panel);
  try {
    await navigator.clipboard.writeText(text);
    const btn = panel.querySelector<HTMLButtonElement>('[data-role="copy"]');
    if (btn) {
      const originalText = btn.textContent ?? 'Copy email';
      btn.textContent = 'Copied ✓';
      btn.classList.add('is-copied');
      setTimeout(() => {
        btn.textContent = originalText;
        btn.classList.remove('is-copied');
      }, 1500);
    }
  } catch (err) {
    console.error('[contracts] clipboard write failed', err);
    alert('Could not copy to clipboard — select the text manually.');
  }
}

async function submitRecordLeave(ev: Event): Promise<void> {
  ev.preventDefault();
  const form = readForm();
  const scope = selectedScopeIds();
  if (form === null || scope.length === 0) return;
  const body: LeaveRequest = {
    dates: form.dates,
    type: form.type,
    notes: form.notes,
  };
  try {
    await Promise.all(
      scope.map(contractId =>
        postJson(`/api/contracts/${encodeURIComponent(contractId)}/leave`, body),
      ),
    );
    closeModal(MODAL_ID);
    await loadContracts();
  } catch (err) {
    console.error('[contracts] failed to record leave', err);
    alert(err instanceof Error ? err.message : 'Failed to record leave');
  }
}

// ---------------------------------------------------------------------------
// Accrual refresh (for after write paths without a full relist)
// ---------------------------------------------------------------------------

async function refreshAccrual(): Promise<void> {
  try {
    aggregate = await getJson<AggregateAccrualResponse>('/api/contracts/income-accrual');
    perContract = new Map(aggregate.contracts.map(row => [row.contract_id, row]));
    renderAggregateBanner();
    renderList();
  } catch (err) {
    console.error('[contracts] failed to refresh accrual', err);
  }
}

// ---------------------------------------------------------------------------
// Agency details popover
// ---------------------------------------------------------------------------

/** Render one <dt>/<dd> pair; elide entirely when the value is missing / TBC. */
function fieldRow(label: string, value: string | null | undefined): string {
  if (value === null || value === undefined) return '';
  const trimmed = value.trim();
  if (trimmed === '' || trimmed.toUpperCase() === 'TBC') return '';
  return `<dt>${escapeHtml(label)}</dt><dd>${escapeHtml(trimmed)}</dd>`;
}

function openAgencyModal(contractId: string): void {
  const contract = contracts.find(c => c.id === contractId);
  if (!contract) return;
  const client = clientsById.get(contract.client_id);
  if (!client || client.kind !== 'agency') return;
  const title = getEl(AGENCY_MODAL_TITLE_ID);
  const body = getEl(AGENCY_MODAL_BODY_ID);
  if (title) title.textContent = client.trading_name;
  if (body) {
    body.innerHTML = `<dl class="contracts-agency-details">
      ${fieldRow('Legal name', client.legal_name)}
      ${fieldRow('End client', client.end_client_legal_name)}
      ${fieldRow('Agency contact', client.primary_contact_name)}
      ${fieldRow('Agency email', client.primary_contact_email)}
      ${fieldRow('Secondary email', client.secondary_contact_email)}
      ${fieldRow('End-client contact', client.end_client_primary_contact_name)}
      ${fieldRow('End-client email', client.end_client_primary_contact_email)}
      ${fieldRow('Billing address', client.billing_address)}
    </dl>`;
  }
  openModal(AGENCY_MODAL_ID);
}

// ---------------------------------------------------------------------------
// Download + Renew actions
// ---------------------------------------------------------------------------

async function downloadContract(contractId: string): Promise<void> {
  const url = `/api/contracts/${encodeURIComponent(contractId)}/document`;
  try {
    const res = await fetch(url, { method: 'GET' });
    if (res.status === 404) {
      const body = await res.json().catch(() => ({ detail: 'Document not found.' }));
      alert(body.detail ?? 'Document not found.');
      return;
    }
    if (!res.ok) throw new Error(`GET ${url} failed: ${res.status}`);
    const disposition = res.headers.get('Content-Disposition') ?? '';
    const filenameMatch = /filename="([^"]+)"/.exec(disposition);
    const downloadName = filenameMatch?.[1] ?? `${contractId}.pdf`;
    const blob = await res.blob();
    const objectUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = objectUrl;
    a.download = downloadName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(objectUrl);
  } catch (err) {
    console.error('[contracts] download failed', err);
    alert(err instanceof Error ? err.message : 'Failed to download contract');
  }
}

let activeRenewContractId: string | null = null;

function openRenewModal(contractId: string): void {
  const contract = contracts.find(c => c.id === contractId);
  if (!contract) return;
  activeRenewContractId = contractId;
  const title = getEl(RENEW_MODAL_TITLE_ID);
  if (title) title.textContent = `Renew — ${endClientNameFor(contract)}`;
  const form = getEl(RENEW_FORM_ID) as HTMLFormElement | null;
  form?.reset();
  if (form && contract.end_date !== null) {
    const startInput = form.elements.namedItem('startDate');
    const nextDay = new Date(contract.end_date);
    nextDay.setUTCDate(nextDay.getUTCDate() + 1);
    if (startInput instanceof HTMLInputElement) {
      startInput.value = nextDay.toISOString().slice(0, 10);
    }
  }
  openModal(RENEW_MODAL_ID);
}

async function submitRenew(ev: Event): Promise<void> {
  ev.preventDefault();
  if (activeRenewContractId === null) return;
  const form = ev.currentTarget as HTMLFormElement;
  const fd = new FormData(form);
  const startDate = String(fd.get('startDate') ?? '');
  const endDate = String(fd.get('endDate') ?? '');
  const dayRateRaw = String(fd.get('dayRate') ?? '').trim();
  const dayRate = dayRateRaw === '' ? undefined : Number(dayRateRaw);
  if (dayRate !== undefined && Number.isNaN(dayRate)) {
    alert('Day rate must be a number.');
    return;
  }
  try {
    const res = await fetch(
      `/api/contracts/${encodeURIComponent(activeRenewContractId)}/renew`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          start_date: startDate,
          end_date: endDate,
          ...(dayRate !== undefined ? { day_rate: dayRate } : {}),
        }),
      },
    );
    const body = await res.json().catch(() => ({ detail: res.statusText }));
    if (res.status === 501) {
      alert(body.detail ?? 'Renewal flow not yet implemented.');
      closeModal(RENEW_MODAL_ID);
      return;
    }
    if (!res.ok) {
      alert(body.detail ?? `Request failed: ${res.status}`);
      return;
    }
    closeModal(RENEW_MODAL_ID);
  } catch (err) {
    console.error('[contracts] renew failed', err);
    alert(err instanceof Error ? err.message : 'Failed to submit renewal');
  }
}

// ---------------------------------------------------------------------------
// Invoice handoff (Contracts tile → Invoices tab modals)
// ---------------------------------------------------------------------------

function selfBillIngestHint(contractId: string): string {
  const contract = contracts.find(c => c.id === contractId);
  if (contract === undefined) {
    return 'Upload one or more agency self-bill PDFs. Period and amounts are read from each file and matched to an active contract.';
  }
  const client = clientsById.get(contract.client_id);
  const name = client?.trading_name ?? contract.client_id;
  const ref = contract.reference;
  return `Self-bill for ${name} · ${ref}. Upload one or more agency PDFs; we read supplier invoice number, period, days, and totals from each file and file on the matching contract.`;
}

// ---------------------------------------------------------------------------
// Public entry points
// ---------------------------------------------------------------------------

export function initContracts(): void {
  getEl(GAPS_BANNER_ID)?.addEventListener('click', ev => {
    const target = ev.target;
    if (!(target instanceof HTMLElement)) return;
    const btn = target.closest<HTMLElement>('[data-role="invoice-gap"]');
    if (btn === null) return;
    const id = btn.dataset.contractId;
    const bm = btn.dataset.billingMonth;
    if (id !== undefined && bm !== undefined) {
      void openSupplierInvoiceForContract(id, { billingMonth: bm });
    }
  });

  const list = getEl(LIST_ID);
  if (list) {
    list.addEventListener('click', ev => {
      const target = ev.target;
      if (!(target instanceof HTMLElement)) return;
      const actionEl = target.closest<HTMLElement>('[data-role]');
      if (!actionEl) return;
      const role = actionEl.dataset.role;
      const id = actionEl.dataset.contractId;
      if (role === 'book' && id) {
        openRecordLeaveModal(id);
      } else if (role === 'invoice' && id) {
        const mechanism = actionEl.dataset.invoiceMechanism;
        if (mechanism === 'self-bill') {
          openSelfBillIngestWithHint(selfBillIngestHint(id));
        } else {
          void openSupplierInvoiceForContract(id);
        }
      } else if (role === 'toggle' && id) {
        void toggleDrawer(id);
      } else if (role === 'remove') {
        const leaveId = actionEl.dataset.leaveId;
        if (id && leaveId) void handleRemoveLeave(id, leaveId);
      } else if (role === 'agency' && id) {
        openAgencyModal(id);
      } else if (role === 'download' && id) {
        void downloadContract(id);
      } else if (role === 'renew' && id) {
        openRenewModal(id);
      }
    });
  }

  getEl(BOOK_ALL_BTN_ID)?.addEventListener('click', () => openRecordLeaveModal(null));
  getEl(MODAL_CLOSE_ID)?.addEventListener('click', () => closeModal(MODAL_ID));
  getEl(MODAL_CANCEL_ID)?.addEventListener('click', () => closeModal(MODAL_ID));

  getEl(AGENCY_MODAL_CLOSE_ID)?.addEventListener('click', () => closeModal(AGENCY_MODAL_ID));

  getEl(RENEW_MODAL_CLOSE_ID)?.addEventListener('click', () => closeModal(RENEW_MODAL_ID));
  getEl(RENEW_MODAL_CANCEL_ID)?.addEventListener('click', () => closeModal(RENEW_MODAL_ID));
  const renewForm = getEl(RENEW_FORM_ID) as HTMLFormElement | null;
  renewForm?.addEventListener('submit', ev => void submitRenew(ev));

  const form = getEl(FORM_ID) as HTMLFormElement | null;
  form?.addEventListener('submit', ev => void submitRecordLeave(ev));

  // Only refresh previews when the INPUTS that shape the template change.
  // Typing into the editable preview fields must never trigger a re-fetch
  // (it would wipe the user's edits mid-keystroke).
  form?.addEventListener('input', ev => {
    const target = ev.target;
    if (target instanceof HTMLElement && target.closest(`#${PREVIEWS_ID}`)) return;
    scheduleRefresh();
  });
  form?.addEventListener('change', ev => {
    const target = ev.target;
    if (target instanceof HTMLElement && target.closest(`#${PREVIEWS_ID}`)) return;
    scheduleRefresh();
  });

  const previewsEl = getEl(PREVIEWS_ID);
  previewsEl?.addEventListener('click', ev => {
    const target = ev.target;
    if (!(target instanceof HTMLElement)) return;
    const btn = target.closest<HTMLElement>('[data-role="copy"]');
    if (btn) {
      const id = btn.dataset.contractId;
      if (id) void copyPreview(id);
    }
  });
}

/**
 * Best-effort fetch of the fixed-monthly-expenses threshold. Returns
 * `null` (rather than throwing) on failure so a slow / missing expenses
 * endpoint never blocks the Contracts tab from rendering — the combined
 * hero tile simply falls back to its neutral state.
 */
async function fetchFixedMonthlyExpenses(): Promise<number | null> {
  try {
    const res = await getJson<ExpensesSheetResponse>('/api/expenses/overview');
    return res.summary.totalMonthlyOutgoings;
  } catch (err) {
    console.warn('[contracts] fixed-expenses threshold unavailable:', err);
    return null;
  }
}

export async function loadContracts(): Promise<void> {
  try {
    const [listRes, clientsRes, companiesRes, accrualRes, gapsRes, expenses] = await Promise.all([
      getJson<{ contracts: Contract[] }>('/api/contracts'),
      getJson<{ clients: Client[] }>('/api/clients'),
      getJson<{ companies: Company[] }>('/api/company'),
      getJson<AggregateAccrualResponse>('/api/contracts/income-accrual'),
      getJson<SupplierMonthGapsResponse>('/api/invoices/supplier-month-gaps'),
      fetchFixedMonthlyExpenses(),
    ]);
    contracts = listRes.contracts;
    clientsById = new Map(clientsRes.clients.map(c => [c.id, c]));
    companiesById = new Map(companiesRes.companies.map(c => [c.id, c]));
    aggregate = accrualRes;
    supplierMonthGaps = gapsRes.gaps;
    perContract = new Map(accrualRes.contracts.map(row => [row.contract_id, row]));
    fixedMonthlyExpenses = expenses;
    renderInvoiceGapsBanner();
    renderAggregateBanner();
    renderList();
    updateLeaveCalendarContracts(contracts);
    if (!leaveCalendarInitialised) {
      initLeaveCalendar(contracts, () => loadContracts());
      leaveCalendarInitialised = true;
    }
  } catch (err) {
    console.error('[contracts] failed to load', err);
    const el = getEl(LIST_ID);
    if (el) el.innerHTML = '<div class="contracts-empty">Failed to load contracts.</div>';
  }
}
