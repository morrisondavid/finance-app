import { fetchReportingReadiness, downloadForAccountant } from '../utils/api.js';
import type {
  ReportingAccountOverview,
  ReportingReadinessItem,
  ReportingReadinessResponse,
  ReportingRegime,
} from '../../../shared/api-contracts.js';
import { formatMonthYear } from '../../../shared/formatting.js';
import {
  buildFyPeriodOptions,
  buildVatQuarterOptionGroups,
  recentVatQuarterYears,
} from '../utils/vat-quarters.js';

const ENTITY_LABELS: Record<string, string> = {
  'autonize-it-ltd': 'Autonize IT Ltd (UK)',
  'autonize-it-fzco': 'Autonize IT FZCO (UAE)',
};

const REGIME_LABELS: Record<ReportingRegime, string> = {
  vat: 'VAT',
  corporation_tax: 'Corporation Tax',
};

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function sortMonthKeys(keys: string[]): string[] {
  return [...keys].sort((a, b) => a.localeCompare(b));
}

interface AccountMissingGrouped {
  accountLabel: string;
  pdfMonths: string[];
  csvMonths: string[];
}

function groupMissingByAccount(
  missing: readonly ReportingReadinessItem[],
): AccountMissingGrouped[] {
  const byAccount = new Map<string, AccountMissingGrouped>();

  for (const item of missing) {
    let group = byAccount.get(item.account);
    if (!group) {
      group = { accountLabel: item.accountLabel, pdfMonths: [], csvMonths: [] };
      byAccount.set(item.account, group);
    }
    if (item.docType === 'pdf') {
      group.pdfMonths.push(item.monthKey);
    } else {
      group.csvMonths.push(item.monthKey);
    }
  }

  return [...byAccount.values()].sort((a, b) =>
    a.accountLabel.localeCompare(b.accountLabel),
  );
}

function renderMonthList(monthKeys: string[]): string {
  const sorted = sortMonthKeys(monthKeys);
  return `<ul class="reporting-month-list">${sorted
    .map(m => `<li>${escapeHtml(formatMonthYear(m))}</li>`)
    .join('')}</ul>`;
}

function renderDocGroup(
  title: string,
  monthKeys: string[],
): string {
  if (monthKeys.length === 0) return '';
  return `
    <div class="reporting-doc-group">
      <span class="reporting-doc-type">${escapeHtml(title)}</span>
      ${renderMonthList(monthKeys)}
    </div>`;
}

function formatPeriodHeading(readiness: ReportingReadinessResponse): string {
  const start = formatMonthYear(readiness.periodStartDate.slice(0, 7));
  const end = formatMonthYear(readiness.periodEndDate.slice(0, 7));
  return `${readiness.periodLabel} (${start} – ${end})`;
}

function renderAccountOverviewRow(overview: ReportingAccountOverview): string {
  const badgeClass = overview.ready
    ? 'reporting-account-status ready'
    : 'reporting-account-status not-ready';
  const statusText = overview.ready
    ? 'Complete'
    : `${overview.missingDocCount} file${overview.missingDocCount === 1 ? '' : 's'} missing`;
  return `
    <li class="reporting-account-overview-row">
      <span class="reporting-account-overview-name">${escapeHtml(overview.accountLabel)}</span>
      <span class="${badgeClass}">${escapeHtml(statusText)}</span>
    </li>`;
}

function renderAccountCard(group: AccountMissingGrouped): string {
  const docGroups = [
    renderDocGroup('Transaction CSV', group.csvMonths),
    renderDocGroup('PDF statement', group.pdfMonths),
  ].filter(Boolean);

  return `
    <article class="reporting-account-card">
      <h5 class="reporting-account-name">${escapeHtml(group.accountLabel)}</h5>
      ${docGroups.join('')}
    </article>`;
}

