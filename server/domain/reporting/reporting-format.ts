import type { ReportingReadinessItem } from '../../../shared/api-contracts.js';
import { formatReportingMissingDocLabel } from '../../../shared/formatting.js';

/** Human-readable, grouped-by-account summary of missing docs + invoices. */
export function formatMissingReadinessSummary(
  missing: readonly ReportingReadinessItem[],
  missingInvoiceNumbers: readonly string[],
): string {
  const byAccount = new Map<string, string[]>();

  for (const item of missing) {
    const existing = byAccount.get(item.accountLabel) ?? [];
    existing.push(formatReportingMissingDocLabel(item.docType, item.monthKey));
    byAccount.set(item.accountLabel, existing);
  }

  const accountParts: string[] = [];
  for (const [label, slots] of [...byAccount.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const sorted = [...slots].sort((a, b) => a.localeCompare(b));
    accountParts.push(`${label}: ${sorted.join('; ')}`);
  }

  const parts: string[] = [];
  if (accountParts.length > 0) {
    parts.push(accountParts.join('. '));
  }
  if (missingInvoiceNumbers.length > 0) {
    parts.push(`Missing sales invoices: ${missingInvoiceNumbers.join(', ')}`);
  }

  return parts.join('. ');
}
