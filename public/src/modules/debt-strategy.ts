/**
 * Debt Strategy section UI (§1.9). Renders in the main **Strategy** tab
 * (`#strategy` → `#debt-strategy-section`), not the Debt (creditor) tab.
 *
 * Default view: short “spare cash toward debt” summary, suggested paydown cards with
 * comparable pacing options, and active plans — without headroom matrices or
 * per-scope capital tables on first paint.
 */

import { escapeHtml, escapeAttribute, openModal, closeModal } from '../utils/dom';
import { formatCurrency, formatIsoDateUkLong } from '../utils/formatting';
import type { CurrencyCode } from '../../../shared/api-contracts.js';
import { activateTabByName } from './tabs.js';

type PlanIntensity = 'aggressive' | 'medium' | 'passive';

function asCurrency(value: string): CurrencyCode {
  return value === 'AED' ? 'AED' : 'GBP';
}

interface PlanLite {
  id: string;
  display_name: string;
  goal_type: 'pay-off-debt' | 'save-for-target';
  target_id: string | null;
  target_amount: number | null;
  intensity: PlanIntensity;
  monthly_allocation: number;
  status: 'suggested' | 'active' | 'paused' | 'completed';
  activated_at: string;
  completed_at: string | null;
  projected_completion_date: string | null;
  currency: string;
  scope: string;
}

interface PayoffSummaryLite {
  readonly current_balance: number | null;
  readonly baseline_monthly: number;
  readonly supplemental_monthly: number;
  readonly total_monthly: number;
  readonly projected_completion_date: string | null;
  readonly approx_months_remaining: number | null;
}

interface PlanWithOptionalPayoff extends PlanLite {
  readonly payoff_summary?: PayoffSummaryLite | null;
}

interface PayoffOptionsLite {
  readonly current_balance: number;
  readonly baseline_monthly: number;
  readonly intensities: ReadonlyArray<{
    readonly intensity: PlanIntensity;
    readonly monthly_total: number;
    readonly supplemental_monthly: number;
    readonly projected_completion_date: string | null;
    readonly approx_months_remaining: number | null;
  }>;
  readonly one_shot: {
    readonly amount: number;
    readonly projected_completion_date: string | null;
    readonly approx_months_remaining: number | null;
  } | null;
}

interface SuggestedPlanWithPayoff extends PlanLite {
  readonly payoff_options: PayoffOptionsLite;
}

interface MovementLite {
  id: string;
  plan_id: string;
  from_account: string;
  to_account: string;
  amount: number;
  day_of_month: number;
  acknowledged_at: string | null;
}

interface BucketHeadroomLite {
  key: string;
  currency: string;
  scope: string;
  totalHeadroom: number;
  availableHeadroom: number;
}

interface StrategyCapitalBucketRow {
  key: string;
  currency: string;
  scope: string;
  strategy_end_date: string;
  deployable_money_now: number;
  money_expected_in_period: number;
  fixed_bills_in_period: number;
  surplus_in_period: number;
  money_for_debt_strategy: number;
  typical_monthly_bills: number;
  monthly_standing_order_drain: number;
  money_available_after_plan: number;
  months_of_bill_cover_after_plan: number | null;
  bill_cover_viable: boolean;
  bill_cover_meets_comfort_target: boolean;
}

interface StrategyCapitalHolistic {
  display_currency: string;
  total_deployable_money: number;
  total_typical_monthly_bills: number;
  two_month_bill_reserve: number;
  usable_for_debt_paydown: number;
  holistic_money_for_debt_gbp: number;
  holistic_money_for_debt_aed: number;
  holistic_per_scope_row_sum_gbp?: number;
  holistic_per_scope_row_sum_aed?: number;
}

interface RecommendedLumpSumRow {
  debt_id: string;
  name: string;
  currency: string;
  recommended_lump_sum: number;
}

interface StrategyCapitalSnapshot {
  today: string;
  strategy_end_date: string;
  planning_range_end_exclusive: string;
  by_bucket: StrategyCapitalBucketRow[];
  holistic: StrategyCapitalHolistic;
  recommended_lump_sum_allocations: readonly RecommendedLumpSumRow[];
}

