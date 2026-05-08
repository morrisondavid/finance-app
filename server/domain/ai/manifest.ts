import type { AiManifestResponse } from '../../../shared/api-contracts.js';
import { AiManifestResponseSchema } from '../../../shared/api-contracts.js';
import { AI_MANIFEST_SCHEMA_VERSION } from './constants.js';

const STATIC: AiManifestResponse = {
  schemaVersion: AI_MANIFEST_SCHEMA_VERSION,
  description:
    '§2.0 AI slice manifest — HTTP paths and Zod export names from shared/api-contracts.ts',
  slices: [
    {
      method: 'GET',
      path: '/api/ai/liquidity',
      queryParams: ['account', 'financialYear', 'groupByEntity'],
      responseSchemaExport: 'AiLiquidityResponseSchema',
    },
    {
      method: 'GET',
      path: '/api/ai/pipeline',
      queryParams: ['days', 'entityId'],
      responseSchemaExport: 'AiPipelineResponseSchema',
    },
    {
      method: 'GET',
      path: '/api/ai/runway',
      queryParams: ['days', 'entityId', 'detail'],
      responseSchemaExport: 'RunwayResponseSchema',
    },
    {
      method: 'GET',
      path: '/api/ai/snapshot',
      queryParams: [
        'days',
        'entityId',
        'detail',
        'account',
        'financialYear',
        'groupByEntity',
      ],
      responseSchemaExport: 'AiSnapshotResponseSchema',
    },
    {
      method: 'GET',
      path: '/api/ai/financial-snapshot',
      queryParams: [
        'days',
        'entityId',
        'detail',
        'account',
        'financialYear',
        'groupByEntity',
        'commitmentDays',
      ],
      responseSchemaExport: 'AiFinancialSnapshotResponseSchema',
    },
    {
      method: 'GET',
      path: '/api/ai/financial-safety',
      queryParams: [
        'days',
        'entityId',
        'detail',
        'account',
        'financialYear',
        'groupByEntity',
        'commitmentDays',
      ],
      responseSchemaExport: 'AiFinancialSafetyResponseSchema',
    },
    {
      method: 'GET',
      path: '/api/ai/net-worth-history',
      queryParams: [],
      responseSchemaExport: 'AiNetWorthHistoryResponseSchema',
    },
    {
      method: 'GET',
      path: '/api/ai/entity-liquidity-fx',
      queryParams: [],
      responseSchemaExport: 'AiEntityLiquidityFxResponseSchema',
    },
    {
      method: 'GET',
      path: '/api/ai/spend-by-currency',
      queryParams: ['calendarMonth', 'financialYear', 'entityId', 'account'],
      responseSchemaExport: 'AiSpendByCurrencyResponseSchema',
    },
    {
      method: 'GET',
      path: '/api/ai/manifest',
      queryParams: [],
      responseSchemaExport: 'AiManifestResponseSchema',
    },
    {
      method: 'GET',
      path: '/api/ai/warnings',
      queryParams: [],
      responseSchemaExport: 'EntityFoundationWarningsResponseSchema',
    },
    {
      method: 'GET',
      path: '/api/ai/income-composition',
      queryParams: [],
      responseSchemaExport: 'IncomeCompositionResponseSchema',
    },
    {
      method: 'GET',
      path: '/api/ai/debt-strategy',
      queryParams: [],
      responseSchemaExport: 'DebtStrategyStateResponseSchema',
    },
    {
      method: 'GET',
      path: '/api/ai/spend-context',
      queryParams: [],
      responseSchemaExport: 'AiSpendContextResponseSchema',
    },
    {
      method: 'GET',
      path: '/api/expenses/overview',
      queryParams: [],
      responseSchemaExport: 'ExpensesSheetResponseSchema',
    },
    {
      method: 'GET',
      path: '/api/expenses/recurring',
      queryParams: ['account', 'financialYear'],
      responseSchemaExport: 'RecurringExpensesResponseSchema',
    },
    {
      method: 'GET',
      path: '/api/expenses/ad-hoc',
      queryParams: ['account', 'financialYear', 'min', 'limit'],
      responseSchemaExport: 'AdHocExpensesResponseSchema',
    },
    {
      method: 'GET',
      path: '/api/contracts/expected-receipts',
      queryParams: ['days', 'entityId'],
      responseSchemaExport: 'ExpectedReceiptsResponseSchema',
    },
  ],
  contractSchemaExports: [
    'AccountBalanceSchema',
    'AdHocExpensesResponseSchema',
    'AiEntityLiquidityFxResponseSchema',
    'AiFinancialSafetyResponseSchema',
    'AiFinancialSnapshotResponseSchema',
    'AiLiquidityResponseSchema',
    'AiManifestResponseSchema',
    'AiNetWorthHistoryResponseSchema',
    'AiPipelineRowSchema',
    'AiPipelineResponseSchema',
    'AiSnapshotResponseSchema',
    'AiSpendByCurrencyPeriodSchema',
    'AiSpendByCurrencyResponseSchema',
    'AiSpendContextResponseSchema',
    'DebtStrategyStateResponseSchema',
    'EntityFoundationWarningsResponseSchema',
    'ExpectedReceiptRowSchema',
    'ExpectedReceiptsResponseSchema',
    'ExpensesSheetResponseSchema',
    'IncomeCompositionResponseSchema',
    'LiquidityCommitmentsOverviewSchema',
    'NetWorthSnapshotCaptureResponseSchema',
    'NetWorthSnapshotRowSchema',
    'ObligationRowSchema',
    'RecurringExpensesResponseSchema',
    'RunwayResponseSchema',
  ],
};

export function buildAiManifest(): AiManifestResponse {
  return AiManifestResponseSchema.parse(STATIC);
}

/** Stable JSON string for drift tests (no timestamps). */
export function aiManifestDriftFingerprint(): string {
  return JSON.stringify(STATIC);
}
