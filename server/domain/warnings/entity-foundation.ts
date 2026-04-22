/**
 * Entity Foundation Warnings (Roadmap 1.1 Phase 7).
 *
 * A pure, deterministic function over explicit inputs. Six warning
 * branches, each locked by a regression test in
 * {@link ./entity-foundation.test.ts}:
 *
 *   1. `company-tbc-fields` — any row in `company.csv` still has an
 *      unresolved `TBC` literal. Emitted once per entity.
 *   2. `fzco-ct-status-unknown` — the UAE FZCO's `ct_registered` or
 *      `qfzp_elected` is `TBC`. This is the gate that keeps the UAE
 *      CT auto-seeder (Phase 4) silent; surfacing it here tells the
 *      user *why* their UAE tax panel is empty.
 *   3. `fzco-vat-voluntary-threshold-crossed` — trailing-12-month FZCO
 *      income ≥ AED 187,500. Informational — UAE law permits voluntary
 *      registration, doesn't mandate it.
 *   4. `fzco-vat-mandatory-threshold-crossed` — trailing-12-month FZCO
 *      income ≥ AED 375,000. Critical — registration is legally
 *      required.
 *   5. `ifza-license-renewal-due` — the FZCO's IFZA license is within
 *      60 days of its annual anniversary (proxied off `formation_date`
 *      until a dedicated `license_issue_date` field exists). Missed
 *      renewals void the entity's ability to invoice.
 *   6. `inter-company-movement-unclassified` — one or more
 *      business-to-business transactions span UK Ltd ↔ UAE FZCO and
 *      haven't been classified as loan / capital contribution /
 *      inter-company service fee via the Phase 8 category-override
 *      mechanism. Warnings tab surfaces each detected pair for
 *      per-transaction classification; this warning aggregates the
 *      unclassified count.
 *
 * The shape of each warning matches the full Warnings Engine schema
 * (Roadmap 1.8) so the eventual Warnings tab consumes this route
 * verbatim, no migration.
 */

import type {
  Company,
  EntityFoundationWarning,
  EntityFoundationWarningCode,
  WarningSeverity,
} from '../../../shared/api-contracts.js';
import {
  UAE_VAT_VOLUNTARY_AED,
  UAE_VAT_MANDATORY_AED,
} from '../../config/tax-rules.js';

const IFZA_RENEWAL_WINDOW_DAYS = 60;
const MS_PER_DAY = 86_400_000;

export interface EntityFoundationWarningInput {
  /** Every row in `company.csv`, loaded via the CompanyRegistry. */
  readonly companies: readonly Company[];
  /**
   * Trailing-12-month income on the FZCO entity, in AED. The UAE VAT
   * threshold check is a pure comparison against this number; the
   * route is responsible for computing it (sum over
   * `emirates-islamic` income transactions for the preceding 365 d).
   */
  readonly fzcoTrailing12mIncomeAed: number;
  /**
   * Count of UK Ltd ↔ UAE FZCO pair candidates that have not yet
   * been classified via the Phase 8 category-override CSV. A non-zero
   * count emits a single aggregated warning; the Warnings tab renders
   * each pair individually for per-transaction classification.
   */
  readonly interCompanyMovementCount: number;
  /** Injected for deterministic IFZA-renewal tests. */
  readonly today: Date;
}

