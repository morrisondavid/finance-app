/**
 * MCP tools that surface the same JSON payloads as canonical GET routes
 * implemented in `server/http/read/*` (shared Zod/domain with Express handlers).
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { ContractIdSchema, DashboardSummaryHttpQuerySchema, DashboardTransactionsRawQuerySchema } from '../../shared/api-contracts.js';
import type { JsonReadResult } from '../http/read/types.js';
import { readInvoiceDraftFromQuery, InvoiceDraftQuerySchema, readInvoiceList, readSupplierMonthGaps } from '../http/read/invoices.js';
import {
  ContractsExpectedReceiptsQuerySchema,
  readContractsRoot,
  readContractsIncomeAccrualAggregate,
  readContractsExpectedReceiptsFromQuery,
  readContractById,
  readContractIncomeAccrual,
  readContractLeave,
} from '../http/read/contracts.js';
import { readClientsList } from '../http/read/clients-read.js';
import { readCompanyList } from '../http/read/company-read.js';
import {
  readObligationsRegistry,
  readObligationsOverdue,
  readVatReconciliation,
  readUpcomingObligations,
  readUpcomingPaymentsMerged,
  readObligationsDismissals,
} from '../http/read/obligations-read.js';
import { readDeadlinesRoot, readDeadlinesFeedQuery, readDeadlineById } from '../http/read/deadlines-read.js';
import { readTaxVatPayments } from '../http/read/tax-read.js';
import {
  readWarningsConsolidatedFeed,
  readWarningsInterCompanyMovements,
} from '../http/read/warnings-read.js';
import {
  readDashboardSummaryFromQuery,
  readDashboardBalance,
  readDashboardAccounts,
  readDashboardFeedToolbarStateFromQuery,
  readDashboardCategoriesFromQuery,
  readDashboardTransactionsFromQuery,
} from '../http/read/dashboard.js';
import {
  readStatementYears,
  readStatementsIndexFromQuery,
  readStatementsQuarterCheck,
  readStatementLedgerAccounts,
  readStatementsForLedgerAccount,
  readStatementBulkInvoiceUploads,
} from '../http/read/statements-read.js';
import { ForecastHttpQuerySchema, readForecastFromQuery } from '../http/read/forecast-read.js';
import { HouseholdRunwayQuerySchema, readHouseholdRunwayFromQuery } from '../http/read/runway-read.js';
import {
  PublicHolidaysQuerySchema,
  readPublicHolidaysFromQuery,
} from '../http/read/public-holidays-read.js';
import { readApiVersion } from '../http/read/version-read.js';
import { readDebtsListFromQuery } from '../http/read/debts-read.js';
import { readDebtStrategyStateBundle } from '../http/read/debt-strategy-state-read.js';
import { readBudgetCategoryNames, readBudgetLinesFromQuery } from '../http/read/budgets-read.js';
import {
  readFixedExpensesAdHocFromQuery,
  readFixedExpensesAdHocSeriesFromQuery,
  readFixedExpensesOverview,
  readFixedExpensesRecurringFromQuery,
  readFixedExpensesSimulationExclusions,
  readFixedExpensesSnapshotFromQuery,
} from '../http/read/expenses-read.js';

/** Return shape for MCP tools that wrap `JsonReadResult` (success JSON or error body). */
export type HttpJsonReadMcpToolResult = {
  isError?: true;
  content: { type: 'text'; text: string }[];
  structuredContent?: Record<string, unknown>;
};

/** Maps JSON-read bodies onto MCP `structuredContent` (objects only — arrays/primitives omit). */
function structuredContentFromJsonBody(body: unknown): Record<string, unknown> | undefined {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return undefined;
  }
  const out: Record<string, unknown> = {};
  for (const key of Reflect.ownKeys(body)) {
    if (typeof key === 'string') {
      out[key] = Reflect.get(body, key);
    }
  }
  return out;
}

/** Maps a `JsonReadResult` from `server/http/read/*` into an MCP tool call result. */
export function httpJsonReadToMcpToolResult(r: JsonReadResult): HttpJsonReadMcpToolResult {
  if (!r.ok) {
    return {
      isError: true,
      content: [{ type: 'text' as const, text: JSON.stringify(r.body, null, 2) }],
    };
  }
  const structuredContent = structuredContentFromJsonBody(r.body);
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(r.body, null, 2) }],
    ...(structuredContent !== undefined ? { structuredContent } : {}),
  };
}