function renderReadinessPanel(readiness: ReportingReadinessResponse): string {
  const entityName = ENTITY_LABELS[readiness.entityId] ?? readiness.entityId;
  const regimeName = REGIME_LABELS[readiness.regime];
  const periodHeading = formatPeriodHeading(readiness);
  const badgeClass = readiness.ready
    ? 'reporting-status-badge ready'
    : 'reporting-status-badge not-ready';
  const badgeText = readiness.ready ? 'Ready to file' : 'Not ready';

  const missingDocCount = readiness.missing.length;
  const missingInvoiceCount = readiness.invoices.missingInvoiceNumbers.length;

  let statsLine: string;
  if (readiness.ready) {
    statsLine = 'All required statement files and invoice PDFs are on disk.';
  } else {
    const parts: string[] = [];
    if (missingDocCount > 0) {
      parts.push(
        `${missingDocCount} statement file${missingDocCount === 1 ? '' : 's'} missing`,
      );
    }
    if (missingInvoiceCount > 0) {
      parts.push(
        `${missingInvoiceCount} sales invoice PDF${missingInvoiceCount === 1 ? '' : 's'} missing`,
      );
    }
    if (parts.length === 0) {
      parts.push('Pack incomplete');
    }
    statsLine = parts.join(' · ');
  }

  const accountsOverviewSection =
    readiness.accountsOverview.length === 0
      ? ''
      : `
    <section class="reporting-section">
      <h4 class="reporting-section-title">Business accounts</h4>
      <p class="reporting-section-hint">Required statement documents per account (see missing list below).</p>
      <ul class="reporting-accounts-overview">
        ${readiness.accountsOverview.map(renderAccountOverviewRow).join('')}
      </ul>
    </section>`;

  const accountGroups = groupMissingByAccount(readiness.missing);
  const missingDocsSection =
    accountGroups.length === 0
      ? ''
      : `
    <section class="reporting-section">
      <h4 class="reporting-section-title">Missing bank documents</h4>
      <div class="reporting-account-cards">
        ${accountGroups.map(renderAccountCard).join('')}
      </div>
    </section>`;

  const missingInvoices = readiness.invoices.missingInvoiceNumbers;
  const invoicesSection =
    missingInvoices.length === 0
      ? ''
      : `
    <section class="reporting-section">
      <h4 class="reporting-section-title">Missing sales invoice PDFs</h4>
      <ul class="reporting-invoice-list">
        ${missingInvoices.map(n => `<li>${escapeHtml(n)}</li>`).join('')}
      </ul>
    </section>`;

  const successOnly =
    readiness.ready
      ? '<p class="reporting-readiness-ok">You can package and send this period to your accountant.</p>'
      : '';

  return `
    <div class="reporting-readiness-result">
      <div class="reporting-readiness-header">
        <span class="${badgeClass}">${badgeText}</span>
        <div class="reporting-readiness-summary">
          <p class="reporting-readiness-entity">${escapeHtml(entityName)} · ${escapeHtml(regimeName)}</p>
          <p class="reporting-readiness-period">${escapeHtml(periodHeading)}</p>
          <p class="reporting-readiness-stats">${escapeHtml(statsLine)}</p>
        </div>
      </div>
      ${successOnly}
      ${accountsOverviewSection}
      ${missingDocsSection}
      ${invoicesSection}
    </div>`;
}

function setAccountantStatus(text: string): void {
  const el = document.getElementById('accountant-status');
  if (el) el.textContent = text;
}

function setDownloadEnabled(enabled: boolean): void {
  const btn = document.getElementById('download-accountant-btn') as HTMLButtonElement | null;
  if (btn) btn.disabled = !enabled;
}

function statusFromReadiness(readiness: ReportingReadinessResponse): string {
  if (readiness.ready) {
    const completeCount = readiness.accountsOverview.filter(o => o.ready).length;
    const total = readiness.accountsOverview.length;
    return `Ready to file — ${completeCount} of ${total} account${total === 1 ? '' : 's'} complete`;
  }
  const docPart =
    readiness.missing.length > 0
      ? `${readiness.missing.length} document${readiness.missing.length === 1 ? '' : 's'}`
      : '';
  const invCount = readiness.invoices.missingInvoiceNumbers.length;
  const invPart =
    invCount > 0 ? `${invCount} invoice${invCount === 1 ? '' : 's'}` : '';
  const parts = [docPart, invPart].filter(p => p !== '');
  return `Not ready — ${parts.join(' + ')} missing`;
}

