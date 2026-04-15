/**
 * Fixed Expenses sheet — recurring / fixed monthly and annual costs (household, all accounts).
 */

import type { ExpensesInsight, ExpensesLineItem, ExpensesSection, ExpensesSheetResponse } from '../../../shared/api-contracts.js';
import { applySimulationExclusions } from '../../../shared/expenses-sheet-build.js';
import { fetchExpensesSheetOverview, putSimulationExclusions } from '../utils/api';
import { escapeHtml } from '../utils/dom';
import { formatCurrency, round2 } from '../utils/formatting';

interface VariancePayload {
  merchant: string;
  typical: number;
  variance: Array<{ period: string; expected: number; actual: number }>;
}

/** Last successful overview payload; toggles re-run `applySimulationExclusions` against this snapshot. */
let fixedExpensesSnapshot: ExpensesSheetResponse | null = null;
/** Current simulation excludes (updated on every checkbox change; snapshot.excludedLineKeys is not updated until reload). */
let sessionExcludedLineKeys: Set<string> = new Set();
let persistSimulationTimer: ReturnType<typeof setTimeout> | null = null;

function parseVariancePayload(raw: string): VariancePayload | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(decoded);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const merchant = Reflect.get(parsed, 'merchant');
  const typical = Reflect.get(parsed, 'typical');
  const variance = Reflect.get(parsed, 'variance');
  if (typeof merchant !== 'string') return null;
  if (typeof typical !== 'number') return null;
  if (!Array.isArray(variance)) return null;
  const points: VariancePayload['variance'] = [];
  for (const row of variance) {
    if (typeof row !== 'object' || row === null) return null;
    const period = Reflect.get(row, 'period');
    const expected = Reflect.get(row, 'expected');
    const actual = Reflect.get(row, 'actual');
    if (typeof period !== 'string' || typeof expected !== 'number' || typeof actual !== 'number') return null;
    points.push({ period, expected, actual });
  }
  return { merchant, typical, variance: points };
}

function renderAllFromSheet(data: ExpensesSheetResponse): void {
  renderMonthlyInsight(data);
  renderAnnualSummaryPods(data);
  const excluded = new Set(data.excludedLineKeys ?? []);
  renderMonthlyOutgoings(data.monthlyOutgoings, excluded);
  renderIncomeTable('fixed-expenses-income-monthly-table', data.incomeMonthly.items, '/mo', excluded);
  renderAnnualOutgoings(data.annualOutgoings, excluded);
  renderAnnualIncome(data, excluded);
}

function schedulePersistSimulationExclusions(lineKeysSorted: string[]): void {
  if (persistSimulationTimer !== null) {
    clearTimeout(persistSimulationTimer);
  }
  persistSimulationTimer = setTimeout(() => {
    persistSimulationTimer = null;
    void putSimulationExclusions(lineKeysSorted).catch((err: unknown) => {
      console.error('[Fixed expenses sheet] Failed to persist simulation exclusions:', err);
    });
  }, 350);
}

export function initFixedExpensesSheet(): void {
  const varianceModal = document.getElementById('fixed-expenses-variance-modal');
  const varianceClose = document.getElementById('fixed-expenses-variance-modal-close');
  if (varianceModal && varianceClose) {
    varianceClose.addEventListener('click', () => {
      varianceModal.style.display = 'none';
    });
    varianceModal.addEventListener('click', (e) => {
      if (e.target === varianceModal) varianceModal.style.display = 'none';
    });
  }

  document.querySelectorAll<HTMLButtonElement>('.fixed-expenses-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.getAttribute('data-fixed-expenses-tab');
      if (tab !== 'monthly' && tab !== 'annual') return;
      document.querySelectorAll('.fixed-expenses-tab-btn').forEach(b => {
        const active = b === btn;
        b.classList.toggle('is-active', active);
        b.setAttribute('aria-selected', String(active));
      });
      const monthlyPanel = document.getElementById('fixed-expenses-panel-monthly');
      const annualPanel = document.getElementById('fixed-expenses-panel-annual');
      if (monthlyPanel) monthlyPanel.hidden = tab !== 'monthly';
      if (annualPanel) annualPanel.hidden = tab !== 'annual';
    });
  });

  const root = document.getElementById('fixed-expenses');
  if (root) {
    root.addEventListener('change', (e) => {
      const t = e.target;
      if (!(t instanceof HTMLInputElement)) return;
      if (!t.classList.contains('fixed-expenses-exclude-cb')) return;
      if (!fixedExpensesSnapshot) return;
      const lineKey = t.getAttribute('data-line-key');
      if (!lineKey) return;

      if (t.checked) {
        sessionExcludedLineKeys.add(lineKey);
      } else {
        sessionExcludedLineKeys.delete(lineKey);
      }
      const sorted = Array.from(sessionExcludedLineKeys).sort();
      const display = applySimulationExclusions(fixedExpensesSnapshot, sessionExcludedLineKeys);
      renderAllFromSheet(display);
      schedulePersistSimulationExclusions(sorted);
    });
  }
}

