/**
 * Debt Strategy section UI (§1.9). Renders under the existing Debts tab.
 *
 * Three panels:
 *   - Suggested plans — auto-derived from /api/debt-strategy/state's
 *     `suggestedPlans` field; the user clicks Activate to persist.
 *   - Active plans — with inline progress + acknowledge/pause/resume.
 *   - Completed plans — celebratory archive.
 *
 * Uses the same CSS conventions as the existing Debts module.
 */

import { escapeHtml, escapeAttribute, openModal, closeModal } from '../utils/dom';
import { formatCurrency, formatIsoDateUkLong } from '../utils/formatting';
import type { CurrencyCode } from '../../../shared/api-contracts.js';

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

interface DebtStrategyStateResponse {
  today: string;
  headroomByBucket: BucketHeadroomLite[];
  activePlans: PlanLite[];
  pausedPlans: PlanLite[];
  completedPlans: PlanLite[];
  suggestedPlans: PlanLite[];
  movements: MovementLite[];
  strategyCapital: StrategyCapitalSnapshot;
  refinanceRecommendations: RefinanceRecommendationRow[];
  creditCardPaydownHints: CreditCardPaydownHintRow[];
  crossScopeTransferPreview: CrossScopeTransferPreview;
}

interface DebtStrategyTabState {
  data: DebtStrategyStateResponse | null;
  activatingId: string | null;
}

const tabState: DebtStrategyTabState = {
  data: null,
  activatingId: null,
};

async function fetchState(): Promise<void> {
  const res = await fetch('/api/debt-strategy/state');
  if (!res.ok) throw new Error(`Failed to load debt strategy state: ${res.status}`);
  tabState.data = (await res.json()) as DebtStrategyStateResponse;
}

function bucketLabel(b: BucketHeadroomLite): string {
  const scopeLabel = b.scope === 'household' ? 'Household' : b.scope;
  return `${scopeLabel} (${b.currency})`;
}