interface RefinanceRecommendationRow {
  debtId: string;
  kind: string;
  total_cost_savings_vs_keep: number;
}

interface CreditCardPaydownHintRow {
  debt_id: string;
  name: string;
  currency: string;
  scope: string;
  current_balance: number;
  source_account: string;
}

interface CrossScopeTransferPreview {
  worthwhile: boolean;
  source_scope: string;
  target_scope: string;
  source_currency: string;
  target_currency: string;
  estimated_transfer_fee: number;
  reason_codes: readonly string[];
}

interface SandboxIncomeContractRow {
  contractId: string;
  label: string;
  bucketKey: string;
  monthlyAccrual: number;
}

interface SandboxIncomeRecurringRow {
  key: string;
  label: string;
  bucketKey: string;
  monthlyAmount: number;
  declaredObligationId: string | null;
}

interface SandboxIncomeSourcesPayload {
  contracts: SandboxIncomeContractRow[];
  recurring: SandboxIncomeRecurringRow[];
}

/** GET /api/runway → fixed-expenses insight (monthly total). */
interface RunwayInsightLite {
  totalFixedMonthlyExpenses: number;
}

/** GET /api/runway → `holisticGbp` (Strategy tab only). */
interface RunwayHolisticGbpPayload {
  firstStressDateFullRecurring: string | null;
  runwayMonthsFullRecurring: number | null;
  firstStressDateMandatoryRecurring: string | null;
  runwayMonthsMandatoryRecurring: number | null;
}

/** POST /api/debt-strategy/sandbox → `scenarioHolisticGbpRunway`. */
interface ScenarioHolisticGbpRunwayPayload {
  firstStressDate: string | null;
  runwayMonths: number | null;
}

interface DebtStrategyStateResponse {
  today: string;
  headroomByBucket: BucketHeadroomLite[];
  activePlans: PlanWithOptionalPayoff[];
  pausedPlans: PlanWithOptionalPayoff[];
  completedPlans: PlanWithOptionalPayoff[];
  suggestedPlans: SuggestedPlanWithPayoff[];
  movements: MovementLite[];
  strategyCapital: StrategyCapitalSnapshot;
  refinanceRecommendations: RefinanceRecommendationRow[];
  creditCardPaydownHints: CreditCardPaydownHintRow[];
  crossScopeTransferPreview: CrossScopeTransferPreview;
  sandboxIncomeSources?: SandboxIncomeSourcesPayload;
}

interface DebtStrategyTabState {
  data: DebtStrategyStateResponse | null;
}

const tabState: DebtStrategyTabState = {
  data: null,
};

let strategyHolisticRunway: RunwayHolisticGbpPayload | null = null;
let strategyRunwayHorizonDays = 720;
let strategyRunwayInsight: RunwayInsightLite | null = null;

async function fetchState(): Promise<void> {
  const [res, runwayRes] = await Promise.all([
    fetch('/api/debt-strategy/state'),
    fetch('/api/runway'),
  ]);
  if (!res.ok) throw new Error(`Failed to load debt strategy state: ${res.status}`);
  tabState.data = (await res.json()) as DebtStrategyStateResponse;
  if (runwayRes.ok) {
    const rw = (await runwayRes.json()) as {
      holisticGbp: RunwayHolisticGbpPayload;
      horizonDays: number;
      insight: RunwayInsightLite;
    };
    strategyHolisticRunway = rw.holisticGbp;
    strategyRunwayHorizonDays = rw.horizonDays;
    strategyRunwayInsight = rw.insight;
  } else {
    strategyHolisticRunway = null;
    strategyRunwayInsight = null;
  }
}

function intensityShortLabel(i: PlanIntensity): string {
  switch (i) {
    case 'aggressive':
      return 'Aggressive (fastest monthly)';
    case 'medium':
      return 'Medium (steady extra)';
    case 'passive':
      return 'Passive (gentle extra)';
    default:
      return i;
  }
}

function formatApproxMonths(n: number | null): string {
  if (n === null) return '—';
  if (n <= 0) return '0';
  return String(n);
}