async function refreshReadinessPanel(): Promise<void> {
  const entitySelect = document.getElementById('reporting-entity') as HTMLSelectElement | null;
  const regimeSelect = document.getElementById('reporting-regime') as HTMLSelectElement | null;
  const periodSelect = document.getElementById('reporting-period') as HTMLSelectElement | null;
  const panel = document.getElementById('reporting-readiness-panel');

  if (!entitySelect || !regimeSelect || !periodSelect || !panel) return;

  const entityId = entitySelect.value;
  const regime = regimeSelect.value;
  const period = periodSelect.value;

  if (!entityId || !regime || !period) {
    setDownloadEnabled(false);
    setAccountantStatus('Select entity, regime, and period');
    panel.innerHTML =
      '<p class="reporting-readiness-hint">Select entity, regime, and period above to check readiness.</p>';
    return;
  }

  setDownloadEnabled(false);
  setAccountantStatus('Checking readiness…');
  panel.innerHTML = '<p class="reporting-readiness-hint">Checking…</p>';

  try {
    const readiness = await fetchReportingReadiness({ entityId, regime, period });
    panel.innerHTML = renderReadinessPanel(readiness);
    setDownloadEnabled(readiness.ready);
    setAccountantStatus(statusFromReadiness(readiness));
  } catch (err) {
    console.error('[ReportingReadiness]', err);
    setDownloadEnabled(false);
    setAccountantStatus('Could not check readiness');
    panel.innerHTML =
      '<p class="reporting-readiness-error">Could not load readiness. Check the period and try again.</p>';
  }
}

function syncPeriodOptions(): void {
  const regimeSelect = document.getElementById('reporting-regime') as HTMLSelectElement | null;
  const periodSelect = document.getElementById('reporting-period') as HTMLSelectElement | null;

  if (!regimeSelect || !periodSelect) return;

  const regime = regimeSelect.value;
  const previous = periodSelect.value;

  if (regime === 'vat') {
    periodSelect.innerHTML =
      '<option value="">VAT quarter</option>' +
      buildVatQuarterOptionGroups(recentVatQuarterYears());
  } else if (regime === 'corporation_tax') {
    periodSelect.innerHTML =
      '<option value="">Financial year</option>' +
      buildFyPeriodOptions()
        .map(o => `<option value="${o.value}">${o.label}</option>`)
        .join('');
  } else {
    periodSelect.innerHTML = '<option value="">Select period</option>';
  }

  const optionValues = [...periodSelect.options].map(o => o.value);
  periodSelect.value = optionValues.includes(previous) ? previous : '';
}

export function initReportingReadiness(): void {
  const entitySelect = document.getElementById('reporting-entity');
  const regimeSelect = document.getElementById('reporting-regime');
  const periodSelect = document.getElementById('reporting-period');

  if (!entitySelect || !regimeSelect || !periodSelect) return;

  syncPeriodOptions();

  entitySelect.addEventListener('change', () => void refreshReadinessPanel());
  regimeSelect.addEventListener('change', () => {
    syncPeriodOptions();
    void refreshReadinessPanel();
  });
  periodSelect.addEventListener('change', () => void refreshReadinessPanel());

  const downloadBtn = document.getElementById('download-accountant-btn');
  downloadBtn?.addEventListener('click', () => {
    const entityId = (document.getElementById('reporting-entity') as HTMLSelectElement).value;
    const regime = (document.getElementById('reporting-regime') as HTMLSelectElement).value;
    const period = (document.getElementById('reporting-period') as HTMLSelectElement).value;
    if (!entityId || !regime || !period) return;
    downloadForAccountant({ entityId, regime, period });
  });

  void refreshReadinessPanel();
}
