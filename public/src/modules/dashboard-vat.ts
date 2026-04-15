/**
 * Dashboard VAT + tax liabilities rendering.
 */

import type { DashboardSummary } from '../types';
import { state, getAccountConfig } from './state';
import { fetchVATPayments } from '../utils/api';
import { formatCurrency } from '../utils/formatting';

/**
 * HMRC: Corporation Tax due 9 months and 1 day after the end of the accounting period.
 * Our FY is May–April; period end is always 30 April of `aprilEndYear` (the second calendar year in the label).
 */
function corporationTaxDueDateForMayAprilFY(aprilEndYear: number): Date {
  const periodEnd = new Date(aprilEndYear, 3, 30);
  const due = new Date(periodEnd);
  due.setMonth(due.getMonth() + 9);
  due.setDate(due.getDate() + 1);
  return due;
}

function getNextVatDueDate(): string {
  const now = new Date();
  const year = now.getFullYear();
  const dueDates = [
    new Date(year, 2, 7),
    new Date(year, 5, 7),
    new Date(year, 8, 7),
    new Date(year, 11, 7),
    new Date(year + 1, 2, 7)
  ];
  const nextDue = dueDates.find(d => d > now) || dueDates[0];
  return nextDue.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

async function renderVatTimeline(financialYear: string, tax: DashboardSummary['taxLiabilities']): Promise<void> {
  const gridEl = document.getElementById('vat-timeline-grid');
  if (!gridEl) return;

  const match = financialYear.match(/^(\d{4})[/-](\d{2})$/);
  if (!match) return;

  const startYear = parseInt(match[1], 10);
  const endYear = startYear + 1;
  const formatDate = (d: Date) => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  const now = new Date();

  const quarters = [
    { label: 'Q3: May-Jul', start: new Date(startYear, 4, 1), end: new Date(startYear, 6, 31), due: new Date(startYear, 8, 7) },
    { label: 'Q4: Aug-Oct', start: new Date(startYear, 7, 1), end: new Date(startYear, 9, 31), due: new Date(startYear, 11, 7) },
    { label: 'Q1: Nov-Jan', start: new Date(startYear, 10, 1), end: new Date(endYear, 0, 31), due: new Date(endYear, 2, 7) },
    { label: 'Q2: Feb-Apr', start: new Date(endYear, 1, 1), end: new Date(endYear, 3, 30), due: new Date(endYear, 5, 7) },
  ];

  let payments: Array<{ date: string; amount: number }> = [];
  try {
    const data = await fetchVATPayments();
    payments = data.payments;
  } catch (error) {
    console.error('[VAT Timeline] Failed to fetch payment data:', error);
  }

  const outstandingQuarterLabel = tax?.vatQuarter?.label || '';
  const outstandingQuarterAmount = tax?.vatOwedThisQuarter || tax?.vatOutstanding || 0;
  const inProgressLabel = tax?.vatInProgressQuarter?.label || '';
  const inProgressEstimate = tax?.vatInProgressEstimate || 0;

  gridEl.innerHTML = quarters.map(q => {
    const periodStr = `${formatDate(q.start)} – ${formatDate(q.end)}`;
    const dueStr = `Due: ${formatDate(q.due)}`;
    const isPast = now > q.due;
    const isInProgress = inProgressLabel && q.label.includes(inProgressLabel.split(' ')[0]);

    const dueMonth = q.due.getMonth();
    const dueYear = q.due.getFullYear();
    const matchingPayment = payments.find(p => {
      const pDate = new Date(p.date);
      return pDate.getMonth() === dueMonth && pDate.getFullYear() === dueYear;
    });

    const isOutstanding = outstandingQuarterLabel && q.label.includes(outstandingQuarterLabel.split(' ')[0]);

    let statusClass = 'future';
    let amount = '—';
    let statusText = '';

    if (matchingPayment) {
      statusClass = 'paid';
      amount = formatCurrency(Math.abs(matchingPayment.amount));
      const paidDate = new Date(matchingPayment.date);
      statusText = `Paid ${formatDate(paidDate)}`;
    } else if (isOutstanding && !isInProgress) {
      statusClass = 'upcoming';
      amount = outstandingQuarterAmount > 0 ? `~${formatCurrency(outstandingQuarterAmount)}` : '—';
      statusText = 'Due — not yet paid';
    } else if (isInProgress) {
      statusClass = 'upcoming';
      amount = inProgressEstimate > 0 ? `~${formatCurrency(inProgressEstimate)}` : '—';
      statusText = 'In progress';
    } else if (isPast) {
      statusClass = 'paid';
      amount = '—';
      statusText = 'No payment found';
    }

    return `
      <div class="vat-quarter-item ${statusClass}">
        <span class="vat-quarter-label">${q.label}</span>
        <span class="vat-quarter-period">${periodStr}</span>
        <span class="vat-quarter-amount">${amount}</span>
        <span class="vat-quarter-due">${dueStr}</span>
        <span class="vat-quarter-status">${statusText}</span>
      </div>
    `;
  }).join('');
}

export function renderLiabilities(tax: DashboardSummary['taxLiabilities'], financialYear: string): void {
  const liabilitiesPanel = document.getElementById('liabilities-panel');
  const accountConfig = getAccountConfig(state.selectedAccount);

  if (!liabilitiesPanel) return;

  if (!accountConfig.showTaxLiabilities) {
    liabilitiesPanel.style.display = 'none';
    document.getElementById('fy-banner')?.classList.remove('visible');
    document.getElementById('fy-key-dates')?.classList.remove('visible');
    document.getElementById('vat-timeline')?.classList.remove('visible');
    return;
  }
  liabilitiesPanel.style.display = 'block';

  if (!tax) return;

  const periodEl = document.getElementById('liabilities-period');
  if (periodEl) periodEl.textContent = financialYear || 'All Time';

  const fyBannerEl = document.getElementById('fy-banner');
  const fyKeyDatesEl = document.getElementById('fy-key-dates');

  if (fyBannerEl) {
    if (financialYear) {
      const fmatch = financialYear.match(/^(\d{4})[/-](\d{2})$/);
      if (fmatch) {
        const startYear = parseInt(fmatch[1], 10);
        const endYear = startYear + 1;
        const formatDate = (d: Date) => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });

        const yearStart = new Date(startYear, 4, 1);
        const yearEnd = new Date(endYear, 3, 30);
        const filingDeadline = new Date(endYear, 9, 31);
        const paymentDeadline = new Date(endYear + 1, 1, 1);

        fyBannerEl.innerHTML = `<strong>Financial Year ${financialYear}</strong> &mdash; ${formatDate(yearStart)} to ${formatDate(yearEnd)}`;
        fyBannerEl.classList.add('visible');

        if (fyKeyDatesEl && accountConfig.showTaxLiabilities) {
          const startEl = document.getElementById('fy-start-date');
          const endEl = document.getElementById('fy-end-date');
          const filingEl = document.getElementById('fy-filing-date');
          const paymentEl = document.getElementById('fy-payment-date');

          if (startEl) startEl.textContent = formatDate(yearStart);
          if (endEl) endEl.textContent = formatDate(yearEnd);
          if (filingEl) filingEl.textContent = formatDate(filingDeadline);
          if (paymentEl) paymentEl.textContent = formatDate(paymentDeadline);

          fyKeyDatesEl.classList.add('visible');
        }
      }
    } else {
      fyBannerEl.classList.remove('visible');
      if (fyKeyDatesEl) fyKeyDatesEl.classList.remove('visible');
    }
  }

  if (fyKeyDatesEl && !accountConfig.showTaxLiabilities) {
    fyKeyDatesEl.classList.remove('visible');
  }

  const vatTimelineEl = document.getElementById('vat-timeline');
  if (vatTimelineEl) {
    if (accountConfig.showTaxLiabilities && financialYear) {
      renderVatTimeline(financialYear, tax);
      vatTimelineEl.classList.add('visible');
    } else {
      vatTimelineEl.classList.remove('visible');
    }
  }

  // VAT - Current Quarter
  const vatOutstandingEl = document.getElementById('vat-outstanding');
  const vatEstimatedEl = document.getElementById('vat-estimated');
  const vatPaidEl = document.getElementById('vat-paid');

  if (vatOutstandingEl) vatOutstandingEl.textContent = formatCurrency(tax.vatOwedThisQuarter || tax.vatOutstanding || 0);
  if (vatEstimatedEl) vatEstimatedEl.textContent = formatCurrency(tax.vatOnIncome || 0);
  if (vatPaidEl) vatPaidEl.textContent = formatCurrency(tax.vatPaidLast4Quarters || tax.vatPaid || 0);

  if (tax.vatQuarter) {
    const vatQuarterLabelEl = document.getElementById('vat-quarter-label');
    const vatPeriodEl = document.getElementById('vat-period');
    const vatDueDateEl = document.getElementById('vat-due-date');

    if (vatQuarterLabelEl) vatQuarterLabelEl.textContent = `(${tax.vatQuarter.label})`;

    const startDate = new Date(tax.vatQuarter.startDate);
    const endDate = new Date(tax.vatQuarter.endDate);
    const fmtDate = (d: Date) => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

    if (vatPeriodEl) vatPeriodEl.textContent = `Period: ${fmtDate(startDate)} - ${fmtDate(endDate)}`;

    const dueDate = new Date(tax.vatQuarter.dueDate);
    if (vatDueDateEl) vatDueDateEl.textContent = `Due: ${fmtDate(dueDate)}`;
  } else {
    const vatQuarterLabelEl = document.getElementById('vat-quarter-label');
    const vatPeriodEl = document.getElementById('vat-period');
    const vatDueDateEl = document.getElementById('vat-due-date');

    if (vatQuarterLabelEl) vatQuarterLabelEl.textContent = '';
    if (vatPeriodEl) vatPeriodEl.textContent = 'Period: -';
    if (vatDueDateEl) vatDueDateEl.textContent = `Due: ${getNextVatDueDate()}`;
  }

  // Corporation Tax
  const corpTaxEl = document.getElementById('corp-tax');
  const corpTaxNoteEl = document.getElementById('corp-tax-note');
  const corpTaxPeriodEl = document.getElementById('corp-tax-period');
  const corpTaxDueEl = document.getElementById('corp-tax-due');

  if (corpTaxEl) corpTaxEl.textContent = formatCurrency(tax.corporationTax);
  if (corpTaxNoteEl) {
    corpTaxNoteEl.textContent = `${tax.corporationTaxRate.toFixed(1)}% on ${formatCurrency(tax.taxableProfit)} profit`;
  }

  if (corpTaxPeriodEl || corpTaxDueEl) {
    if (financialYear) {
      const fmatch = financialYear.match(/^(\d{4})[/-](\d{2})$/);
      if (fmatch) {
        const sYear = parseInt(fmatch[1], 10);
        const eYear = sYear + 1;
        const periodLabel = `May ${sYear} - Apr ${eYear}`;
        if (corpTaxPeriodEl) corpTaxPeriodEl.textContent = `(${periodLabel})`;

        const dueDate = corporationTaxDueDateForMayAprilFY(eYear);
        const formattedDue = dueDate.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
        if (corpTaxDueEl) corpTaxDueEl.textContent = `Due: ${formattedDue}`;
      }
    } else {
      if (corpTaxPeriodEl) corpTaxPeriodEl.textContent = '';
      if (corpTaxDueEl) corpTaxDueEl.textContent = '';
    }
  }

  // David's Personal Tax
  const davidTotal = tax.davidPayments?.total || 0;
  const davidSalary = tax.davidPayments?.salary || 0;
  const davidDividends = tax.davidPayments?.dividends || 0;

  const davidTaxEl = document.getElementById('david-tax');
  const davidTaxNoteEl = document.getElementById('david-tax-note');
  const davidSalaryPaidEl = document.getElementById('david-salary-paid');
  const davidDividendsPaidEl = document.getElementById('david-dividends-paid');
  const davidDividendTaxEl = document.getElementById('david-dividend-tax');
  const davidBreakdownEl = document.getElementById('david-breakdown');
  const davidTotalPaidEl = document.getElementById('david-total-paid');
  const davidAnnualSalaryEl = document.getElementById('david-annual-salary');

  if (davidTaxEl) davidTaxEl.textContent = formatCurrency(tax.davidTaxEstimate || 0);
  if (davidTaxNoteEl) davidTaxNoteEl.textContent = `on ${formatCurrency(davidTotal)} payments`;
  if (davidTotalPaidEl) davidTotalPaidEl.textContent = formatCurrency(davidTotal);
  const davidMonthlySalary = (tax.davidPayments?.annualSalary || 0) / 12;
  if (davidSalaryPaidEl) davidSalaryPaidEl.textContent = formatCurrency(davidSalary);
  const davidMonthlySalaryNoteEl = document.getElementById('david-monthly-salary-note');
  if (davidMonthlySalaryNoteEl) davidMonthlySalaryNoteEl.textContent = `(${formatCurrency(davidMonthlySalary)}/month)`;
  if (davidAnnualSalaryEl) davidAnnualSalaryEl.textContent = formatCurrency(tax.davidPayments?.annualSalary || 0);
  const davidMonthlySalaryEl = document.getElementById('david-monthly-salary');
  if (davidMonthlySalaryEl) davidMonthlySalaryEl.textContent = `(${formatCurrency(davidMonthlySalary)}/month)`;
  if (davidDividendsPaidEl) davidDividendsPaidEl.textContent = formatCurrency(davidDividends);
  if (davidDividendTaxEl) davidDividendTaxEl.textContent = formatCurrency(tax.davidTaxBreakdown?.dividendTax || 0);
  if (davidBreakdownEl) davidBreakdownEl.style.display = 'block';

  // Heena's Personal Tax
  const heenaTotal = tax.heenaPayments?.total || 0;
  const heenaSalary = tax.heenaPayments?.salary || 0;
  const heenaDividends = tax.heenaPayments?.dividends || 0;

  const heenaTaxEl = document.getElementById('heena-tax');
  const heenaTaxNoteEl = document.getElementById('heena-tax-note');
  const heenaSalaryPaidEl = document.getElementById('heena-salary-paid');
  const heenaDividendsPaidEl = document.getElementById('heena-dividends-paid');
  const heenaDividendTaxEl = document.getElementById('heena-dividend-tax');
  const heenaBreakdownEl = document.getElementById('heena-breakdown');
  const heenaTotalPaidEl = document.getElementById('heena-total-paid');
  const heenaAnnualSalaryEl = document.getElementById('heena-annual-salary');

  if (heenaTaxEl) heenaTaxEl.textContent = formatCurrency(tax.heenaTaxEstimate || 0);
  if (heenaTaxNoteEl) heenaTaxNoteEl.textContent = `on ${formatCurrency(heenaTotal)} payments`;
  if (heenaTotalPaidEl) heenaTotalPaidEl.textContent = formatCurrency(heenaTotal);
  const heenaMonthlySalary = (tax.heenaPayments?.annualSalary || 0) / 12;
  if (heenaSalaryPaidEl) heenaSalaryPaidEl.textContent = formatCurrency(heenaSalary);
  const heenaMonthlySalaryNoteEl = document.getElementById('heena-monthly-salary-note');
  if (heenaMonthlySalaryNoteEl) heenaMonthlySalaryNoteEl.textContent = `(${formatCurrency(heenaMonthlySalary)}/month)`;
  if (heenaAnnualSalaryEl) heenaAnnualSalaryEl.textContent = formatCurrency(tax.heenaPayments?.annualSalary || 0);
  const heenaMonthlySalaryEl = document.getElementById('heena-monthly-salary');
  if (heenaMonthlySalaryEl) heenaMonthlySalaryEl.textContent = `(${formatCurrency(heenaMonthlySalary)}/month)`;
  if (heenaDividendsPaidEl) heenaDividendsPaidEl.textContent = formatCurrency(heenaDividends);
  if (heenaDividendTaxEl) heenaDividendTaxEl.textContent = formatCurrency(tax.heenaTaxBreakdown?.dividendTax || 0);
  if (heenaBreakdownEl) heenaBreakdownEl.style.display = 'block';
}