function renderStrategyCapital(state: DebtStrategyStateResponse): string {
  const snap = state.strategyCapital;
  if (snap.by_bucket.length === 0) {
    return '<p class="debt-strategy-empty">Capital snapshot will appear once forecast inputs load.</p>';
  }

  const paydown =
    state.creditCardPaydownHints.length > 0
      ? `<div class="debt-strategy-capital-paydown"><strong>Card paydown targets</strong><ul>${state.creditCardPaydownHints
          .map(
            h =>
              `<li>${escapeHtml(h.name)} · ${escapeHtml(formatCurrency(h.current_balance, asCurrency(h.currency as CurrencyCode)))}</li>`,
          )
          .join('')}</ul></div>`
      : '';

  const refinance =
    state.refinanceRecommendations.length > 0
      ? `<div class="debt-strategy-capital-refi"><strong>Refinance hint</strong><ul>${state.refinanceRecommendations
          .map(
            r =>
              `<li>${escapeHtml(r.debtId)} → ${escapeHtml(r.kind)}${
                r.total_cost_savings_vs_keep > 0
                  ? ` (save ~${escapeHtml(formatCurrency(r.total_cost_savings_vs_keep, 'GBP'))} total)`
                  : ''
              }</li>`,
          )
          .join('')}</ul></div>`
      : '';

  const hol = snap.holistic;
  const showCur = asCurrency(hol.display_currency);
  const holisticBlock = `<div class="debt-strategy-capital-holistic"><strong>Holistic deployable (${escapeHtml(hol.display_currency)})</strong>
    <div class="debt-strategy-bucket-row"><span>Total deployable now</span><strong>${escapeHtml(formatCurrency(hol.total_deployable_money, showCur))}</strong></div>
    <div class="debt-strategy-bucket-row"><span>Typical monthly bills (rollup)</span><strong>${escapeHtml(formatCurrency(hol.total_typical_monthly_bills, showCur))}</strong></div>
    <div class="debt-strategy-bucket-row"><span>2× bill reserve</span><strong>${escapeHtml(formatCurrency(hol.two_month_bill_reserve, showCur))}</strong></div>
    <div class="debt-strategy-bucket-row"><span>Usable for paydown (after reserve)</span><strong>${escapeHtml(formatCurrency(hol.usable_for_debt_paydown, showCur))}</strong></div>
    <div class="debt-strategy-bucket-row"><span>Money for debt strategy (holistic, GBP)</span><strong>${escapeHtml(formatCurrency(hol.holistic_money_for_debt_gbp, 'GBP'))}</strong></div>
    <div class="debt-strategy-bucket-row"><span>Money for debt strategy (holistic, AED)</span><strong>${escapeHtml(formatCurrency(hol.holistic_money_for_debt_aed, 'AED'))}</strong></div>
  </div>`;

  const lumpHtml =
    snap.recommended_lump_sum_allocations.length > 0
      ? `<div class="debt-strategy-capital-lump"><strong>Suggested lump sums (after reserve)</strong><ul>${snap.recommended_lump_sum_allocations
          .map(
            row =>
              `<li>${escapeHtml(row.name)} · ${escapeHtml(formatCurrency(row.recommended_lump_sum, asCurrency(row.currency)))}</li>`,
          )
          .join('')}</ul></div>`
      : '';

  const meta = `<p class="debt-strategy-capital-meta">Planning through <strong>${escapeHtml(
    formatIsoDateUkLong(snap.strategy_end_date),
  )}</strong> (income window ends day before ${escapeHtml(snap.planning_range_end_exclusive)}).</p>`;

  const cards = snap.by_bucket
    .map(row => {
      const cur = asCurrency(row.currency);
      const cover =
        row.months_of_bill_cover_after_plan === null
          ? '—'
          : String(row.months_of_bill_cover_after_plan);
      const scopeLabel = row.scope === 'household' ? 'Household' : row.scope;
      const billOk = row.bill_cover_viable ? '' : 'debt-strategy-bucket-row--warn';
      return `
      <div class="debt-strategy-bucket debt-strategy-bucket--capital">
        <div class="debt-strategy-bucket-label">${escapeHtml(scopeLabel)} (${escapeHtml(row.currency)})</div>
        <div class="debt-strategy-bucket-row"><span>Money you can use now (deployable)</span><strong>${escapeHtml(formatCurrency(row.deployable_money_now, cur))}</strong></div>
        <div class="debt-strategy-bucket-row"><span>Money expected in (to end date)</span><strong>${escapeHtml(formatCurrency(row.money_expected_in_period, cur))}</strong></div>
        <div class="debt-strategy-bucket-row"><span>Fixed bills in period</span><strong>${escapeHtml(formatCurrency(row.fixed_bills_in_period, cur))}</strong></div>
        <div class="debt-strategy-bucket-row"><span>Surplus in period</span><strong>${escapeHtml(formatCurrency(row.surplus_in_period, cur))}</strong></div>
        <div class="debt-strategy-bucket-row"><span>Money for debt strategy</span><strong>${escapeHtml(formatCurrency(row.money_for_debt_strategy, cur))}</strong></div>
        <div class="debt-strategy-bucket-row"><span>Typical monthly bills</span><strong>${escapeHtml(formatCurrency(row.typical_monthly_bills, cur))}</strong></div>
        <div class="debt-strategy-bucket-row"><span>Standing orders (active plans)</span><strong>${escapeHtml(formatCurrency(row.monthly_standing_order_drain, cur))}</strong></div>
        <div class="debt-strategy-bucket-row"><span>Money left after plan</span><strong>${escapeHtml(formatCurrency(row.money_available_after_plan, cur))}</strong></div>
        <div class="debt-strategy-bucket-row ${billOk}"><span>Months of bill cover after plan</span><strong>${escapeHtml(cover)}</strong></div>
        <div class="debt-strategy-bucket-row"><span>Bill cover viable (≥2 mo)</span><strong>${row.bill_cover_viable ? 'Yes' : 'No'}</strong></div>
      </div>`;
    })
    .join('');

  return `${meta}${holisticBlock}<div class="debt-strategy-capital-grid">${cards}</div>${lumpHtml}${paydown}${refinance}<p class="debt-strategy-capital-cross-scope">Cross-scope transfer preview: ${state.crossScopeTransferPreview.worthwhile ? 'suggested' : 'not evaluated'} (${escapeHtml(state.crossScopeTransferPreview.source_scope)} ${escapeHtml(state.crossScopeTransferPreview.source_currency)} → ${escapeHtml(state.crossScopeTransferPreview.target_scope)} ${escapeHtml(state.crossScopeTransferPreview.target_currency)}).</p>`;
}