function renderHolisticRunwayLine(): string {
  if (strategyHolisticRunway === null) {
    return `<div class="strategy-runway-hero strategy-runway-hero--error" role="status"><p>Could not load consolidated cash runway.</p></div>`;
  }
  const h = strategyHolisticRunway;
  const mand = h.firstStressDateMandatoryRecurring;
  const mandNote =
    mand === null
      ? 'Bills-only path: no stress in this horizon.'
      : `Bills-only path: around ${formatIsoDateUkLong(mand)}.`;
  const expTotal = strategyRunwayInsight?.totalFixedMonthlyExpenses;
  const expLine =
    typeof expTotal === 'number'
      ? `<p class="strategy-runway-hero-expenses">Total fixed monthly expenses (detector / sheet model): <strong title="From the same insight as Fixed Expenses — recurring fixed costs in GBP.">${escapeHtml(formatCurrency(expTotal, 'GBP'))}</strong>/mo</p>`
      : '';
  const title = `${mandNote} GBP + AED merged at static FX; forecast spans about ${strategyRunwayHorizonDays} days.`;
  const stress = h.firstStressDateFullRecurring;
  if (stress === null) {
    return `<div class="strategy-runway-hero" role="status" title="${escapeAttribute(title)}">
    <p class="strategy-runway-hero-label">Consolidated cash runway</p>
    <p class="strategy-runway-hero-date strategy-runway-hero-date--ok">No stress in window</p>
    <p class="strategy-runway-hero-sub">Cash stays positive within this forecast (~${strategyRunwayHorizonDays} days on today's path).</p>
    ${expLine}
    </div>`;
  }
  const months = h.runwayMonthsFullRecurring;
  const mo = months === null ? '—' : String(months);
  return `<div class="strategy-runway-hero" role="status" title="${escapeAttribute(title)}">
    <p class="strategy-runway-hero-label">Cash runs out (holistic GBP)</p>
    <p class="strategy-runway-hero-date">${escapeHtml(formatIsoDateUkLong(stress))}</p>
    <p class="strategy-runway-hero-sub">About <strong>${escapeHtml(mo)}</strong> months on today's path · AED merged at static rates</p>
    ${expLine}
    </div>`;
}

function renderEl5Strip(state: DebtStrategyStateResponse): string {
  const hol = state.strategyCapital.holistic;
  const displayCur = asCurrency(hol.display_currency);
  const usable = hol.usable_for_debt_paydown;
  return `<div class="debt-strategy-el5">
    <p>Think of it this way: after setting aside about <strong>two months</strong> of typical bills, you still have roughly <strong>${escapeHtml(
      formatCurrency(usable, displayCur),
    )}</strong> that could go toward debt (all accounts combined, shown in ${escapeHtml(displayCur)}).</p>
    <p class="debt-strategy-debt-pointer">For who you owe and raw balances, open the <button type="button" class="btn-link debt-strategy-debt-tab-btn" data-action="go-debt-tab">Debt</button> tab.</p>
  </div>`;
}

function renderSuggestedGrid(state: DebtStrategyStateResponse): string {
  if (state.suggestedPlans.length > 0) {
    return state.suggestedPlans.map(suggestedCard).join('');
  }
  if (state.pausedPlans.length > 0) {
    return `<p class="debt-strategy-empty">No new suggestions right now — paused plans still tie up the same debt slots as active ones. Resume or finish a plan to refresh suggestions.</p>`;
  }
  if (state.activePlans.length > 0) {
    return `<p class="debt-strategy-empty">No new suggestions — active plans already cover the eligible consumer debts, or headroom is too tight for another allocation.</p>`;
  }
  return `<p class="debt-strategy-empty">No suggestions yet. When balances and headroom allow, a paydown proposal will appear here.</p>`;
}