export function deriveEntityFoundationWarnings(
  input: EntityFoundationWarningInput,
): readonly EntityFoundationWarning[] {
  const warnings: EntityFoundationWarning[] = [];

  for (const company of input.companies) {
    const tbcFields = collectTbcFields(company);
    if (tbcFields.length > 0) {
      warnings.push({
        id: warningId('company-tbc-fields', company.id),
        code: 'company-tbc-fields',
        severity: 'warn',
        title: `Unresolved TBC fields on ${company.trading_name}`,
        detail: `The following fields are still marked "TBC" in autonize-it/company.csv and block downstream calculations: ${tbcFields.join(', ')}.`,
        recommended_action: 'Fill in the missing values (or confirm the ones you cannot answer yet with your accountant) and commit the updated CSV.',
        sources: ['autonize-it/company.csv', `entity:${company.id}`],
      });
    }
  }

  const fzco = input.companies.find(c => c.jurisdiction === 'UAE' && c.id === 'autonize-it-fzco');
  if (fzco && fzco.jurisdiction === 'UAE') {
    // FZCO CT status gate
    if (fzco.ct_registered === 'TBC' || fzco.qfzp_elected === 'TBC') {
      warnings.push({
        id: warningId('fzco-ct-status-unknown', fzco.id),
        code: 'fzco-ct-status-unknown',
        severity: 'warn',
        title: 'UAE Corporation Tax status unresolved for Autonize IT FZCO',
        detail: buildFzcoCtDetail(fzco.ct_registered, fzco.qfzp_elected),
        recommended_action: 'Confirm with your UAE accountant whether the FZCO is CT-registered and whether you will elect for Qualifying Free Zone Person status; update company.csv.',
        sources: ['autonize-it/company.csv', 'entity:autonize-it-fzco'],
      });
    }

    // UAE VAT thresholds
    if (input.fzcoTrailing12mIncomeAed >= UAE_VAT_MANDATORY_AED) {
      warnings.push({
        id: warningId('fzco-vat-mandatory-threshold-crossed', fzco.id),
        code: 'fzco-vat-mandatory-threshold-crossed',
        severity: 'critical',
        title: 'UAE VAT mandatory registration threshold crossed',
        detail: `Autonize IT FZCO's trailing-12-month turnover is AED ${formatAed(input.fzcoTrailing12mIncomeAed)}, which equals or exceeds the AED ${formatAed(UAE_VAT_MANDATORY_AED)} mandatory-registration threshold.`,
        recommended_action: 'Register the FZCO for UAE VAT immediately and re-run the self-bill agreement with La Fosse so reverse-charge VAT is no longer assumed.',
        sources: ['emirates-islamic income transactions', 'entity:autonize-it-fzco'],
      });
    } else if (input.fzcoTrailing12mIncomeAed >= UAE_VAT_VOLUNTARY_AED) {
      warnings.push({
        id: warningId('fzco-vat-voluntary-threshold-crossed', fzco.id),
        code: 'fzco-vat-voluntary-threshold-crossed',
        severity: 'info',
        title: 'UAE VAT voluntary registration threshold crossed',
        detail: `Autonize IT FZCO's trailing-12-month turnover is AED ${formatAed(input.fzcoTrailing12mIncomeAed)}, which equals or exceeds the AED ${formatAed(UAE_VAT_VOLUNTARY_AED)} voluntary-registration threshold (mandatory threshold is AED ${formatAed(UAE_VAT_MANDATORY_AED)}).`,
        recommended_action: 'Decide whether voluntary VAT registration is worthwhile given B2B client reverse-charge eligibility; discuss with your UAE accountant.',
        sources: ['emirates-islamic income transactions', 'entity:autonize-it-fzco'],
      });
    }

    // IFZA license renewal window (proxied off formation_date until a
    // dedicated license_issue_date field exists).
    const renewalWindow = computeIfzaRenewalWindow(fzco.formation_date, input.today);
    if (renewalWindow !== null && renewalWindow.daysUntil <= IFZA_RENEWAL_WINDOW_DAYS) {
      warnings.push({
        id: warningId('ifza-license-renewal-due', fzco.id),
        code: 'ifza-license-renewal-due',
        severity: renewalWindow.daysUntil < 0 ? 'critical' : renewalWindow.daysUntil <= 14 ? 'critical' : 'warn',
        title: 'IFZA license renewal due',
        detail: renewalWindow.daysUntil < 0
          ? `Autonize IT FZCO's IFZA license (number ${fzco.license_number}) appears to have expired on ${renewalWindow.nextRenewalIso} (${Math.abs(renewalWindow.daysUntil)} days ago, based on the annual anniversary of formation ${fzco.formation_date}).`
          : `Autonize IT FZCO's IFZA license (number ${fzco.license_number}) is due for renewal on ${renewalWindow.nextRenewalIso} — ${renewalWindow.daysUntil} days from today.`,
        recommended_action: 'Renew the IFZA license through your corporate service provider. Missed renewals void the entity\'s trade license and its ability to invoice.',
        sources: ['autonize-it/company.csv', 'entity:autonize-it-fzco'],
      });
    }
  }

  // Inter-company unclassified movements (aggregate)
  if (input.interCompanyMovementCount > 0) {
    warnings.push({
      id: 'entity-foundation.inter-company-movement-unclassified',
      code: 'inter-company-movement-unclassified',
      severity: 'warn',
      title: `${input.interCompanyMovementCount} inter-company money movement${input.interCompanyMovementCount === 1 ? '' : 's'} require classification`,
      detail: `Phase 5 detected ${input.interCompanyMovementCount} transaction pair${input.interCompanyMovementCount === 1 ? '' : 's'} moving money between Autonize IT Ltd and Autonize IT FZCO. These are not ordinary transfers — they need to be classified as a loan, a capital contribution, or an inter-company service fee before the tax calculations are trustworthy.`,
      recommended_action: 'Open the Transactions view, filter by inter-company pairs, and tag each movement with its accounting classification.',
      sources: ['transactions: inter-company pairs'],
    });
  }

  return warnings;
}

