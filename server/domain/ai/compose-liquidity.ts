/**
 * §2.0.E AI liquidity slice — canonical {@link AccountBalance} map plus the
 * same `liquidityOverview` + `taxLiabilities` primitives as the dashboard
 * summary (no second balance projection).
 */

import { todayIsoLocal } from '../../../shared/iso-date.js';
import type { AccountName, AiLiquidityResponse } from '../../../shared/api-contracts.js';
import { AiLiquidityResponseSchema } from '../../../shared/api-contracts.js';
import { allAccountBalancesForApi } from '../accounts/balance-for-api.js';
import { buildLiquidityOverview } from '../accounts/liquidity-overview.js';
import { buildLiquidityCommitments } from '../accounts/liquidity-commitments.js';
import { accountsForEntity, validateAccount } from '../accounts/queries.js';
import { allEntityIds } from '../company/queries.js';
import { getAllAccountBalances, getAvailableFinancialYears, getTaxLiabilities, resolveFinancialYearForTax } from '../../db/index.js';

export interface ComposeAiLiquidityOpts {
  readonly account?: string;
  readonly financialYear?: string;
  readonly groupByEntity?: boolean;
}

export function composeAiLiquidity(opts: ComposeAiLiquidityOpts = {}): AiLiquidityResponse {
  const today = todayIsoLocal();
  const selectedAccount = validateAccount(opts.account);
  const financialYears = getAvailableFinancialYears();
  const selectedFY = opts.financialYear ?? (financialYears.length > 0 ? financialYears[0] : undefined);

  const allBalances = getAllAccountBalances();
  const balances = allAccountBalancesForApi(allBalances);
  const liquidityOverview = buildLiquidityOverview(allBalances);
  const liquidityCommitments = buildLiquidityCommitments({
    todayIso: today,
    totalCashGbp: liquidityOverview.totalCashGbp,
  });
  const taxLiabilities = getTaxLiabilities({
    account: selectedAccount,
    financialYear: resolveFinancialYearForTax(selectedFY),
  });

  let byEntity: AiLiquidityResponse['byEntity'];
  if (opts.groupByEntity === true) {
    const map = {} as NonNullable<AiLiquidityResponse['byEntity']>;
    for (const eid of allEntityIds()) {
      const names = accountsForEntity(eid);
      const entBalances: AiLiquidityResponse['balances'] = {};
      for (const n of names) {
        const row = balances[n];
        if (row !== undefined) {
          entBalances[n] = row;
        }
      }
      map[eid] = {
        entityId: eid,
        accountNames: [...names] as AccountName[],
        balances: entBalances,
      };
    }
    byEntity = map;
  }

  return AiLiquidityResponseSchema.parse({
    today,
    balances,
    liquidityOverview,
    liquidityCommitments,
    taxLiabilities,
    byEntity,
  });
}
