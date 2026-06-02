/**
 * GET /api/ai/available-funds — liquidity overview, expected receipts (after-tax
 * retained), and scoped committed outflows on a 3/6/12-month window.
 */

import type {
  AiAvailableFundsResponse,
  AiFutureIncomeClient,
  AiFutureIncomeMonth,
  AiLastContractPayment,
  ClientId,
  Contract,
  EntityId,
  ExpectedReceiptRow,
  Invoice,
} from '../../../shared/api-contracts.js';
import { AiAvailableFundsResponseSchema } from '../../../shared/api-contracts.js';
import { isoDateAddCalendarMonths } from '../../../shared/iso-date.js';
import { calculateRetainedReserves } from '../../config/tax-rates.js';
import { convertAmountSync } from '../../config/exchange-rates.js';
import { getAllAccountBalances } from '../../db/repositories/balance.js';
import { buildLiquidityOverview } from '../accounts/liquidity-overview.js';
import { buildLiquidityCommitments } from '../accounts/liquidity-commitments.js';
import { companyById } from '../company/queries.js';
import { findClientById } from '../clients/queries.js';
import { findContractById } from '../contracts/queries.js';
import { buildExpectedReceipts } from '../contracts/expected-receipts.js';
import { loadForecastInputs } from '../forecast/load-inputs.js';
import { round2 } from '../../utils/math.js';
import { AI_MANIFEST_SCHEMA_VERSION } from './constants.js';

export interface ComposeAiAvailableFundsOpts {
  readonly months?: number;
  readonly filterEntityId?: EntityId;
}

const OTHER_CLIENT_KEY = '__none__';

function resolveContract(
  contractId: string,
  contractById: Map<string, Contract>,
): Contract | undefined {
  const cached = contractById.get(contractId);
  if (cached !== undefined) return cached;
  const found = findContractById(contractId);
  if (found === null) return undefined;
  contractById.set(found.id, found);
  return found;
}

/** Issued invoices are authoritative for entity when present. */
function entityForReceipt(
  receipt: ExpectedReceiptRow,
  contractById: Map<string, Contract>,
  invoiceById: ReadonlyMap<string, Invoice>,
): EntityId | null {
  if (receipt.invoiceId !== null) {
    const invoice = invoiceById.get(receipt.invoiceId);
    if (invoice !== undefined) return invoice.issuing_entity_id;
  }
  if (receipt.contractId !== null) {
    const contract = resolveContract(receipt.contractId, contractById);
    return contract?.issuing_entity_id ?? null;
  }
  return null;
}

function clientIdForReceipt(
  receipt: ExpectedReceiptRow,
  contractById: Map<string, Contract>,
  invoiceById: ReadonlyMap<string, Invoice>,
): ClientId | typeof OTHER_CLIENT_KEY {
  if (receipt.invoiceId !== null) {
    const invoice = invoiceById.get(receipt.invoiceId);
    if (invoice !== undefined) return invoice.client_id;
  }
  if (receipt.contractId !== null) {
    const contract = resolveContract(receipt.contractId, contractById);
    if (contract !== undefined) return contract.client_id;
  }
  return OTHER_CLIENT_KEY;
}

function clientLabelForClientId(clientId: ClientId | typeof OTHER_CLIENT_KEY): string {
  if (clientId === OTHER_CLIENT_KEY) return 'Other income';
  const client = findClientById(clientId);
  return client?.trading_name ?? clientId;
}

/**
 * Issued invoice receipts are already priced — count expected cash in full.
 * Uninvoiced accrual is net subtotal and still needs VAT/CT reserves applied.
 */
function retainedGbpForReceipt(
  receipt: ExpectedReceiptRow,
  cashGbp: number,
  entityId: EntityId | null,
): number {
  if (receipt.source === 'invoice-receipt') {
    return cashGbp;
  }
  if (entityId === null) return cashGbp;
  const company = companyById(entityId);
  if (company === null) return cashGbp;
  return round2(calculateRetainedReserves(cashGbp, company).retained_period);
}

interface ClientAccum {
  label: string;
  totalGbp: number;
  retainedGbp: number;
}

