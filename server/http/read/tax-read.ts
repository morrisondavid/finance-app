import { HMRC_PATTERNS } from '../../domain/payees/index.js';
import { businessPaymentAccounts } from '../../domain/accounts/index.js';
import {
  findHmrcPayments,
  getTaxLiabilities,
  resolveFinancialYearForTax,
} from '../../db/repositories/tax.js';
import { getUpcomingObligations, toApiObligation } from '../../db/repositories/obligations.js';
import { getAllAccountBalances } from '../../db/repositories/balance.js';
import { getDb } from '../../db/connection.js';
import { jsonReadFail, jsonReadOk, type JsonReadResult } from './types.js';
import {
  TaxOverviewResponseSchema,
  type EntityId,
  type ObligationRow,
  type TaxOverviewEntityPanel,
  type TaxOverviewLine,
  type TaxOverviewReserveStatus,
  type TaxOverviewSelfAssessmentPanel,
} from '../../../shared/api-contracts.js';
import { todayIsoLocal } from '../../../shared/iso-date.js';
import { allCompanies, companyById } from '../../domain/company/index.js';
import {
  estimateSaForPerson,
  getSaTaxYearForDate,
  getSaTaxYearRange,
} from '../../utils/sa-estimator.js';
import { getTaxRules, UAE_CT_SMALL_BUSINESS_AED } from '../../config/tax-rules.js';
import { UAE_CORPORATION_TAX } from '../../config/tax-rates.js';
import { convertAmountSync } from '../../config/exchange-rates.js';
import { sumFzcoTrailing12mIncomeAed } from '../../domain/warnings/fzco-income.js';
import {
  computeTaxReserveFundingStatus,
  type DeriveTaxReserveWarningsInput,
} from '../../domain/warnings/tax-reserve.js';
import { getReserveRegistry } from '../../domain/reserves/index.js';
import type { AccountName } from '../../types.js';
import {
  accountsForEntity,
  getAccountConfig,
  isValidAccountName,
} from '../../domain/accounts/index.js';
import { getFinancialYearRange } from '../../db/utils/financial-year.js';
import { round2 } from '../../utils/math.js';

export function readTaxVatPayments(query: Record<string, string | undefined>): JsonReadResult {
  try {
    const financialYearRaw = query.financialYear;
    const range = financialYearRaw
      ? getFinancialYearRange(financialYearRaw)
      : { startDate: '2000-01-01', endDate: '2099-12-31' };

    const payments = findHmrcPayments({
      patterns: HMRC_PATTERNS.VAT,
      accounts: [...businessPaymentAccounts()],
      startDate: range.startDate,
      endDate: range.endDate,
    });

    return jsonReadOk({ payments });
  } catch {
    console.error('Error fetching VAT payments');
    return jsonReadFail(500, { error: 'Failed to fetch VAT payments' });
  }
}

const TAX_OBLIGATION_TYPES = new Set([
  'vat',
  'corporation-tax',
  'self-assessment',
  'hmrc-ttp',
]);

function reserveStatusFor(
  funding: Map<string, 'funded' | 'underfunded'>,
  obligationType: string,
  entityId: EntityId,
): TaxOverviewReserveStatus {
  const key = `${obligationType}:${entityId}`;
  const status = funding.get(key);
  if (status === undefined) return 'none';
  return status;
}

function uaeCtNonQualifyingEstimate(incomeAed: number): number {
  const rules = getTaxRules('UAE').corpTax;
  const aboveThreshold = Math.max(0, incomeAed - rules.smallBusinessThreshold);
  return round2(aboveThreshold * rules.topRate);
}

function buildReserveFundingInput(today: string): DeriveTaxReserveWarningsInput {
  const obligations = getUpcomingObligations(365).map(toApiObligation);
  const balances = getAllAccountBalances();
  const balanceByAccount = new Map<AccountName, number>();
  for (const [account, row] of Object.entries(balances)) {
    if (!isValidAccountName(account)) continue;
    balanceByAccount.set(account, row.currentBalance);
  }
  return {
    today,
    reserves: getReserveRegistry().all,
    obligations,
    balanceByAccount,
    monthlyContributionByAccount: new Map(),
  };
}

function nearestUpcomingObligation(
  obligations: readonly ObligationRow[],
  entityId: EntityId,
  type: ObligationRow['type'],
  personId?: string | null,
): ObligationRow | undefined {
  return obligations
    .filter(o => {
      if (o.entity !== entityId || o.type !== type) return false;
      if (personId !== undefined && o.personId !== personId) return false;
      return o.dueDate !== null && o.status !== 'paid';
    })
    .sort((a, b) => (a.dueDate ?? '').localeCompare(b.dueDate ?? ''))[0];
}