const ContractIdOnlySchema = z.object({
  contractId: ContractIdSchema,
});

const DashboardBalancePathSchema = z.object({
  account: z.string().min(1),
  financialYear: z.string().optional(),
});

const FeedToolbarQuerySchema = z.object({
  account: z.string().optional(),
});

const DashboardCategoriesHttpQuerySchema = z.object({
  account: z.string().optional(),
  financialYear: z.string().optional(),
});

const TaxVatPaymentsQuerySchema = z.object({
  financialYear: z.string().optional(),
});

const ObligationsRegistryQuerySchema = z.object({
  status: z.string().optional(),
  type: z.string().optional(),
  source: z.string().optional(),
  hideCompleted: z.union([z.boolean(), z.string()]).optional(),
  financialYear: z.string().optional(),
});

const DeadlineFeedMcpSchema = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
  excludeCompleted: z.union([z.boolean(), z.enum(['true', '1'])]).optional(),
});

const StatementsIndexMcpSchema = z.object({
  search: z.string().optional(),
  year: z.string().optional(),
  month: z.string().optional(),
  quarter: z.string().optional(),
});

const StatementQuarterSchema = z.object({
  quarter: z.string().min(1),
});

const StatementsAccountSchema = z.object({
  account: z.string().min(1),
});

const DebtsListMcpSchema = z.object({
  includeArchived: z.union([z.boolean(), z.enum(['true', 'false', '1'])]).optional(),
});

const BudgetLinesMcpSchema = z.object({
  account: z.string().optional(),
});

const FixedExpensesAdHocMcpSchema = z.object({
  account: z.string().optional(),
  financialYear: z.string().optional(),
  min: z.string().optional(),
  limit: z.string().optional(),
});

const FixedExpensesAdHocSeriesMcpSchema = z.object({
  account: z.string().min(1),
  financialYear: z.string().optional(),
  bucketKey: z.string().min(1),
});

const FixedExpensesRecurringMcpSchema = z.object({
  account: z.string().optional(),
  financialYear: z.string().optional(),
});