function planCard(plan: PlanWithOptionalPayoff, movements: MovementLite[]): string {
  const cur = asCurrency(plan.currency);
  const movementsHtml = movements
    .filter(m => m.plan_id === plan.id)
    .map(
      m => `
      <div class="debt-strategy-movement">
        <span>${escapeHtml(formatCurrency(m.amount, cur))} from ${escapeHtml(m.from_account)} to ${escapeHtml(m.to_account)} on the ${m.day_of_month}th</span>
        ${
          m.acknowledged_at !== null
            ? `<span class="debt-strategy-movement-ack">✓ Set up at ${escapeHtml(m.acknowledged_at)}</span>`
            : `<button type="button" class="btn btn-sm" data-action="acknowledge" data-plan-id="${escapeAttribute(plan.id)}" data-movement-id="${escapeAttribute(m.id)}">I've set this up</button>`
        }
      </div>
    `,
    )
    .join('');

  const ps = plan.payoff_summary;
  const payoffStory =
    plan.goal_type === 'pay-off-debt' && ps !== undefined && ps !== null && ps.current_balance !== null
      ? `<div class="debt-strategy-payoff-active-story">
        <p>Balance about <strong>${escapeHtml(formatCurrency(ps.current_balance, cur))}</strong>.
        This plan pays <strong>${escapeHtml(formatCurrency(ps.total_monthly, cur))}</strong>/month total
        (${escapeHtml(formatCurrency(ps.supplemental_monthly, cur))}/month new standing order on top of
        ~${escapeHtml(formatCurrency(ps.baseline_monthly, cur))}/month already matched).
        Rough clear-by <strong>${escapeHtml(ps.projected_completion_date !== null ? formatIsoDateUkLong(ps.projected_completion_date) : '—')}</strong>
        (~${escapeHtml(formatApproxMonths(ps.approx_months_remaining))} months).</p>
      </div>`
      : plan.projected_completion_date !== null
        ? `<div class="debt-strategy-plan-projection">Projected: ${escapeHtml(formatIsoDateUkLong(plan.projected_completion_date))}</div>`
        : '';

  return `
    <article class="debt-strategy-plan debt-strategy-plan--${plan.status}">
      <header class="debt-strategy-plan-header">
        <h4>${escapeHtml(plan.display_name)}</h4>
        <span class="debt-strategy-plan-meta">${escapeHtml(plan.intensity)} · ${escapeHtml(formatCurrency(plan.monthly_allocation, cur))}/mo total</span>
      </header>
      ${payoffStory}
      <div class="debt-strategy-plan-movements">${movementsHtml}</div>
      <footer class="debt-strategy-plan-actions">
        ${
          plan.status === 'active'
            ? `<button type="button" class="btn btn-sm" data-action="pause" data-plan-id="${escapeAttribute(plan.id)}">Pause</button>`
            : ''
        }
        ${
          plan.status === 'paused'
            ? `<button type="button" class="btn btn-sm" data-action="resume" data-plan-id="${escapeAttribute(plan.id)}">Resume</button>`
            : ''
        }
        ${
          plan.status !== 'completed'
            ? `<button type="button" class="btn btn-sm btn-danger" data-action="delete" data-plan-id="${escapeAttribute(plan.id)}">Delete</button>`
            : `<span class="debt-strategy-plan-completed-at">Completed ${escapeHtml(plan.completed_at ?? '')}</span>`
        }
      </footer>
    </article>
  `;
}

function suggestedCard(sp: SuggestedPlanWithPayoff): string {
  const cur = asCurrency(sp.currency);
  const po = sp.payoff_options;
  const baseline = po.baseline_monthly;

  const intensityRows = po.intensities
    .map(row => {
      const clearDate =
        row.projected_completion_date !== null
          ? formatIsoDateUkLong(row.projected_completion_date)
          : '—';
      const months = formatApproxMonths(row.approx_months_remaining);
      return `
      <div class="debt-strategy-payoff-option debt-strategy-payoff-option--${escapeAttribute(row.intensity)}">
        <div class="debt-strategy-payoff-option-head">
          <span class="debt-strategy-payoff-option-title">${escapeHtml(intensityShortLabel(row.intensity))}</span>
          <span class="debt-strategy-payoff-option-total">${escapeHtml(formatCurrency(row.monthly_total, cur))}/mo toward this debt</span>
        </div>
        <p class="debt-strategy-payoff-option-body">
          About <strong>${escapeHtml(formatCurrency(row.supplemental_monthly, cur))}</strong> extra per month on top of
          <strong>${escapeHtml(formatCurrency(baseline, cur))}</strong> already going out.
          If you kept this up, you could be clear by <strong>${escapeHtml(clearDate)}</strong> (~${escapeHtml(months)} months vs leaving only the matched payments).
        </p>
        <button type="button" class="btn btn-primary btn-sm"
          data-action="activate-suggested"
          data-plan-id="${escapeAttribute(sp.id)}"
          data-activation="monthly"
          data-intensity="${escapeAttribute(row.intensity)}"
        >Choose this pace</button>
      </div>`;
    })
    .join('');

  const lumpBlock =
    po.one_shot !== null
      ? (() => {
          const l = po.one_shot;
          const lumpDate =
            l.projected_completion_date !== null ? formatIsoDateUkLong(l.projected_completion_date) : '—';
          const lumpMonths = formatApproxMonths(l.approx_months_remaining);
          return `
        <div class="debt-strategy-payoff-option debt-strategy-payoff-option--lump">
          <div class="debt-strategy-payoff-option-head">
            <span class="debt-strategy-payoff-option-title">One-off from spare cash</span>
            <span class="debt-strategy-payoff-option-total">${escapeHtml(formatCurrency(l.amount, cur))} now</span>
          </div>
          <p class="debt-strategy-payoff-option-body">
            Pay <strong>${escapeHtml(formatCurrency(l.amount, cur))}</strong> from deployable cash at your bank now, then add a
            <strong>medium</strong> standing order for what is left — rough clear-by <strong>${escapeHtml(lumpDate)}</strong> (~${escapeHtml(lumpMonths)} months after the lump).
          </p>
          <button type="button" class="btn btn-sm"
            data-action="activate-suggested"
            data-plan-id="${escapeAttribute(sp.id)}"
            data-activation="after_lump"
          >Start monthly after lump</button>
        </div>`;
        })()
      : '';

  return `
    <article class="debt-strategy-plan debt-strategy-plan--suggested">
      <header class="debt-strategy-plan-header">
        <h4>${escapeHtml(sp.display_name)}</h4>
        <span class="debt-strategy-plan-meta">${escapeHtml(formatCurrency(po.current_balance, cur))} balance · ${escapeHtml(formatCurrency(baseline, cur))}/mo already matched</span>
      </header>
      <div class="debt-strategy-payoff-stack">
        ${intensityRows}
        ${lumpBlock}
      </div>
    </article>
  `;
}

function render(state: DebtStrategyStateResponse): string {
  const active =
    state.activePlans.length > 0
      ? state.activePlans.map(p => planCard(p, state.movements)).join('')
      : '<p class="debt-strategy-empty">No active plans yet. When suggestions appear below, pick a pace to activate one.</p>';
  const paused =
    state.pausedPlans.length > 0
      ? state.pausedPlans.map(p => planCard(p, state.movements)).join('')
      : '';
  const completed =
    state.completedPlans.length > 0
      ? state.completedPlans.map(p => planCard(p, state.movements)).join('')
      : '';

  return `
    <section class="debt-strategy-section">
      <header class="debt-strategy-header">
        <h3>Debt strategy</h3>
        <button
          type="button"
          class="btn btn-sm"
          id="debt-strategy-sandbox-btn"
          title="Exclude contract accrual or recurring income and re-run the holistic GBP cash forecast"
        >Income scenario</button>
      </header>

      ${renderHolisticRunwayLine()}

      ${renderEl5Strip(state)}

      <h4 class="debt-strategy-subhead">Active plans</h4>
      <div class="debt-strategy-active-grid">${active}</div>

      <h4 class="debt-strategy-subhead">Suggested plans</h4>
      <div class="debt-strategy-suggested-grid">${renderSuggestedGrid(state)}</div>

      ${paused ? `<h4 class="debt-strategy-subhead">Paused plans</h4><div class="debt-strategy-paused-grid">${paused}</div>` : ''}
      ${completed ? `<h4 class="debt-strategy-subhead">Completed plans</h4><div class="debt-strategy-completed-grid">${completed}</div>` : ''}
    </section>
  `;
}

async function activateSuggested(
  planId: string,
  mode: { kind: 'monthly'; intensity: PlanIntensity } | { kind: 'after_lump' },
): Promise<void> {
  const body =
    mode.kind === 'after_lump'
      ? { choice: 'after_lump' as const, dayOfMonth: 1 }
      : { choice: 'monthly' as const, intensity: mode.intensity, dayOfMonth: 1 };
  const res = await fetch(`/api/debt-strategy/plans/${encodeURIComponent(planId)}/activate-suggested`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    window.alert(`Could not activate plan: ${text}`);
    return;
  }
  await fetchAndRender();
}

async function pauseOrResume(planId: string, action: 'pause' | 'resume'): Promise<void> {
  const res = await fetch(`/api/debt-strategy/plans/${encodeURIComponent(planId)}/${action}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  });
  if (!res.ok) {
    window.alert(`Failed to ${action} plan.`);
    return;
  }
  await fetchAndRender();
}