/** @internal Exported for unit tests — UK Ltd company tax only (no personal SA). */
export function buildUkLtdPanel(
  reserveFunding: Map<string, 'funded' | 'underfunded'>,
  taxObligations: ObligationRow[],
  currentFy: string,
): TaxOverviewEntityPanel {
  const entityId: EntityId = 'autonize-it-ltd';
  const company = companyById(entityId);
  const lines: TaxOverviewLine[] = [];
  const fyScopedLiabilities = getTaxLiabilities({ financialYear: currentFy });

  const vatObligation = nearestUpcomingObligation(taxObligations, entityId, 'vat');
  lines.push({
    kind: 'vat',
    label: 'VAT (next quarter)',
    amount: round2(
      vatObligation?.expectedAmount ?? fyScopedLiabilities.vatOwedThisQuarter ?? 0,
    ),
    currency: 'GBP',
    dueDate: vatObligation?.dueDate ?? fyScopedLiabilities.vatQuarter?.dueDate ?? null,
    detail: vatObligation?.notes ?? fyScopedLiabilities.vatQuarter?.label ?? null,
    reserveStatus: reserveStatusFor(reserveFunding, 'vat', entityId),
  });

  const ctObligation = nearestUpcomingObligation(taxObligations, entityId, 'corporation-tax');
  lines.push({
    kind: 'corporation-tax',
    label: 'Corporation tax',
    amount: round2(
      ctObligation?.expectedAmount ?? fyScopedLiabilities.corporationTax,
    ),
    currency: 'GBP',
    dueDate: ctObligation?.dueDate ?? null,
    detail:
      ctObligation?.notes ??
      ctObligation?.name ??
      `FY estimate from ledger income (net of VAT) for ${currentFy}`,
    reserveStatus: reserveStatusFor(reserveFunding, 'corporation-tax', entityId),
  });

  for (const o of taxObligations) {
    if (o.entity !== entityId || o.type !== 'hmrc-ttp') continue;
    lines.push({
      kind: 'hmrc-ttp',
      label: o.name,
      amount: o.expectedAmount !== null ? round2(Math.abs(o.expectedAmount)) : null,
      currency: 'GBP',
      dueDate: o.dueDate,
      detail: o.notes,
      reserveStatus: 'none',
    });
  }

  const headlineTotal = round2(
    lines.reduce((sum, line) => sum + (line.amount ?? 0), 0),
  );

  return {
    entityId,
    jurisdiction: company?.jurisdiction ?? 'UK',
    currency: 'GBP',
    headlineTotal,
    headlineTotalGbp: headlineTotal,
    lines,
  };
}

/** @internal Exported for unit tests — personal SA panel, separate from UK Ltd company tax. */
export function buildSelfAssessmentPanel(
  reserveFunding: Map<string, 'funded' | 'underfunded'>,
  taxObligations: ObligationRow[],
): TaxOverviewSelfAssessmentPanel {
  const entityId: EntityId = 'autonize-it-ltd';
  const db = getDb();
  const saYear = getSaTaxYearForDate(new Date());
  const saRange = getSaTaxYearRange(saYear);
  const lines: TaxOverviewLine[] = [];

  for (const personId of ['david', 'heena'] as const) {
    const saObligation = nearestUpcomingObligation(
      taxObligations,
      entityId,
      'self-assessment',
      personId,
    );
    const saEstimate = estimateSaForPerson(personId, saRange.start, saRange.end, db);
    lines.push({
      kind: 'self-assessment',
      label: `Self Assessment — ${saEstimate.displayName}`,
      amount: round2(saObligation?.expectedAmount ?? saEstimate.estimatedTax),
      currency: 'GBP',
      dueDate: saObligation?.dueDate ?? null,
      detail:
        saObligation?.notes ??
        `Tax year ${saRange.start.slice(0, 4)}/${String(saYear).slice(-2)}`,
      reserveStatus: reserveStatusFor(reserveFunding, 'self-assessment', entityId),
    });
  }

  const headlineTotal = round2(
    lines.reduce((sum, line) => sum + (line.amount ?? 0), 0),
  );

  return {
    currency: 'GBP',
    headlineTotal,
    lines,
  };
}

function buildFzcoAccountBalanceLines(
  balances: ReturnType<typeof getAllAccountBalances>,
): TaxOverviewLine[] {
  const entityId: EntityId = 'autonize-it-fzco';
  const lines: TaxOverviewLine[] = [];

  for (const accountName of accountsForEntity(entityId)) {
    const row = balances[accountName];
    if (row === undefined) continue;
    const config = getAccountConfig(accountName);
    const gbpEquivalent = round2(convertAmountSync(row.currentBalance, config.currency, 'GBP'));
    lines.push({
      kind: 'account-balance',
      label: config.label,
      amount: round2(row.currentBalance),
      currency: config.currency,
      dueDate: null,
      detail:
        config.currency === 'GBP'
          ? 'Current account balance'
          : `Current balance · ${formatGbpDetail(gbpEquivalent)}`,
      reserveStatus: 'none',
    });
  }

  return lines;
}