export function composeAiAvailableFunds(
  opts: ComposeAiAvailableFundsOpts = {},
): AiAvailableFundsResponse {
  const months = opts.months ?? 12;
  const longHorizonDays = Math.max(months * 31, 1830);
  const loaded = loadForecastInputs({
    horizonDays: longHorizonDays,
    filterEntityId: opts.filterEntityId,
  });

  const today = loaded.today;
  const projectionEndDate = isoDateAddCalendarMonths(today, months);

  const liquidity = buildLiquidityOverview(getAllAccountBalances());
  const availableNowGbp = liquidity.totalCashGbp;

  const receipts = buildExpectedReceipts({
    forecastInputs: loaded,
    projectToContractEnd: true,
  });

  const contractById = new Map<string, Contract>();
  for (const contract of loaded.contracts) {
    contractById.set(contract.id, contract);
  }

  const invoiceById = new Map<string, Invoice>();
  for (const invoice of loaded.unpaidInvoices) {
    invoiceById.set(invoice.id, invoice);
  }

  const allFutureReceipts = receipts.receipts.filter(r => r.expectedDate >= today);
  const futureIncome = allFutureReceipts.filter(r => r.expectedDate <= projectionEndDate);

  let confirmedFutureIncomeGrossGbp = 0;
  let invoiceCashGbp = 0;
  const monthTotals = new Map<string, number>();
  const clientTotals = new Map<string, ClientAccum>();
  const accrualEntityNetGbp = new Map<EntityId, number>();

  for (const r of futureIncome) {
    const gbp = convertAmountSync(r.amount, r.currency, 'GBP');
    confirmedFutureIncomeGrossGbp += gbp;

    const entityId = entityForReceipt(r, contractById, invoiceById);
    if (r.source === 'invoice-receipt') {
      invoiceCashGbp += gbp;
    } else if (entityId !== null) {
      accrualEntityNetGbp.set(entityId, (accrualEntityNetGbp.get(entityId) ?? 0) + gbp);
    }

    const monthKey = r.expectedDate.slice(0, 7);
    monthTotals.set(monthKey, (monthTotals.get(monthKey) ?? 0) + gbp);

    const clientKey = clientIdForReceipt(r, contractById, invoiceById);
    const label = clientLabelForClientId(clientKey);
    const retainedSlice = retainedGbpForReceipt(r, gbp, entityId);
    const existing = clientTotals.get(clientKey);
    if (existing === undefined) {
      clientTotals.set(clientKey, {
        label,
        totalGbp: gbp,
        retainedGbp: retainedSlice,
      });
    } else {
      existing.totalGbp += gbp;
      existing.retainedGbp += retainedSlice;
    }
  }
  confirmedFutureIncomeGrossGbp = round2(confirmedFutureIncomeGrossGbp);
  invoiceCashGbp = round2(invoiceCashGbp);

  let accrualRetainedGbp = 0;
  let futureIncomeVatReserveGbp = 0;
  let futureIncomeCtReserveGbp = 0;

  for (const [entityId, netGbp] of accrualEntityNetGbp) {
    const company = companyById(entityId);
    if (company === null) {
      accrualRetainedGbp += netGbp;
      continue;
    }
    const claim = calculateRetainedReserves(netGbp, company);
    accrualRetainedGbp += claim.retained_period;
    futureIncomeVatReserveGbp += claim.vat_reserve_period;
    futureIncomeCtReserveGbp += claim.ct_reserve_period;
  }

  const confirmedFutureIncomeRetainedGbp = round2(invoiceCashGbp + accrualRetainedGbp);
  futureIncomeVatReserveGbp = round2(futureIncomeVatReserveGbp);
  futureIncomeCtReserveGbp = round2(futureIncomeCtReserveGbp);

  const futureIncomeByMonth: AiFutureIncomeMonth[] = [...monthTotals.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([month, amount]) => ({ month, amountGbp: round2(amount) }));

  const futureIncomeByClient: AiFutureIncomeClient[] = [...clientTotals.entries()]
    .map(([clientKey, v]) => ({
      clientId: clientKey === OTHER_CLIENT_KEY ? null : clientKey,
      label: v.label,
      totalGbp: round2(v.totalGbp),
      retainedGbp: round2(v.retainedGbp),
    }))
    .sort((a, b) => b.totalGbp - a.totalGbp);

  const futureDates = futureIncome.map(r => r.expectedDate);
  const nextIncomeDate = futureDates.length > 0 ? futureDates.reduce((a, b) => (a <= b ? a : b)) : null;
  const lastConfirmedIncomeDate =
    futureDates.length > 0 ? futureDates.reduce((a, b) => (a >= b ? a : b)) : null;

  // The final contract payment is the single latest expected receipt: one
  // date, one client, the value of that payment. Receipts landing on the same
  // final date are summed (and only treated as one client when they agree).
  let lastContractPayment: AiLastContractPayment | null = null;
  if (futureIncome.length > 0) {
    const lastDate = futureIncome.reduce(
      (a, b) => (a.expectedDate >= b.expectedDate ? a : b),
    ).expectedDate;
    const lastReceipts = futureIncome.filter(r => r.expectedDate === lastDate);
    const amountGbp = round2(
      lastReceipts.reduce((s, r) => s + convertAmountSync(r.amount, r.currency, 'GBP'), 0),
    );
    const clientKeys = new Set(
      lastReceipts.map(r => clientIdForReceipt(r, contractById, invoiceById)),
    );
    const label = clientKeys.size === 1
      ? clientLabelForClientId([...clientKeys][0])
      : 'Multiple clients';
    lastContractPayment = { date: lastDate, amountGbp, label };
  }

  const committedOutflows = buildLiquidityCommitments({
    todayIso: today,
    totalCashGbp: availableNowGbp,
    months,
  });
  const committedOutflowsGbp = committedOutflows.totalCommittedGbp;

  const totalFundsGbp = round2(availableNowGbp + confirmedFutureIncomeRetainedGbp);
  const netAfterCommitmentsGbp = round2(totalFundsGbp - committedOutflowsGbp);

  const futureIncomeRows: ExpectedReceiptRow[] = futureIncome;

  return AiAvailableFundsResponseSchema.parse({
    generatedAt: new Date().toISOString(),
    schemaVersion: AI_MANIFEST_SCHEMA_VERSION,
    months,
    projectionEndDate,
    availableNowGbp,
    confirmedFutureIncomeGrossGbp,
    confirmedFutureIncomeRetainedGbp,
    futureIncomeVatReserveGbp,
    futureIncomeCtReserveGbp,
    futureIncome: futureIncomeRows,
    futureIncomeByMonth,
    futureIncomeByClient,
    futureIncomeByContract: futureIncomeByClient,
    nextIncomeDate,
    lastConfirmedIncomeDate,
    committedOutflowsGbp,
    committedOutflows,
    totalFundsGbp,
    netAfterCommitmentsGbp,
    lastContractPayment,
  });
}