async function deletePlan(planId: string): Promise<void> {
  if (!window.confirm('Delete this plan? This will also remove its movements.')) return;
  const res = await fetch(`/api/debt-strategy/plans/${encodeURIComponent(planId)}`, {
    method: 'DELETE',
  });
  if (!res.ok) {
    window.alert('Failed to delete plan.');
    return;
  }
  await fetchAndRender();
}

async function acknowledgeMovement(planId: string, movementId: string): Promise<void> {
  const res = await fetch(
    `/api/debt-strategy/plans/${encodeURIComponent(planId)}/movements/${encodeURIComponent(movementId)}/acknowledge`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    },
  );
  if (!res.ok) {
    window.alert('Failed to acknowledge.');
    return;
  }
  await fetchAndRender();
}

const SANDBOX_MODAL_ID = 'debt-strategy-sandbox-modal';
let sandboxModalWired = false;
let sandboxRecalcTimer: number | undefined;
let sandboxScenarioRequestGen = 0;

function bucketKeyCurrency(bucketKeyStr: string): CurrencyCode {
  const cur = bucketKeyStr.split('::')[0];
  return cur === 'AED' ? 'AED' : 'GBP';
}

function shortBucketLabelFromKey(bucketKeyStr: string): string {
  const parts = bucketKeyStr.split('::');
  const cur = parts[0] ?? '';
  const scope = parts[1] ?? '';
  const scopeLabel = scope === 'household' ? 'Household' : scope;
  return `${scopeLabel} (${cur})`;
}

