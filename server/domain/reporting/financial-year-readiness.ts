import type {
  EntityId,
  FinancialYearReadinessOverview,
  ReportingReadinessResponse,
} from '../../../shared/api-contracts.js';
import { computeReportingReadiness, type ReadinessDeps } from './readiness.js';
import {
  listVatQuarterLabelsInFinancialYear,
  listReportingPeriodsDueWithinHorizon,
  type DueReportingPeriod,
} from './period.js';
import { formatMissingReadinessSummary } from './reporting-format.js';

export interface FinancialYearReadinessArgs {
  entityId: EntityId;
  financialYear: string;
}

function describePeriod(r: ReportingReadinessResponse): string {
  const regimeName =
    r.regime === 'vat' ? 'VAT' : r.regime === 'corporation_tax' ? 'Corporation Tax' : 'Date range';
  const summary = formatMissingReadinessSummary(r.missing, r.invoices.missingInvoiceNumbers);
  return `${regimeName} ${r.periodLabel}: ${summary}`;
}

export function computeFinancialYearReadinessOverview(
  args: FinancialYearReadinessArgs,
  deps: ReadinessDeps = {},
): FinancialYearReadinessOverview {
  const corporationTax = computeReportingReadiness(
    { entityId: args.entityId, regime: 'corporation_tax', periodLabel: args.financialYear },
    deps,
  );
  const vatQuarters = listVatQuarterLabelsInFinancialYear(args.financialYear).map(periodLabel => ({
    periodLabel,
    readiness: computeReportingReadiness(
      { entityId: args.entityId, regime: 'vat', periodLabel },
      deps,
    ),
  }));

  const allReadiness: ReportingReadinessResponse[] = [
    corporationTax,
    ...vatQuarters.map(q => q.readiness),
  ];
  const missingDocCount = allReadiness.reduce((sum, r) => sum + r.missing.length, 0);
  const missingInvoiceNumbers = [
    ...new Set(allReadiness.flatMap(r => r.invoices.missingInvoiceNumbers)),
  ].sort((a, b) => a.localeCompare(b));
  const ready = allReadiness.every(r => r.ready);
  const recommendedNextSteps = ready
    ? ['All Corporation Tax and VAT periods for this financial year are complete.']
    : allReadiness.filter(r => !r.ready).map(describePeriod);

  return {
    entityId: args.entityId,
    financialYear: corporationTax.periodLabel,
    corporationTax,
    vatQuarters,
    aggregate: {
      ready,
      missingDocCount,
      missingInvoiceCount: missingInvoiceNumbers.length,
      missingInvoiceNumbers,
    },
    recommendedNextSteps,
    generatedAt: new Date().toISOString(),
  };
}

export interface UpcomingReadinessItem extends DueReportingPeriod {
  readiness: ReportingReadinessResponse;
}

export interface UpcomingReadinessOverview {
  entityId: EntityId;
  deadlineHorizonDays: number;
  anyReady: boolean;
  periods: UpcomingReadinessItem[];
}

export function computeUpcomingReportingReadiness(
  args: { entityId: EntityId; horizonDays: number; today?: Date },
  deps: ReadinessDeps = {},
): UpcomingReadinessOverview {
  const due = listReportingPeriodsDueWithinHorizon(args.horizonDays, args.today ?? new Date());
  const periods = due.map(period => ({
    ...period,
    readiness: computeReportingReadiness(
      { entityId: args.entityId, regime: period.regime, periodLabel: period.periodLabel },
      deps,
    ),
  }));
  return {
    entityId: args.entityId,
    deadlineHorizonDays: args.horizonDays,
    anyReady: periods.some(p => p.readiness.ready),
    periods,
  };
}