function warningId(code: EntityFoundationWarningCode, entityId: string): string {
  return `entity-foundation.${code}.${entityId}`;
}

function collectTbcFields(company: Company): string[] {
  const fields: string[] = [];
  if (company.formation_date === 'TBC') fields.push('formation_date');
  if (company.accountant_name === 'TBC') fields.push('accountant_name');
  if (company.accountant_email === 'TBC') fields.push('accountant_email');
  if (company.vat_registered === 'TBC') fields.push('vat_registered');
  if (company.ct_registered === 'TBC') fields.push('ct_registered');
  if (company.jurisdiction === 'UAE') {
    if (company.iban === 'TBC') fields.push('iban');
    if (company.swift_bic === 'TBC') fields.push('swift_bic');
    if (company.qfzp_elected === 'TBC') fields.push('qfzp_elected');
  }
  return fields;
}

function buildFzcoCtDetail(
  ctRegistered: boolean | 'TBC',
  qfzpElected: boolean | 'TBC' | null,
): string {
  const parts: string[] = [];
  if (ctRegistered === 'TBC') {
    parts.push('`ct_registered` is still TBC');
  }
  if (qfzpElected === 'TBC') {
    parts.push('`qfzp_elected` is still TBC');
  }
  const joined = parts.join(' and ');
  return `${joined} — the UAE CT auto-seeder emits zero obligations until both are resolved, so the UAE tax panel will display nothing even when income is flowing.`;
}

interface RenewalWindow {
  readonly nextRenewalIso: string;
  readonly daysUntil: number;
}

function computeIfzaRenewalWindow(
  formationDate: string | null,
  today: Date,
): RenewalWindow | null {
  if (formationDate === null || formationDate === 'TBC') return null;
  const formed = parseIsoDate(formationDate);
  if (formed === null) return null;

  // Annual renewal: find the next anniversary of formation_date on or
  // after today (handles expiries with negative daysUntil so the
  // caller can escalate severity).
  const todayUtc = toUtcMidnight(today);
  let renewal = new Date(Date.UTC(
    todayUtc.getUTCFullYear(),
    formed.getUTCMonth(),
    formed.getUTCDate(),
  ));
  if (renewal.getTime() < todayUtc.getTime()) {
    renewal = new Date(Date.UTC(
      todayUtc.getUTCFullYear() + 1,
      formed.getUTCMonth(),
      formed.getUTCDate(),
    ));
  }
  const daysUntil = Math.round((renewal.getTime() - todayUtc.getTime()) / MS_PER_DAY);

  return {
    nextRenewalIso: formatIsoDate(renewal),
    daysUntil,
  };
}

function parseIsoDate(iso: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (match === null) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return date;
}

function toUtcMidnight(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function formatIsoDate(date: Date): string {
  const y = date.getUTCFullYear().toString().padStart(4, '0');
  const m = (date.getUTCMonth() + 1).toString().padStart(2, '0');
  const d = date.getUTCDate().toString().padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function formatAed(amount: number): string {
  return new Intl.NumberFormat('en-AE', { maximumFractionDigits: 0 }).format(amount);
}

// Convenience type re-export for the route layer.
export type { WarningSeverity };
