/**
 * GET /api/ai/available-funds — liquidity overview, expected receipts (after-tax
 * retained), and scoped committed outflows on a 3/6/12-month window.
 */

import type {
  AiAvailableFundsResponse,
  AiFutureIncomeContract,
  AiFutureIncomeMonth,
  AiLastContractPayment,
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
import { buildExpectedReceipts } from '../contracts/expected-receipts.js';
import { loadForecastInputs } from '../forecast/load-inputs.js';
import { round2 } from '../../utils/math.js';
import { AI_MANIFEST_SCHEMA_VERSION } from './constants.js';

export interface ComposeAiAvailableFundsOpts {
  readonly months?: number;
  readonly filterEntityId?: EntityId;
}

function entityForReceipt(
  receipt: ExpectedReceiptRow,
  contractById: ReadonlyMap<string, Contract>,
  invoiceById: ReadonlyMap<string, Invoice>,
): EntityId | null {
  if (receipt.contractId !== null) {
    const contract = contractById.get(receipt.contractId);
    return contract?.issuing_entity_id ?? null;
  }
  if (receipt.invoiceId !== null) {
    const invoice = invoiceById.get(receipt.invoiceId);
    return invoice?.issuing_entity_id ?? null;
  }
  return null;
}

function receiptLabel(
  receipt: ExpectedReceiptRow,
  labelByContractId: ReadonlyMap<string, string>,
): string {
  if (receipt.contractId !== null) {
    return labelByContractId.get(receipt.contractId) ?? receipt.contractId;
  }
  if (receipt.invoiceId !== null) {
    return `Invoice ${receipt.invoiceId}`;
  }
  return 'Other income';
}

interface ContractAccum {
  label: string;
  reference: string;
  contractEndDate: string | null;
  totalGbp: number;
  nativeSum: number;
  nativeCurrency: ExpectedReceiptRow['currency'] | null;
  monthly: Map<string, number>;
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
  const labelByContractId = new Map<string, string>();
  for (const contract of loaded.contracts) {
    contractById.set(contract.id, contract);
    labelByContractId.set(contract.id, contract.reference);
  }

  const invoiceById = new Map<string, Invoice>();
  for (const invoice of loaded.unpaidInvoices) {
    invoiceById.set(invoice.id, invoice);
  }

  const allFutureReceipts = receipts.receipts.filter(r => r.expectedDate >= today);
  const futureIncome = allFutureReceipts.filter(r => r.expectedDate <= projectionEndDate);

  let confirmedFutureIncomeGrossGbp = 0;
  const monthTotals = new Map<string, number>();
  const contractTotals = new Map<string, ContractAccum>();
  const entityNetGbp = new Map<EntityId, number>();

  for (const r of futureIncome) {
    const gbp = convertAmountSync(r.amount, r.currency, 'GBP');
    confirmedFutureIncomeGrossGbp += gbp;

    const entityId = entityForReceipt(r, contractById, invoiceById);
    if (entityId !== null) {
      entityNetGbp.set(entityId, (entityNetGbp.get(entityId) ?? 0) + gbp);
    }

    const monthKey = r.expectedDate.slice(0, 7);
    monthTotals.set(monthKey, (monthTotals.get(monthKey) ?? 0) + gbp);

    const contractKey = r.contractId ?? '__none__';
    const contract = r.contractId !== null ? contractById.get(r.contractId) : undefined;
    const reference = contract?.reference ?? 'Other income';
    const label = r.contractId !== null ? labelByContractId.get(r.contractId) ?? r.contractId : 'Other income';
    const existing = contractTotals.get(contractKey);
    if (existing === undefined) {
      contractTotals.set(contractKey, {
        label,
        reference,
        contractEndDate: contract?.end_date ?? null,
        totalGbp: gbp,
        nativeSum: r.amount,
        nativeCurrency: r.currency,
        monthly: new Map([[monthKey, gbp]]),
      });
    } else {
      existing.totalGbp += gbp;
      if (existing.nativeCurrency === r.currency) {
        existing.nativeSum += r.amount;
      } else {
        existing.nativeCurrency = null;
        existing.nativeSum = 0;
      }
      existing.monthly.set(monthKey, (existing.monthly.get(monthKey) ?? 0) + gbp);
    }
  }
  confirmedFutureIncomeGrossGbp = round2(confirmedFutureIncomeGrossGbp);

  let confirmedFutureIncomeRetainedGbp = 0;
  let futureIncomeVatReserveGbp = 0;
  let futureIncomeCtReserveGbp = 0;

  for (const [entityId, netGbp] of entityNetGbp) {
    const company = companyById(entityId);
    if (company === null) {
      confirmedFutureIncomeRetainedGbp += netGbp;
      continue;
    }
    const claim = calculateRetainedReserves(netGbp, company);
    confirmedFutureIncomeRetainedGbp += claim.retained_period;
    futureIncomeVatReserveGbp += claim.vat_reserve_period;
    futureIncomeCtReserveGbp += claim.ct_reserve_period;
  }

  const unassignedGross = round2(
    confirmedFutureIncomeGrossGbp - [...entityNetGbp.values()].reduce((s, v) => s + v, 0),
  );
  if (unassignedGross > 0) {
    confirmedFutureIncomeRetainedGbp += unassignedGross;
  }

  confirmedFutureIncomeRetainedGbp = round2(confirmedFutureIncomeRetainedGbp);
  futureIncomeVatReserveGbp = round2(futureIncomeVatReserveGbp);
  futureIncomeCtReserveGbp = round2(futureIncomeCtReserveGbp);

  const futureIncomeByMonth: AiFutureIncomeMonth[] = [...monthTotals.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([month, amount]) => ({ month, amountGbp: round2(amount) }));

  const futureIncomeByContract: AiFutureIncomeContract[] = [...contractTotals.entries()]
    .map(([contractKey, v]) => {
      const contract = contractKey !== '__none__' ? contractById.get(contractKey) : undefined;
      let impliedWorkingDays: number | null = null;
      if (
        contract !== undefined
        && contract.day_rate > 0
        && v.nativeCurrency === contract.day_rate_currency
        && v.nativeSum > 0
      ) {
        impliedWorkingDays = Math.round(v.nativeSum / contract.day_rate);
      }
      const grossGbp = round2(v.totalGbp);
      let retainedGbp = grossGbp;
      if (contract !== undefined) {
        const company = companyById(contract.issuing_entity_id);
        if (company !== null) {
          retainedGbp = round2(calculateRetainedReserves(grossGbp, company).retained_period);
        }
      }
      return {
        contractId: contractKey === '__none__' ? null : contractKey,
        label: v.label,
        reference: v.reference,
        contractEndDate: v.contractEndDate,
        impliedWorkingDays,
        totalGbp: grossGbp,
        retainedGbp,
        monthly: [...v.monthly.entries()]
          .sort((a, b) => a[0].localeCompare(b[0]))
          .map(([month, amount]) => ({ month, amountGbp: round2(amount) })),
      };
    })
    .sort((a, b) => b.totalGbp - a.totalGbp);

  const futureDates = futureIncome.map(r => r.expectedDate);
  const nextIncomeDate = futureDates.length > 0 ? futureDates.reduce((a, b) => (a <= b ? a : b)) : null;
  const lastConfirmedIncomeDate =
    futureDates.length > 0 ? futureDates.reduce((a, b) => (a >= b ? a : b)) : null;

  let lastContractPayment: AiLastContractPayment | null = null;
  if (allFutureReceipts.length > 0) {
    const last = allFutureReceipts.reduce((a, b) => (a.expectedDate >= b.expectedDate ? a : b));
    lastContractPayment = {
      date: last.expectedDate,
      amountGbp: round2(convertAmountSync(last.amount, last.currency, 'GBP')),
      label: receiptLabel(last, labelByContractId),
    };
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
    futureIncomeByContract,
    nextIncomeDate,
    lastConfirmedIncomeDate,
    committedOutflowsGbp,
    committedOutflows,
    totalFundsGbp,
    netAfterCommitmentsGbp,
    lastContractPayment,
  });
}