export async function loadFixedExpensesSheet(): Promise<void> {
  try {
    const data = await fetchExpensesSheetOverview();
    fixedExpensesSnapshot = data;
    sessionExcludedLineKeys = new Set(data.excludedLineKeys ?? []);
    renderAllFromSheet(data);
  } catch (error) {
    console.error('[Fixed expenses sheet] Error loading data:', error);
    fixedExpensesSnapshot = null;
    sessionExcludedLineKeys = new Set();
    const container = document.getElementById('fixed-expenses-monthly-outgoings');
    if (container) {
      container.innerHTML = '<p class="error">Failed to load fixed expenses data. Please try refreshing.</p>';
    }
  }
}

function renderMonthlyInsight(data: ExpensesSheetResponse): void {
  const ins = data.insight;
  setText('fixed-expenses-monthly-pod-spend', formatCurrency(ins.totalFixedMonthlyExpenses));
  setText('fixed-expenses-monthly-pod-passive', formatCurrency(ins.totalPassiveIncome));
  setText('fixed-expenses-monthly-pod-needed', formatCurrency(ins.monthlyIncomeNeededAfterPassive));

  const primary = document.getElementById('fixed-expenses-insight-primary-table');
  if (primary) {
    primary.innerHTML = buildPrimaryInsightMarkup(ins);
  }
}

function buildPrimaryInsightMarkup(ins: ExpensesInsight): string {
  const f = formatCurrency;
  return `
<tbody>
  <tr class="fixed-expenses-insight-row-sub"><td>— Business Expenses</td><td class="fixed-expenses-col-amount">${f(ins.businessExpenses)}</td></tr>
  <tr class="fixed-expenses-insight-row-sub"><td>— Personal fixed (NatWest)</td><td class="fixed-expenses-col-amount">${f(ins.natwestPersonalFixed)}</td></tr>
  <tr class="fixed-expenses-insight-row-sub"><td>— Debt</td><td class="fixed-expenses-col-amount">${f(ins.debtTotal)}</td></tr>
  <tr class="fixed-expenses-insight-row-sub"><td>— Bills</td><td class="fixed-expenses-col-amount">${f(ins.billsExpenses)}</td></tr>
</tbody>`;
}

function renderAnnualSummaryPods(data: ExpensesSheetResponse): void {
  const { summary } = data;
  setText('fixed-expenses-annual-pod-spend', formatCurrency(summary.totalYearlyFixedOutgoings));
  setText('fixed-expenses-annual-pod-passive', formatCurrency(summary.totalYearlyPassiveIncome));
  setText('fixed-expenses-annual-pod-needed', formatCurrency(summary.yearlyIncomeNeededAfterPassive));
}

function renderMonthlyOutgoings(sections: ExpensesSection[], excluded: ReadonlySet<string>): void {
  const container = document.getElementById('fixed-expenses-monthly-outgoings');
  if (!container) return;

  if (sections.length === 0) {
    container.innerHTML = '<p class="fixed-expenses-empty">No recurring monthly outgoings detected in this window. Upload more statements or wait for patterns to emerge.</p>';
    return;
  }

  container.innerHTML = renderFlatTable(sections, '/mo', excluded);
  attachVarianceHandlers(container);
}