function renderHeadroom(state: DebtStrategyStateResponse): string {
  if (state.headroomByBucket.length === 0) {
    return '<p class="debt-strategy-empty">Headroom will appear here once your forecast settles.</p>';
  }
  const cards = state.headroomByBucket
    .map(b => {
      const cur = asCurrency(b.currency);
      return `
      <div class="debt-strategy-bucket">
        <div class="debt-strategy-bucket-label">${escapeHtml(bucketLabel(b))}</div>
        <div class="debt-strategy-bucket-row">
          <span>Total headroom</span>
          <strong>${escapeHtml(formatCurrency(b.totalHeadroom, cur))}</strong>
        </div>
        <div class="debt-strategy-bucket-row">
          <span>Available for new plans</span>
          <strong>${escapeHtml(formatCurrency(b.availableHeadroom, cur))}</strong>
        </div>
      </div>
    `;
    })
    .join('');
  return `<div class="debt-strategy-headroom-grid">${cards}</div>`;
}

function planCard(plan: PlanLite, movements: MovementLite[]): string {
  const cur = asCurrency(plan.currency);
  const movementsHtml = movements
    .filter(m => m.plan_id === plan.id)
    .map(m => `
      <div class="debt-strategy-movement">
        <span>${escapeHtml(formatCurrency(m.amount, cur))} from ${escapeHtml(m.from_account)} to ${escapeHtml(m.to_account)} on the ${m.day_of_month}th</span>
        ${
          m.acknowledged_at !== null
            ? `<span class="debt-strategy-movement-ack">✓ Set up at ${escapeHtml(m.acknowledged_at)}</span>`
            : `<button type="button" class="btn btn-sm" data-action="acknowledge" data-plan-id="${escapeAttribute(plan.id)}" data-movement-id="${escapeAttribute(m.id)}">I've set this up</button>`
        }
      </div>
    `)
    .join('');

  const projection =
    plan.projected_completion_date !== null
      ? `<div class="debt-strategy-plan-projection">Projected clear: ${escapeHtml(formatIsoDateUkLong(plan.projected_completion_date))}</div>`
      : '';

  return `
    <article class="debt-strategy-plan debt-strategy-plan--${plan.status}">
      <header class="debt-strategy-plan-header">
        <h4>${escapeHtml(plan.display_name)}</h4>
        <span class="debt-strategy-plan-meta">${escapeHtml(plan.intensity)} · ${escapeHtml(formatCurrency(plan.monthly_allocation, cur))}/mo</span>
      </header>
      ${projection}
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

function suggestedCard(sp: PlanLite): string {
  const cur = asCurrency(sp.currency);
  return `
    <article class="debt-strategy-plan debt-strategy-plan--suggested">
      <header class="debt-strategy-plan-header">
        <h4>${escapeHtml(sp.display_name)}</h4>
        <span class="debt-strategy-plan-meta">${escapeHtml(formatCurrency(sp.monthly_allocation, cur))}/mo at ${escapeHtml(sp.intensity)}</span>
      </header>
      ${
        sp.projected_completion_date !== null
          ? `<div class="debt-strategy-plan-projection">Projected clear: ${escapeHtml(formatIsoDateUkLong(sp.projected_completion_date))}</div>`
          : ''
      }
      <footer class="debt-strategy-plan-actions">
        <button type="button" class="btn btn-primary btn-sm" data-action="activate-suggested" data-plan-id="${escapeAttribute(sp.id)}">Activate</button>
      </footer>
    </article>
  `;
}

function render(state: DebtStrategyStateResponse): string {
  const suggested = state.suggestedPlans.length > 0
    ? state.suggestedPlans.map(suggestedCard).join('')
    : '<p class="debt-strategy-empty">No suggestions right now — every active consumer debt has a plan.</p>';
  const active = state.activePlans.length > 0
    ? state.activePlans.map(p => planCard(p, state.movements)).join('')
    : '<p class="debt-strategy-empty">No active plans yet. Activate a suggestion above to get started.</p>';
  const paused = state.pausedPlans.length > 0
    ? state.pausedPlans.map(p => planCard(p, state.movements)).join('')
    : '';
  const completed = state.completedPlans.length > 0
    ? state.completedPlans.map(p => planCard(p, state.movements)).join('')
    : '';

  return `
    <section class="debt-strategy-section">
      <header class="debt-strategy-header">
        <h3>Debt Strategy</h3>
        <button
          type="button"
          class="btn btn-sm"
          id="debt-strategy-sandbox-btn"
          title="See how your headroom holds up under common shocks (lose a contract, drop to 4-day weeks, etc.)"
        >Stress test scenarios</button>
      </header>

      <h4 class="debt-strategy-subhead">Capital &amp; bill cover (through strategy end date)</h4>
      ${renderStrategyCapital(state)}

      <h4 class="debt-strategy-subhead">Headroom by bucket</h4>
      ${renderHeadroom(state)}

      <h4 class="debt-strategy-subhead">Suggested plans</h4>
      <div class="debt-strategy-suggested-grid">${suggested}</div>

      <h4 class="debt-strategy-subhead">Active plans</h4>
      <div class="debt-strategy-active-grid">${active}</div>

      ${paused ? `<h4 class="debt-strategy-subhead">Paused plans</h4><div class="debt-strategy-paused-grid">${paused}</div>` : ''}
      ${completed ? `<h4 class="debt-strategy-subhead">Completed plans</h4><div class="debt-strategy-completed-grid">${completed}</div>` : ''}
    </section>
  `;
}

async function activateSuggested(planId: string): Promise<void> {
  const intensity = window.prompt('Intensity? (aggressive | medium | passive)', 'medium');
  if (intensity === null) return;
  if (!['aggressive', 'medium', 'passive'].includes(intensity)) {
    window.alert('Invalid intensity. Choose aggressive, medium, or passive.');
    return;
  }
  const res = await fetch(`/api/debt-strategy/plans/${encodeURIComponent(planId)}/activate-suggested`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ intensity, dayOfMonth: 1 }),
  });
  if (!res.ok) {
    const body = await res.text();
    window.alert(`Could not activate plan: ${body}`);
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

// ── Stress-test scenarios modal ─────────────────────────────────

const SANDBOX_MODAL_ID = 'debt-strategy-sandbox-modal';
let sandboxModalWired = false;

function readScenarioMultiplier(): number | null {
  const radios = document.querySelectorAll<HTMLInputElement>('#debt-strategy-sandbox-modal input[name="scenario"]');
  let selectedValue: string | null = null;
  for (const r of radios) {
    if (r.checked) {
      selectedValue = r.value;
      break;
    }
  }
  if (selectedValue === null) return null;
  if (selectedValue === 'custom') {
    const slider = document.getElementById('sandbox-custom-slider');
    if (!(slider instanceof HTMLInputElement)) return null;
    const pct = Number(slider.value);
    if (!Number.isFinite(pct) || pct < 0 || pct > 100) return null;
    return pct / 100;
  }
  const num = Number(selectedValue);
  return Number.isFinite(num) ? num : null;
}

function renderSandboxResult(
  before: BucketHeadroomLite[],
  after: BucketHeadroomLite[],
): void {
  const tbody = document.getElementById('debt-strategy-sandbox-tbody');
  const result = document.getElementById('debt-strategy-sandbox-result');
  if (!tbody || !result) return;
  // Index after by key to match against before order.
  const afterByKey = new Map(after.map(b => [b.key, b]));
  const rows = before
    .map(b => {
      const a = afterByKey.get(b.key);
      const cur = asCurrency(b.currency);
      const beforeAvail = b.availableHeadroom;
      const afterAvail = a?.availableHeadroom ?? 0;
      const delta = afterAvail - beforeAvail;
      const deltaClass = delta < 0 ? 'delta-negative' : delta === 0 ? 'delta-zero' : '';
      const sign = delta > 0 ? '+' : '';
      return `
      <tr>
        <td>${escapeHtml(bucketLabel(b))}</td>
        <td class="numeric">${escapeHtml(formatCurrency(beforeAvail, cur))}</td>
        <td class="numeric">${escapeHtml(formatCurrency(afterAvail, cur))}</td>
        <td class="numeric ${deltaClass}">${sign}${escapeHtml(formatCurrency(delta, cur))}</td>
      </tr>`;
    })
    .join('');
  tbody.innerHTML = rows;
  result.hidden = false;
}

async function runSandboxScenario(): Promise<void> {
  const mult = readScenarioMultiplier();
  if (mult === null) {
    window.alert('Pick a scenario first.');
    return;
  }
  if (tabState.data === null) {
    window.alert('Strategy data not loaded yet — try again.');
    return;
  }
  const res = await fetch('/api/debt-strategy/sandbox', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ scenario: { incomeMultiplier: mult } }),
  });
  if (!res.ok) {
    window.alert('Sandbox failed.');
    return;
  }
  const body = (await res.json()) as DebtStrategyStateResponse;
  renderSandboxResult(tabState.data.headroomByBucket, body.headroomByBucket);
}