function renderSandboxIncomeToggles(state: DebtStrategyStateResponse): void {
  const contractsEl = document.getElementById('debt-strategy-sandbox-contracts');
  const recurringEl = document.getElementById('debt-strategy-sandbox-recurring');
  const emptyEl = document.getElementById('debt-strategy-sandbox-empty');
  const wrapC = document.getElementById('debt-strategy-sandbox-contracts-wrap');
  const wrapR = document.getElementById('debt-strategy-sandbox-recurring-wrap');
  if (
    contractsEl === null ||
    recurringEl === null ||
    emptyEl === null ||
    wrapC === null ||
    wrapR === null
  ) {
    return;
  }

  const src = state.sandboxIncomeSources ?? { contracts: [], recurring: [] };
  const hasC = src.contracts.length > 0;
  const hasR = src.recurring.length > 0;
  emptyEl.hidden = hasC || hasR;
  wrapC.hidden = false;

  contractsEl.innerHTML = hasC
    ? src.contracts
        .map(c => {
          const cur = bucketKeyCurrency(c.bucketKey);
          return `<label class="sandbox-toggle-row">
        <input type="checkbox" checked data-sandbox-contract="${escapeAttribute(c.contractId)}" />
        <span class="sandbox-toggle-label">${escapeHtml(c.label)} — ${escapeHtml(formatCurrency(c.monthlyAccrual, cur))}/mo · ${escapeHtml(shortBucketLabelFromKey(c.bucketKey))}</span>
      </label>`;
        })
        .join('')
    : `<p class="debt-strategy-sandbox-contracts-empty">No contract accrual lines in the monthly run-rate window — the scenario forecast still includes contract income unless you exclude it when it appears here.</p>`;

  wrapR.hidden = !hasR;

  recurringEl.innerHTML = src.recurring
    .map(r => {
      const cur = bucketKeyCurrency(r.bucketKey);
      return `<label class="sandbox-toggle-row">
        <input type="checkbox" checked data-sandbox-recurring="${escapeAttribute(r.key)}" />
        <span class="sandbox-toggle-label">${escapeHtml(r.label)} — ${escapeHtml(formatCurrency(r.monthlyAmount, cur))}/mo · ${escapeHtml(shortBucketLabelFromKey(r.bucketKey))}</span>
      </label>`;
    })
    .join('');
}