function renderAnnualOutgoings(sections: ExpensesSection[], excluded: ReadonlySet<string>): void {
  const container = document.getElementById('fixed-expenses-annual-outgoings');
  if (!container) return;

  const total = sections.reduce((s, sec) => s + sec.subtotal, 0);
  setText('fixed-expenses-annual-subtotal', formatCurrency(total));

  if (sections.length === 0) {
    container.innerHTML = '<p class="fixed-expenses-empty">No annual recurring outgoings detected.</p>';
    return;
  }

  container.innerHTML = renderFlatTable(sections, '/yr', excluded);
  attachVarianceHandlers(container);
}

function renderAnnualIncome(data: ExpensesSheetResponse, excluded: ReadonlySet<string>): void {
  const container = document.getElementById('fixed-expenses-income-annual-table');
  if (!container) return;

  const items = data.incomeAnnual.items;
  setText('fixed-expenses-annual-income-subtotal', formatCurrency(data.incomeAnnual.total));

  if (items.length === 0) {
    container.innerHTML = '<p class="fixed-expenses-empty">No annual recurring income detected.</p>';
    return;
  }

  renderIncomeTable('fixed-expenses-income-annual-table', items, '/yr', excluded);
}

function renderIncomeTable(
  containerId: string,
  items: ExpensesLineItem[],
  suffix: string,
  excluded: ReadonlySet<string>,
): void {
  const container = document.getElementById(containerId);
  if (!container) return;

  if (items.length === 0) {
    container.innerHTML = '<p class="fixed-expenses-empty">None detected.</p>';
    return;
  }

  const rows = items.map(item => renderIncomeRow(item, suffix, excluded)).join('');
  container.innerHTML = `
    <table class="fixed-expenses-table">
      <thead>
        <tr>
          <th>Item</th>
          <th>Account</th>
          <th class="fixed-expenses-col-amount">Amount</th>
          <th class="fixed-expenses-col-exclude">Exclude</th>
          <th></th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
  attachVarianceHandlers(container);
}

function renderFlatTable(sections: ExpensesSection[], suffix: string, excluded: ReadonlySet<string>): string {
  const rows: string[] = [];
  for (const section of sections) {
    for (const item of section.items) {
      rows.push(renderRow(item, suffix, section.colour, excluded));
    }
    rows.push(`
      <tr class="fixed-expenses-subtotal-row">
        <td colspan="3"><span class="fixed-expenses-section-dot" style="background:${section.colour}"></span> ${escapeHtml(section.name)} subtotal</td>
        <td class="fixed-expenses-col-amount">${formatCurrency(section.subtotal)}${suffix}</td>
        <td class="fixed-expenses-col-exclude"></td>
        <td></td>
      </tr>
    `);
  }

  return `
    <table class="fixed-expenses-table fixed-expenses-table-flat">
      <thead>
        <tr>
          <th>Category</th>
          <th>Item</th>
          <th>Account</th>
          <th class="fixed-expenses-col-amount">Amount</th>
          <th class="fixed-expenses-col-exclude">Exclude</th>
          <th></th>
        </tr>
      </thead>
      <tbody>${rows.join('')}</tbody>
    </table>
  `;
}

function renderIncomeRow(item: ExpensesLineItem, amountSuffix: string, excluded: ReadonlySet<string>): string {
  const freq = item.frequency === 'annual' ? '/yr' : '/mo';
  const suffix = amountSuffix || freq;
  const variancePayload = encodeURIComponent(JSON.stringify({
    merchant: item.merchant,
    variance: item.variance,
    typical: item.amount,
  }));
  const infoBtn = item.variance.length > 0
    ? `<button type="button" class="fixed-expenses-info-btn" data-variance="${variancePayload}" title="Show periods where amount differed">i</button>`
    : '';
  const billing = item.billingDay
    ? `<span class="fixed-expenses-billing">${escapeHtml(item.billingDay)}</span>`
    : '';
  const excludedChecked = excluded.has(item.lineKey) ? ' checked' : '';
  const excludeCell = `<td class="fixed-expenses-col-exclude"><label class="fixed-expenses-exclude-label"><input type="checkbox" class="fixed-expenses-exclude-cb" data-line-key="${escapeHtml(item.lineKey)}" aria-label="Exclude from simulation totals"${excludedChecked} /></label></td>`;
  return `
    <tr class="fixed-expenses-row">
      <td>
        <div class="fixed-expenses-item-name">${escapeHtml(item.merchant)}</div>
        ${billing}
      </td>
      <td><span class="fixed-expenses-account-pill">${escapeHtml(item.sourceAccount)}</span></td>
      <td class="fixed-expenses-col-amount">${formatCurrency(item.amount)}${suffix}</td>
      ${excludeCell}
      <td class="fixed-expenses-col-info">${infoBtn}</td>
    </tr>
  `;
}

function renderRow(
  item: ExpensesLineItem,
  amountSuffix = '',
  categoryColour?: string,
  excluded?: ReadonlySet<string>,
): string {
  const freq = item.frequency === 'annual' ? '/yr' : '/mo';
  const suffix = amountSuffix || freq;
  const variancePayload = encodeURIComponent(JSON.stringify({
    merchant: item.merchant,
    variance: item.variance,
    typical: item.amount,
  }));
  const infoBtn = item.variance.length > 0
    ? `<button type="button" class="fixed-expenses-info-btn" data-variance="${variancePayload}" title="Show periods where amount differed">i</button>`
    : '';

  const billing = item.billingDay
    ? `<span class="fixed-expenses-billing">${escapeHtml(item.billingDay)}</span>`
    : '';

  const categoryCell = categoryColour !== undefined
    ? `<td><span class="fixed-expenses-section-dot" style="background:${categoryColour}"></span> ${escapeHtml(item.category)}</td>`
    : '';

  const ex = excluded ?? new Set<string>();
  const excludedChecked = ex.has(item.lineKey) ? ' checked' : '';
  const excludeCell = `<td class="fixed-expenses-col-exclude"><label class="fixed-expenses-exclude-label"><input type="checkbox" class="fixed-expenses-exclude-cb" data-line-key="${escapeHtml(item.lineKey)}" aria-label="Exclude from simulation totals"${excludedChecked} /></label></td>`;

  return `
    <tr class="fixed-expenses-row">
      ${categoryCell}
      <td>
        <div class="fixed-expenses-item-name">${escapeHtml(item.merchant)}</div>
        ${billing}
      </td>
      <td><span class="fixed-expenses-account-pill">${escapeHtml(item.sourceAccount)}</span></td>
      <td class="fixed-expenses-col-amount">${formatCurrency(item.amount)}${suffix}</td>
      ${excludeCell}
      <td class="fixed-expenses-col-info">${infoBtn}</td>
    </tr>
  `;
}

function attachVarianceHandlers(container: HTMLElement): void {
  container.querySelectorAll<HTMLButtonElement>('.fixed-expenses-info-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const raw = btn.getAttribute('data-variance');
      if (!raw) return;
      const parsed = parseVariancePayload(raw);
      if (!parsed) {
        console.error('[Fixed expenses sheet] Failed to parse variance data');
        return;
      }
      showVarianceModal(parsed.merchant, parsed.typical, parsed.variance);
    });
  });
}

function showVarianceModal(
  merchant: string,
  typical: number,
  variance: Array<{ period: string; expected: number; actual: number }>,
): void {
  const modal = document.getElementById('fixed-expenses-variance-modal');
  const titleEl = document.getElementById('fixed-expenses-variance-modal-title');
  const bodyEl = document.getElementById('fixed-expenses-variance-modal-body');
  if (!modal || !titleEl || !bodyEl) return;

  titleEl.textContent = merchant;
  const rows = variance.map(v => {
    const diff = round2(v.actual - v.expected);
    const diffStr = diff >= 0 ? `+${formatCurrency(diff)}` : formatCurrency(diff);
    return `
      <tr>
        <td>${escapeHtml(v.period)}</td>
        <td>${formatCurrency(v.expected)}</td>
        <td>${formatCurrency(v.actual)}</td>
        <td>${diffStr}</td>
      </tr>
    `;
  }).join('');

  bodyEl.innerHTML = `
    <p class="fixed-expenses-variance-intro">Typical amount shown in the sheet: <strong>${formatCurrency(typical)}</strong>. Below are periods where the actual amount differed.</p>
    <div class="fixed-expenses-variance-table-scroll" role="region" aria-label="Variance by period">
      <table class="fixed-expenses-variance-table">
        <thead>
          <tr>
            <th scope="col">Period</th>
            <th scope="col">Expected</th>
            <th scope="col">Actual</th>
            <th scope="col">Difference</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;
  modal.style.display = 'flex';
}

function setText(id: string, text: string): void {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}
