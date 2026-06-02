import type {
  EntityFoundationWarning,
  EntityId,
  ReportingReadinessResponse,
  ReportingRegime,
} from '../../../shared/api-contracts.js';
import { formatMissingReadinessSummary } from '../reporting/reporting-format.js';

export interface AccountantPackReadinessInput {
  entityId: EntityId;
  regime: ReportingRegime;
  periodLabel: string;
  readiness: ReportingReadinessResponse;
  graceDays: number;
  today: string;
}

function addGraceDays(periodEndDate: string, graceDays: number): string {
  const d = new Date(`${periodEndDate}T00:00:00`);
  d.setDate(d.getDate() + graceDays);
  return d.toISOString().slice(0, 10);
}

const ENTITY_DISPLAY: Record<EntityId, string> = {
  'autonize-it-ltd': 'Autonize IT Ltd',
  'autonize-it-fzco': 'Autonize IT FZCO',
};

const REGIME_DISPLAY: Record<ReportingRegime, string> = {
  vat: 'VAT',
  corporation_tax: 'Corporation Tax',
};

export function deriveAccountantPackIncompleteWarnings(
  inputs: readonly AccountantPackReadinessInput[],
): EntityFoundationWarning[] {
  const warnings: EntityFoundationWarning[] = [];

  for (const input of inputs) {
    const { readiness, graceDays, today, entityId, regime, periodLabel } = input;
    const fireAfter = addGraceDays(readiness.periodEndDate, graceDays);
    if (today <= fireAfter || readiness.ready) {
      continue;
    }

    const code =
      regime === 'vat' ? 'accountant-pack-incomplete-vat' : 'accountant-pack-incomplete-ct';
    const entityName = ENTITY_DISPLAY[entityId];
    const regimeName = REGIME_DISPLAY[regime];
    const missingSummary = formatMissingReadinessSummary(
      readiness.missing,
      readiness.invoices.missingInvoiceNumbers,
    );

    const docCount = readiness.missing.length;
    const invoiceCount = readiness.invoices.missingInvoiceNumbers.length;

    warnings.push({
      id: `${code}:${entityId}:${periodLabel}`,
      code,
      severity: 'warn',
      entityId,
      title: `${entityName} ${regimeName} pack incomplete (${periodLabel})`,
      detail: `Missing for ${entityName} ${regimeName} ${periodLabel}: ${missingSummary}`,
      recommended_action:
        `Upload the missing statement PDFs/CSVs and generate missing sales-invoice PDFs listed above for ${periodLabel}, then re-run the accountant export.`,
      sources: [
        `entity:${entityId}`,
        `regime:${regime}`,
        `period:${periodLabel}`,
        'reporting-readiness',
      ],
      context: {
        entityId,
        regime,
        periodLabel,
        missingDocs: docCount,
        missingInvoices: invoiceCount,
        periodEndDate: readiness.periodEndDate,
        missingSummary,
      },
    });
  }

  return warnings;
}