function syncCustomPctDisplay(): void {
  const slider = document.getElementById('sandbox-custom-slider');
  const display = document.getElementById('sandbox-custom-pct-display');
  if (slider instanceof HTMLInputElement && display) {
    display.textContent = slider.value;
  }
}

function wireSandboxModal(): void {
  if (sandboxModalWired) return;
  sandboxModalWired = true;

  const modal = document.getElementById(SANDBOX_MODAL_ID);
  if (!modal) return;

  modal.addEventListener('change', () => {
    syncCustomPctDisplay();
  });
  const slider = document.getElementById('sandbox-custom-slider');
  if (slider instanceof HTMLInputElement) {
    slider.addEventListener('input', () => {
      // Selecting the slider auto-selects the Custom radio so the
      // user's intent is captured even if they didn't click the
      // radio first.
      const customRadio = document.querySelector<HTMLInputElement>(
        '#debt-strategy-sandbox-modal input[name="scenario"][value="custom"]',
      );
      if (customRadio !== null) customRadio.checked = true;
      syncCustomPctDisplay();
    });
  }

  const closeBtn = document.getElementById('debt-strategy-sandbox-modal-close');
  const cancelBtn = document.getElementById('debt-strategy-sandbox-cancel');
  const runBtn = document.getElementById('debt-strategy-sandbox-run');
  closeBtn?.addEventListener('click', () => closeModal(SANDBOX_MODAL_ID));
  cancelBtn?.addEventListener('click', () => closeModal(SANDBOX_MODAL_ID));
  runBtn?.addEventListener('click', () => {
    void runSandboxScenario();
  });

  // Click outside the modal body closes it.
  modal.addEventListener('click', e => {
    if (e.target === modal) closeModal(SANDBOX_MODAL_ID);
  });
}

function openSandboxModal(): void {
  wireSandboxModal();
  // Reset state on each open: hide previous result, default to "Lose half".
  const result = document.getElementById('debt-strategy-sandbox-result');
  if (result) result.hidden = true;
  const halfRadio = document.querySelector<HTMLInputElement>(
    '#debt-strategy-sandbox-modal input[name="scenario"][value="0.5"]',
  );
  if (halfRadio !== null) halfRadio.checked = true;
  syncCustomPctDisplay();
  openModal(SANDBOX_MODAL_ID);
}

function attachHandlers(container: HTMLElement): void {
  container.addEventListener('click', e => {
    const target = e.target;
    if (!(target instanceof HTMLElement)) return;
    const action = target.dataset.action;
    const planId = target.dataset.planId;
    const movementId = target.dataset.movementId;
    if (action === 'activate-suggested' && planId) {
      void activateSuggested(planId);
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