function readSandboxExclusions(): {
  excludedContractIds: string[];
  excludedRecurringIncomeKeys: string[];
} {
  const modal = document.getElementById('debt-strategy-sandbox-modal');
  const excludedContractIds: string[] = [];
  const excludedRecurringIncomeKeys: string[] = [];
  if (modal === null) {
    return { excludedContractIds, excludedRecurringIncomeKeys };
  }
  for (const el of modal.querySelectorAll<HTMLInputElement>('input[data-sandbox-contract]')) {
    if (!el.checked && el.dataset.sandboxContract !== undefined) {
      excludedContractIds.push(el.dataset.sandboxContract);
    }
  }
  for (const el of modal.querySelectorAll<HTMLInputElement>('input[data-sandbox-recurring]')) {
    if (!el.checked && el.dataset.sandboxRecurring !== undefined) {
      excludedRecurringIncomeKeys.push(el.dataset.sandboxRecurring);
    }
  }
  return { excludedContractIds, excludedRecurringIncomeKeys };
}

function renderSandboxScenarioRunway(scenario: ScenarioHolisticGbpRunwayPayload): void {
  const result = document.getElementById('debt-strategy-sandbox-result');
  const out = document.getElementById('debt-strategy-sandbox-scenario-out');
  if (result === null || out === null) return;
  const title =
    'Holistic GBP cash path with exclusions (AED converted at static rates). Same horizon as the main runway API.';
  if (scenario.firstStressDate === null) {
    out.innerHTML = `<div class="debt-strategy-sandbox-scenario-line" title="${escapeAttribute(title)}"><span class="debt-strategy-sandbox-scenario-date debt-strategy-sandbox-scenario-date--ok">No stress in window</span><p class="debt-strategy-sandbox-scenario-detail">Consolidated cash stays positive for this scenario within the forecast.</p></div>`;
  } else {
    const mo = scenario.runwayMonths === null ? '—' : String(scenario.runwayMonths);
    out.innerHTML = `<div class="debt-strategy-sandbox-scenario-line" title="${escapeAttribute(title)}">
    <div class="debt-strategy-sandbox-scenario-date-row"><span class="debt-strategy-sandbox-scenario-kicker">Cash runs out</span></div>
    <p class="debt-strategy-sandbox-scenario-date">${escapeHtml(formatIsoDateUkLong(scenario.firstStressDate))}</p>
    <p class="debt-strategy-sandbox-scenario-detail">About <strong>${escapeHtml(mo)}</strong> months from today at this income path.</p>
    </div>`;
  }
  result.hidden = false;
}

async function runSandboxScenario(): Promise<void> {
  if (tabState.data === null) {
    window.alert('Strategy data not loaded yet — try again.');
    return;
  }
  const reqId = ++sandboxScenarioRequestGen;
  const { excludedContractIds, excludedRecurringIncomeKeys } = readSandboxExclusions();
  const res = await fetch('/api/debt-strategy/sandbox', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      scenario: { excludedContractIds, excludedRecurringIncomeKeys },
    }),
  });
  if (reqId !== sandboxScenarioRequestGen) return;
  if (!res.ok) {
    let detail = res.statusText || `HTTP ${res.status}`;
    try {
      const errBody = (await res.json()) as { message?: string; error?: string };
      if (typeof errBody.message === 'string' && errBody.message.length > 0) {
        detail = errBody.message;
      } else if (typeof errBody.error === 'string' && errBody.error.length > 0) {
        detail = errBody.error;
      }
    } catch {
      /* ignore */
    }
    window.alert(`Scenario failed: ${detail}`);
    return;
  }
  const body = (await res.json()) as DebtStrategyStateResponse & {
    scenarioHolisticGbpRunway: ScenarioHolisticGbpRunwayPayload;
  };
  if (reqId !== sandboxScenarioRequestGen) return;
  renderSandboxScenarioRunway(body.scenarioHolisticGbpRunway);
}