function formatGbpDetail(gbpAmount: number): string {
  return `≈ £${gbpAmount.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function buildFzcoPanel(
  reserveFunding: Map<string, 'funded' | 'underfunded'>,
  today: string,
  allBalances: ReturnType<typeof getAllAccountBalances>,
): TaxOverviewEntityPanel {
  const entityId: EntityId = 'autonize-it-fzco';
  const company = companyById(entityId);
  const db = getDb();
  const trailingIncomeAed = round2(sumFzcoTrailing12mIncomeAed(db, new Date(`${today}T12:00:00Z`)));
  const uaeRules = getTaxRules('UAE');
  const qfzpElected = company?.qfzp_elected === true;
  const belowCtThreshold = trailingIncomeAed <= UAE_CT_SMALL_BUSINESS_AED;
  const qualifyingCt = qfzpElected
    ? round2(trailingIncomeAed * UAE_CORPORATION_TAX.QUALIFYING_RATE)
    : 0;
  const nonQualifyingCt = uaeCtNonQualifyingEstimate(trailingIncomeAed);

  const ctZeroDetail = belowCtThreshold
    ? `Trailing income AED ${trailingIncomeAed.toLocaleString('en-GB')} is below the AED ${UAE_CT_SMALL_BUSINESS_AED.toLocaleString('en-GB')} small-business threshold — no CT due`
    : undefined;

  const lines: TaxOverviewLine[] = [
    ...buildFzcoAccountBalanceLines(allBalances),
    {
      kind: 'ct-scenario',
      label: 'Corporation tax — QFZP qualifying',
      amount: qualifyingCt,
      currency: 'AED',
      dueDate: null,
      detail: qfzpElected
        ? (ctZeroDetail ?? 'QFZP elected — 0% on qualifying income')
        : 'QFZP status not confirmed',
      reserveStatus: reserveStatusFor(reserveFunding, 'corporation-tax', entityId),
    },
    {
      kind: 'ct-scenario',
      label: 'Corporation tax — 9% fallback',
      amount: nonQualifyingCt,
      currency: 'AED',
      dueDate: null,
      detail:
        ctZeroDetail ??
        'Non-qualifying income above AED 375k small-business threshold at 9%',
      reserveStatus: reserveStatusFor(reserveFunding, 'corporation-tax', entityId),
    },
    {
      kind: 'vat-threshold-tracker',
      label: 'VAT registration threshold',
      amount: null,
      currency: 'AED',
      dueDate: null,
      detail: `Trailing 12m income AED ${trailingIncomeAed.toLocaleString('en-GB')} · voluntary ${uaeRules.vat.voluntaryRegistrationThreshold?.toLocaleString('en-GB') ?? '—'} · mandatory ${uaeRules.vat.mandatoryRegistrationThreshold.toLocaleString('en-GB')} · ${company?.vat_registered ? 'registered' : 'not registered'}`,
      reserveStatus: 'none',
    },
  ];

  const headlineTotal = qfzpElected ? qualifyingCt : nonQualifyingCt;

  return {
    entityId,
    jurisdiction: company?.jurisdiction ?? 'UAE',
    currency: 'AED',
    headlineTotal,
    headlineTotalGbp: round2(convertAmountSync(headlineTotal, 'AED', 'GBP')),
    lines,
  };
}

export function readTaxOverview(): JsonReadResult {
  try {
    const today = todayIsoLocal();
    const currentFy = resolveFinancialYearForTax();
    const reserveInput = buildReserveFundingInput(today);
    const reserveFunding = computeTaxReserveFundingStatus(reserveInput);
    const taxObligations = reserveInput.obligations.filter(o => TAX_OBLIGATION_TYPES.has(o.type));
    const allBalances = getAllAccountBalances();

    const ukLtdPanel = buildUkLtdPanel(reserveFunding, taxObligations, currentFy);
    const selfAssessment = buildSelfAssessmentPanel(reserveFunding, taxObligations);

    const entities = allCompanies().map(company => {
      if (company.id === 'autonize-it-ltd') {
        return ukLtdPanel;
      }
      return buildFzcoPanel(reserveFunding, today, allBalances);
    });

    const combinedGbpTotal = round2(
      ukLtdPanel.headlineTotalGbp
        + selfAssessment.headlineTotal
        + entities
            .filter(p => p.entityId === 'autonize-it-fzco')
            .reduce((sum, panel) => sum + panel.headlineTotalGbp, 0),
    );

    const payload = TaxOverviewResponseSchema.parse({
      generatedAt: today,
      entities,
      selfAssessment,
      combinedGbpTotal,
    });
    return jsonReadOk(payload);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown';
    return jsonReadFail(500, { error: 'tax-overview-failed', message });
  }
}