const FixedExpensesSnapshotMcpSchema = FixedExpensesAdHocMcpSchema.merge(FixedExpensesRecurringMcpSchema);
export function registerBankStatementsHttpJsonReadTools(server: McpServer): void {
  const reg = (
    names: string | readonly [canonical: string, legacy: string],
    description: string,
    inputSchemaShape: Record<string, z.ZodTypeAny>,
    fn: (args: unknown) => HttpJsonReadMcpToolResult | Promise<HttpJsonReadMcpToolResult>,
  ): void => {
    const run = async (args: unknown) => fn(args ?? {});
    if (typeof names === 'string') {
      server.registerTool(names, { description, inputSchema: inputSchemaShape }, run);
      return;
    }
    const [canonical, legacy] = names;
    server.registerTool(
      canonical,
      {
        description: `${description} **Preferred MCP identifier.** Legacy alias \`${legacy}\` is deprecated.`,
        inputSchema: inputSchemaShape,
      },
      run,
    );
    server.registerTool(
      legacy,
      {
        description: `**Deprecated.** Prefer \`${canonical}\`. ${description}`,
        inputSchema: inputSchemaShape,
      },
      run,
    );
  };

  reg(['invoices_list', 'get_http_invoices'], 'GET /api/invoices parity (list)', {}, () =>
    httpJsonReadToMcpToolResult(readInvoiceList()),
  );

  reg(['invoices_get_draft', 'get_http_invoice_draft'], 'GET /api/invoices/draft parity', InvoiceDraftQuerySchema.shape, raw =>
    httpJsonReadToMcpToolResult(readInvoiceDraftFromQuery(raw as Record<string, unknown>)),
  );

  reg(
    ['invoices_get_supplier_month_gaps', 'get_http_invoice_supplier_month_gaps'],
    'GET /api/invoices/supplier-month-gaps parity',
    {},
    () => httpJsonReadToMcpToolResult(readSupplierMonthGaps()),
  );

  reg(['contracts_list', 'get_http_contracts'], 'GET /api/contracts parity', {}, () =>
    httpJsonReadToMcpToolResult(readContractsRoot()),
  );

  reg(
    ['contracts_get_income_accrual_aggregate', 'get_http_contracts_income_accrual'],
    'GET /api/contracts/income-accrual (aggregate)',
    {},
    () => httpJsonReadToMcpToolResult(readContractsIncomeAccrualAggregate()),
  );

  reg(
    ['contracts_get_expected_receipts', 'get_http_contracts_expected_receipts'],
    'GET /api/contracts/expected-receipts parity',
    ContractsExpectedReceiptsQuerySchema.shape,
    raw =>
      httpJsonReadToMcpToolResult(
        readContractsExpectedReceiptsFromQuery(raw as Record<string, unknown>),
      ),
  );

  reg(['contracts_get', 'get_http_contract_by_id'], 'GET /api/contracts/:id parity', ContractIdOnlySchema.shape, raw => {
    const parsed = ContractIdOnlySchema.safeParse(raw);
    if (!parsed.success) {
      return {
        isError: true,
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({ error: 'invalid-params', issues: parsed.error.issues }, null, 2),
          },
        ],
      };
    }
    return httpJsonReadToMcpToolResult(readContractById(parsed.data.contractId));
  });

  reg(
    ['contracts_get_income_accrual', 'get_http_contract_income_accrual'],
    'GET /api/contracts/:id/income-accrual parity',
    ContractIdOnlySchema.shape,
    raw => {
      const parsed = ContractIdOnlySchema.safeParse(raw);
      if (!parsed.success) {
        return {
          isError: true,
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({ error: 'invalid-params', issues: parsed.error.issues }, null, 2),
            },
          ],
        };
      }
      return httpJsonReadToMcpToolResult(readContractIncomeAccrual(parsed.data.contractId));
    },
  );

  reg(['contracts_list_leave', 'get_http_contract_leave'], 'GET /api/contracts/:id/leave parity', ContractIdOnlySchema.shape, raw => {
    const parsed = ContractIdOnlySchema.safeParse(raw);
    if (!parsed.success) {
      return {
        isError: true,
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({ error: 'invalid-params', issues: parsed.error.issues }, null, 2),
          },
        ],
      };
    }
    return httpJsonReadToMcpToolResult(readContractLeave(parsed.data.contractId));
  });

  reg(['clients_list', 'get_http_clients'], 'GET /api/clients parity', {}, () => httpJsonReadToMcpToolResult(readClientsList()));

  reg(['companies_list', 'get_http_companies'], 'GET /api/company parity', {}, () =>
    httpJsonReadToMcpToolResult(readCompanyList()),
  );

  reg(
    ['financial_obligations_list', 'get_http_obligations'],
    'GET /api/obligations registry parity',
    ObligationsRegistryQuerySchema.shape,
    raw =>
      httpJsonReadToMcpToolResult(
        readObligationsRegistry(raw as Record<string, unknown>),
      ),
  );

  reg(['financial_obligations_list_overdue', 'get_http_obligations_overdue'], 'GET /api/obligations/overdue parity', {}, () =>
    httpJsonReadToMcpToolResult(readObligationsOverdue()),
  );

  reg(
    ['financial_obligations_get_vat_reconciliation', 'get_http_obligations_vat_reconciliation'],
    'GET /api/obligations/vat-reconciliation parity',
    z.object({ financialYear: z.string().optional() }).shape,
    raw => httpJsonReadToMcpToolResult(readVatReconciliation(raw as Record<string, unknown>)),
  );

  reg(
    ['financial_obligations_list_upcoming', 'get_http_obligations_upcoming'],
    'GET /api/obligations/upcoming parity',
    z.object({ days: z.coerce.number().int().positive().optional() }).shape,
    raw => httpJsonReadToMcpToolResult(readUpcomingObligations(raw as Record<string, unknown>)),
  );

  reg(
    ['financial_obligations_list_upcoming_payments', 'get_http_obligations_upcoming_payments'],
    'GET /api/obligations/upcoming-payments parity',
    z.object({ days: z.coerce.number().int().positive().optional() }).shape,
    raw => httpJsonReadToMcpToolResult(readUpcomingPaymentsMerged(raw as Record<string, unknown>)),
  );

  reg(['financial_obligations_list_dismissals', 'get_http_obligations_dismissals'], 'GET /api/obligations/dismissals parity', {}, () =>
    httpJsonReadToMcpToolResult(readObligationsDismissals()),
  );

  reg(['deadlines_list', 'get_http_deadlines'], 'GET /api/deadlines parity', {}, () =>
    httpJsonReadToMcpToolResult(readDeadlinesRoot()),
  );

  reg(['deadlines_get_feed', 'get_http_deadlines_feed'], 'GET /api/deadlines/feed parity', DeadlineFeedMcpSchema.shape, raw =>
    httpJsonReadToMcpToolResult(readDeadlinesFeedQuery(raw as Record<string, unknown>)),
  );

  reg(
    ['deadlines_get', 'get_http_deadline'],
    'GET /api/deadlines/:id parity',
    z.object({ id: z.string().min(1) }).shape,
    raw => {
      const parsed = z.object({ id: z.string().min(1) }).safeParse(raw);
      if (!parsed.success) {
        return {
          isError: true,
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({ error: 'invalid-params', issues: parsed.error.issues }, null, 2),
            },
          ],
        };
      }
      return httpJsonReadToMcpToolResult(readDeadlineById(parsed.data.id));
    },
  );

  reg(
    ['tax_get_vat_payments', 'get_http_tax_vat_payments'],
    'GET /api/tax/vat-payments parity',
    TaxVatPaymentsQuerySchema.shape,
    raw => {
      const parsed = TaxVatPaymentsQuerySchema.safeParse(raw ?? {});
      if (!parsed.success) {
        return {
          isError: true,
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({ error: 'invalid-params', issues: parsed.error.issues }, null, 2),
            },
          ],
        };
      }
      return httpJsonReadToMcpToolResult(readTaxVatPayments(parsed.data));
    },
  );

  reg(
    ['warnings_get_consolidated', 'get_http_warnings_consolidated'],
    'GET /api/warnings/all parity. Same consolidated composer as MCP resource bankstatements://ai/warnings; prefer one surface for AI agents.',
    {},
    () => httpJsonReadToMcpToolResult(readWarningsConsolidatedFeed()),
  );

  reg(
    ['warnings_get_entity_foundation', 'get_http_warnings_entity_foundation'],
    'GET /api/warnings/entity-foundation parity (legacy path; same payload as GET /api/warnings/all and get_http_warnings_consolidated).',
    {},
    () => httpJsonReadToMcpToolResult(readWarningsConsolidatedFeed()),
  );

  reg(
    ['warnings_get_inter_company_movements', 'get_http_warnings_inter_company_movements'],
    'GET /api/warnings/inter-company-movements parity',
    {},
    () => httpJsonReadToMcpToolResult(readWarningsInterCompanyMovements()),
  );

  reg(
    ['dashboard_get_summary', 'get_http_dashboard_summary'],
    'GET /api/dashboard/summary parity',
    DashboardSummaryHttpQuerySchema.shape,
    raw => {
      const parsed = DashboardSummaryHttpQuerySchema.safeParse(raw ?? {});
      if (!parsed.success) {
        return {
          isError: true,
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({ error: 'invalid-params', issues: parsed.error.issues }, null, 2),
            },
          ],
        };
      }
      return httpJsonReadToMcpToolResult(readDashboardSummaryFromQuery(parsed.data));
    },
  );

  reg(
    ['dashboard_get_balance', 'get_http_dashboard_balance'],
    'GET /api/dashboard/balance/:account parity',
    DashboardBalancePathSchema.shape,
    raw => {
      const parsed = DashboardBalancePathSchema.safeParse(raw);
      if (!parsed.success) {
        return {
          isError: true,
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({ error: 'invalid-params', issues: parsed.error.issues }, null, 2),
            },
          ],
        };
      }
      const { account, financialYear } = parsed.data;
      return httpJsonReadToMcpToolResult(readDashboardBalance(account, { financialYear }));
    },
  );

  reg(
    ['dashboard_list_accounts', 'get_http_dashboard_accounts'],
    'GET /api/dashboard/accounts parity',
    {},
    () => httpJsonReadToMcpToolResult(readDashboardAccounts()),
  );

  reg(
    ['dashboard_get_feed_toolbar_state', 'get_http_dashboard_feed_toolbar_state'],
    'GET /api/dashboard/feed-toolbar-state parity',
    FeedToolbarQuerySchema.shape,
    raw => {
      const parsed = FeedToolbarQuerySchema.safeParse(raw ?? {});
      if (!parsed.success) {
        return {
          isError: true,
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({ error: 'invalid-params', issues: parsed.error.issues }, null, 2),
            },
          ],
        };
      }
      return httpJsonReadToMcpToolResult(readDashboardFeedToolbarStateFromQuery(parsed.data));
    },
  );

  reg(
    ['dashboard_list_categories', 'get_http_dashboard_categories'],
    'GET /api/dashboard/categories parity',
    DashboardCategoriesHttpQuerySchema.shape,
    raw => {
      const parsed = DashboardCategoriesHttpQuerySchema.safeParse(raw ?? {});
      if (!parsed.success) {
        return {
          isError: true,
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({ error: 'invalid-params', issues: parsed.error.issues }, null, 2),
            },
          ],
        };
      }
      return httpJsonReadToMcpToolResult(readDashboardCategoriesFromQuery(parsed.data));
    },
  );

  reg(
    ['dashboard_list_transactions', 'get_http_dashboard_transactions'],
    'GET /api/dashboard/transactions parity',
    DashboardTransactionsRawQuerySchema.shape,
    raw =>
      httpJsonReadToMcpToolResult(
        readDashboardTransactionsFromQuery(raw as Record<string, unknown>),
      ),
  );

  reg(['statements_list_years', 'get_http_statements_years'], 'GET /api/statements/years parity', {}, () =>
    httpJsonReadToMcpToolResult(readStatementYears()),
  );

  reg(
    ['statements_list', 'get_http_statements_index'],
    'GET /api/statements parity (indexed list)',
    StatementsIndexMcpSchema.shape,
    raw => httpJsonReadToMcpToolResult(readStatementsIndexFromQuery(raw as Record<string, unknown>)),
  );

  reg(
    ['statements_check_quarter', 'get_http_statements_quarter_check'],
    'GET /api/statements/check-quarter parity',
    StatementQuarterSchema.shape,
    raw => {
      const parsed = StatementQuarterSchema.safeParse(raw);
      if (!parsed.success) {
        return {
          isError: true,
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({ error: 'invalid-params', issues: parsed.error.issues }, null, 2),
            },
          ],
        };
      }
      return httpJsonReadToMcpToolResult(readStatementsQuarterCheck(parsed.data.quarter));
    },
  );

  reg(
    ['statements_list_accounts', 'get_http_statements_accounts'],
    'GET /api/statements/accounts parity',
    {},
    () => httpJsonReadToMcpToolResult(readStatementLedgerAccounts()),
  );

  reg(
    ['statements_list_by_account', 'get_http_statements_by_account'],
    'GET /api/statements/:account parity',
    StatementsAccountSchema.shape,
    raw => {
      const parsed = StatementsAccountSchema.safeParse(raw);
      if (!parsed.success) {
        return {
          isError: true,
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({ error: 'invalid-params', issues: parsed.error.issues }, null, 2),
            },
          ],
        };
      }
      return httpJsonReadToMcpToolResult(readStatementsForLedgerAccount(parsed.data.account));
    },
  );

  reg(
    ['statements_list_invoice_uploads', 'get_http_statement_invoice_uploads_list'],
    'GET /api/statements/invoices/list parity (bulk uploads directory)',
    {},
    () => httpJsonReadToMcpToolResult(readStatementBulkInvoiceUploads()),
  );

  reg(['forecast_get', 'get_http_forecast'], 'GET /api/forecast parity', ForecastHttpQuerySchema.shape, raw =>
    httpJsonReadToMcpToolResult(readForecastFromQuery(raw as Record<string, unknown>)),
  );

  reg(
    ['runway_get', 'get_http_runway'],
    'GET /api/runway parity (distinct payload from MCP get_ai_runway / GET /api/ai/runway)',
    HouseholdRunwayQuerySchema.shape,
    raw => httpJsonReadToMcpToolResult(readHouseholdRunwayFromQuery(raw as Record<string, unknown>)),
  );

  reg(
    ['public_holidays_list', 'get_http_public_holidays'],
    'GET /api/public-holidays parity',
    PublicHolidaysQuerySchema.shape,
    raw =>
      httpJsonReadToMcpToolResult(
        readPublicHolidaysFromQuery(raw as Record<string, unknown>),
      ),
  );

  reg(['app_get_version', 'get_http_version'], 'GET /api/version parity', {}, () =>
    httpJsonReadToMcpToolResult(readApiVersion()),
  );

  reg(
    'debts_list',
    'GET /api/debts list parity (summaries). **Canonical read** — no legacy `get_http_*` mirror was shipped for this route.',
    DebtsListMcpSchema.shape,
    raw => {
      const parsed = DebtsListMcpSchema.safeParse(raw ?? {});
      if (!parsed.success) {
        const issues = parsed.error.issues;
        return {
          isError: true,
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({ error: 'invalid-params', issues }, null, 2),
            },
          ],
        };
      }
      return httpJsonReadToMcpToolResult(
        readDebtsListFromQuery(parsed.data as Record<string, unknown>),
      );
    },
  );

  reg(
    'debt_strategy_get_state',
    'GET /api/debt-strategy/state parity (§1.9 bundle). **Canonical read** — mirrors the same JSON as `composeAiDebtStrategyState` / GET /api/ai/debt-strategy.',
    {},
    () => httpJsonReadToMcpToolResult(readDebtStrategyStateBundle()),
  );

  reg(
    'budgets_get_category_names',
    'GET /api/budgets/category-names parity. **Canonical read** — expense category vocabulary for budget lines.',
    {},
    () => httpJsonReadToMcpToolResult(readBudgetCategoryNames()),
  );

  reg(
    'budgets_list_lines',
    'GET /api/budgets parity (list rows for optional `account`; defaults like HTTP).',
    BudgetLinesMcpSchema.shape,
    raw => {
      const parsed = BudgetLinesMcpSchema.safeParse(raw ?? {});
      if (!parsed.success) {
        return {
          isError: true,
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({ error: 'invalid-params', issues: parsed.error.issues }, null, 2),
            },
          ],
        };
      }
      return httpJsonReadToMcpToolResult(readBudgetLinesFromQuery(parsed.data));
    },
  );

  reg(
    'fixed_expenses_get_overview',
    'GET /api/expenses/overview parity (fixed-expense sheet rollup).',
    {},
    () => httpJsonReadToMcpToolResult(readFixedExpensesOverview()),
  );

  reg(
    'fixed_expenses_get_simulation_exclusions',
    'GET /api/expenses/simulation-exclusions parity.',
    {},
    () => httpJsonReadToMcpToolResult(readFixedExpensesSimulationExclusions()),
  );

  reg(
    'fixed_expenses_list_ad_hoc',
    'GET /api/expenses/ad-hoc parity. Provide `account`; other fields optional.',
    FixedExpensesAdHocMcpSchema.shape,
    raw =>
      httpJsonReadToMcpToolResult(
        readFixedExpensesAdHocFromQuery(raw as Record<string, string | undefined>),
      ),
  );

  reg(
    'fixed_expenses_get_ad_hoc_series',
    'GET /api/expenses/ad-hoc/series parity. Requires `account` + `bucketKey`.',
    FixedExpensesAdHocSeriesMcpSchema.shape,
    raw => {
      const parsed = FixedExpensesAdHocSeriesMcpSchema.safeParse(raw ?? {});
      if (!parsed.success) {
        return {
          isError: true,
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({ error: 'invalid-params', issues: parsed.error.issues }, null, 2),
            },
          ],
        };
      }
      return httpJsonReadToMcpToolResult(readFixedExpensesAdHocSeriesFromQuery(parsed.data));
    },
  );

  reg(
    'fixed_expenses_list_recurring',
    'GET /api/expenses/recurring parity.',
    FixedExpensesRecurringMcpSchema.shape,
    raw =>
      httpJsonReadToMcpToolResult(
        readFixedExpensesRecurringFromQuery(raw as Record<string, string | undefined>),
      ),
  );

  reg(
    'fixed_expenses_snapshot',
    'Composite MCP read: overview + simulation exclusions + recurring + ad-hoc summary (same builders as GET /api/expenses/*). Optional `GET /api/expenses/snapshot` exists for the same payload.',
    FixedExpensesSnapshotMcpSchema.shape,
    raw =>
      httpJsonReadToMcpToolResult(
        readFixedExpensesSnapshotFromQuery(raw as Record<string, string | undefined>),
      ),
  );
}