function scheduleSandboxRecalc(): void {
  if (sandboxRecalcTimer !== undefined) {
    window.clearTimeout(sandboxRecalcTimer);
  }
  sandboxRecalcTimer = window.setTimeout(() => {
    sandboxRecalcTimer = undefined;
    void runSandboxScenario();
  }, 320);
}

function wireSandboxModal(): void {
  if (sandboxModalWired) return;
  sandboxModalWired = true;

  const modal = document.getElementById(SANDBOX_MODAL_ID);
  if (modal === null) return;

  const closeBtn = document.getElementById('debt-strategy-sandbox-modal-close');
  const cancelBtn = document.getElementById('debt-strategy-sandbox-cancel');
  const runBtn = document.getElementById('debt-strategy-sandbox-run');
  closeBtn?.addEventListener('click', () => closeModal(SANDBOX_MODAL_ID));
  cancelBtn?.addEventListener('click', () => closeModal(SANDBOX_MODAL_ID));
  runBtn?.addEventListener('click', () => {
    void runSandboxScenario();
  });

  modal.addEventListener('change', e => {
    const t = e.target;
    if (
      t instanceof HTMLInputElement &&
      (t.hasAttribute('data-sandbox-contract') || t.hasAttribute('data-sandbox-recurring'))
    ) {
      scheduleSandboxRecalc();
    }
  });

  modal.addEventListener('click', e => {
    if (e.target === modal) closeModal(SANDBOX_MODAL_ID);
  });
}

function openSandboxModal(): void {
  wireSandboxModal();
  const result = document.getElementById('debt-strategy-sandbox-result');
  if (result !== null) result.hidden = true;
  const out = document.getElementById('debt-strategy-sandbox-scenario-out');
  if (out !== null) out.innerHTML = '';
  if (tabState.data !== null) {
    renderSandboxIncomeToggles(tabState.data);
  }
  openModal(SANDBOX_MODAL_ID);
  void runSandboxScenario();
}

function attachHandlers(container: HTMLElement): void {
  container.addEventListener('click', e => {
    const target = e.target;
    if (!(target instanceof HTMLElement)) return;
    const action = target.dataset.action;
    const planId = target.dataset.planId;
    const movementId = target.dataset.movementId;
    if (action === 'go-debt-tab') {
      activateTabByName('debt');
    } else if (action === 'activate-suggested' && planId) {
      const activation = target.dataset.activation;
      const intensity = target.dataset.intensity;
      if (activation === 'after_lump') {
        void activateSuggested(planId, { kind: 'after_lump' });
      } else if (
        intensity === 'aggressive' ||
        intensity === 'medium' ||
        intensity === 'passive'
      ) {
        void activateSuggested(planId, { kind: 'monthly', intensity });
      }
    } else if (action === 'pause' && planId) {
      void pauseOrResume(planId, 'pause');
    } else if (action === 'resume' && planId) {
      void pauseOrResume(planId, 'resume');
    } else if (action === 'delete' && planId) {
      void deletePlan(planId);
    } else if (action === 'acknowledge' && planId && movementId) {
      void acknowledgeMovement(planId, movementId);
    } else if (target.id === 'debt-strategy-sandbox-btn') {
      openSandboxModal();
    }
  });
}

let attachedContainer: HTMLElement | null = null;

async function fetchAndRender(): Promise<void> {
  await fetchState();
  const container = document.getElementById('debt-strategy-section');
  if (!container) return;
  if (tabState.data === null) {
    container.innerHTML = '<p class="debt-strategy-empty">Loading…</p>';
    return;
  }
  container.innerHTML = render(tabState.data);
  if (attachedContainer !== container) {
    attachHandlers(container);
    attachedContainer = container;
  }
}

export async function initDebtStrategy(): Promise<void> {
  try {
    await fetchAndRender();
  } catch (e) {
    const container = document.getElementById('debt-strategy-section');
    if (container) {
      container.innerHTML = `<p class="debt-strategy-empty">Could not load: ${escapeHtml(String(e))}</p>`;
    }
  }
}

export function reloadDebtStrategy(): void {
  void fetchAndRender();
}
