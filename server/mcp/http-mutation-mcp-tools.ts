/**
 * MCP tools mirroring canonical JSON mutating Express routes (`server/http/mutation/*`).
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  BudgetUpsertBodySchema,
  ContractIdSchema,
  DebtCreateBodySchema,
  DebtOpeningBalanceBodySchema,
  DebtUpdateBodySchema,
  LeaveRequestSchema,
  SimulationExclusionsPutBodySchema,
  TemplatePreviewRequestSchema,
} from '../../shared/api-contracts.js';
import {
  mutateContractBookLeave,
  mutateContractDeleteLeave,
  mutateContractLeavePreview,
} from '../http/mutation/contracts-leave.js';
import {
  InvoiceGenerateBodySchema,
  InvoiceReconcileBodySchema,
  mutateInvoiceGenerate,
  mutateInvoiceReconcile,
} from '../http/mutation/invoices.js';
import {
  mutateDebtsArchive,
  mutateDebtsCreate,
  mutateDebtsOpeningBalance,
  mutateDebtsUpdate,
} from '../http/mutation/debts.js';
import {
  DebtStrategyActivateSuggestedBodySchema,
  DebtStrategyCreatePlanBodySchema,
  DebtStrategyDismissMissedBodySchema,
  DebtStrategySandboxBodySchema,
  mutateDebtStrategyActivateSuggested,
  mutateDebtStrategyCreatePlan,
  mutateDebtStrategyMovementAcknowledge,
  mutateDebtStrategyMovementDismissMissed,
  mutateDebtStrategyPlanDelete,
  mutateDebtStrategyPlanPause,
  mutateDebtStrategyPlanResume,
  mutateDebtStrategySandbox,
} from '../http/mutation/debt-strategy.js';
import { mutateBudgetUpsert, mutateBudgetDelete } from '../http/mutation/budgets.js';
import { mutateSimulationExclusionsReplace } from '../http/mutation/expenses-simulation.js';
import type { JsonMutationResult } from '../http/mutation/types.js';
import { httpMutationToMcpToolResult } from './mcp-mutation-result.js';

const ContractLeaveBookMcpSchema = z
  .object({
    contractId: ContractIdSchema,
  })
  .merge(LeaveRequestSchema);

const ContractLeavePreviewMcpSchema = z
  .object({
    contractId: ContractIdSchema,
  })
  .merge(TemplatePreviewRequestSchema);

const ContractLeaveDeleteMcpSchema = z.object({
  contractId: ContractIdSchema,
  leaveId: z.string().min(1),
});

const DebtIdBodySchema = z.object({
  debtId: z.string().min(1),
});

const DebtUpdateMcpSchema = DebtIdBodySchema.merge(DebtUpdateBodySchema);

const DebtOpeningBalanceMcpSchema = DebtIdBodySchema.merge(DebtOpeningBalanceBodySchema);

const DebtActivateSuggestedMcpSchema = z
  .object({
    suggestedPlanId: z.string().min(1),
  })
  .merge(DebtStrategyActivateSuggestedBodySchema);

const PlanMovementMcpSchema = z.object({
  planId: z.string().min(1),
  movementId: z.string().min(1),
});

const DismissMissedMcpSchema = z
  .object({
    movementId: z.string().min(1),
  })
  .merge(DebtStrategyDismissMissedBodySchema);

const PlanIdOnlyMcpSchema = z.object({
  planId: z.string().min(1),
});

const BudgetDeleteMcpSchema = z.object({
  budgetId: z.string().regex(/^[1-9]\d*$/, 'budgetId must be a positive integer string'),
});

export function registerBankStatementsHttpMutationTools(server: McpServer): void {
  const reg = (
    name: string,
    description: string,
    inputSchemaShape: Record<string, z.ZodTypeAny>,
    run: (args: unknown) => JsonMutationResult | Promise<JsonMutationResult>,
  ): void => {
    server.registerTool(
      name,
      { description, inputSchema: inputSchemaShape },
      async raw => httpMutationToMcpToolResult(await run(raw ?? {})),
    );
  };

  reg(
    'post_http_contract_leave',
    'POST /api/contracts/:id/leave parity. **Writes** leave rows (`working-days/leave.csv` / registry).',
    ContractLeaveBookMcpSchema.shape,
    args => {
      const parsed = ContractLeaveBookMcpSchema.safeParse(args);
      if (!parsed.success) return { status: 400, body: { error: 'Invalid request', details: parsed.error.issues } };
      const { contractId: cid, dates, type, notes, external_logged } = parsed.data;
      return mutateContractBookLeave(cid, { dates, type, notes, external_logged });
    },
  );

  reg(
    'delete_http_contract_leave',
    'DELETE /api/contracts/:id/leave/:leaveId parity. **Deletes** future-dated leave row.',
    ContractLeaveDeleteMcpSchema.shape,
    args => {
      const parsed = ContractLeaveDeleteMcpSchema.safeParse(args);
      if (!parsed.success) return { status: 400, body: { error: 'Invalid request', details: parsed.error.issues } };
      return mutateContractDeleteLeave(parsed.data.contractId, parsed.data.leaveId);
    },
  );

  reg(
    'post_http_contract_leave_preview',
    'POST /api/contracts/:id/leave-preview parity. **Read-only** rendered email template (no writes).',
    ContractLeavePreviewMcpSchema.shape,
    args => {
      const parsed = ContractLeavePreviewMcpSchema.safeParse(args);
      if (!parsed.success) return { status: 400, body: { error: 'Invalid request', details: parsed.error.issues } };
      const { contractId: cid, dates, type } = parsed.data;
      return mutateContractLeavePreview(cid, { dates, type });
    },
  );

  reg(
    'post_http_invoice_generate',
    'POST /api/invoices/generate parity. **Persists** supplier invoice draft, writes PDF to disk, flips row to issued.',
    InvoiceGenerateBodySchema.shape,
    async args => mutateInvoiceGenerate(args),
  );

  reg(
    'post_http_invoice_reconcile',
    'POST /api/invoices/reconcile parity. **`dryRun` defaults true** — omit or true returns a plan only; **`dryRun: false` persists** proposed payments (**writes SQLite**).',
    InvoiceReconcileBodySchema.shape,
    args => {
      const parsed = InvoiceReconcileBodySchema.safeParse(args ?? {});
      if (!parsed.success) return { status: 400, body: { error: 'Invalid request', details: parsed.error.issues } };
      return mutateInvoiceReconcile(parsed.data);
    },
  );

  reg(
    'post_http_debts',
    'POST /api/debts parity. **Creates** debt row (**CSV + SQLite**).',
    DebtCreateBodySchema.shape,
    args => mutateDebtsCreate(args),
  );

  reg(
    'put_http_debts',
    'PUT /api/debts/:id parity. **Updates** persisted debt (**side effect**).',
    DebtUpdateMcpSchema.shape,
    args => {
      const parsed = DebtUpdateMcpSchema.safeParse(args);
      if (!parsed.success) return { status: 400, body: { error: 'Invalid request', details: parsed.error.issues } };
      const { debtId, ...body } = parsed.data;
      return mutateDebtsUpdate(debtId, body);
    },
  );

  reg(
    'delete_http_debts',
    'DELETE /api/debts/:id parity. **Archives** debt (**persisted**).',
    DebtIdBodySchema.shape,
    args => {
      const parsed = DebtIdBodySchema.safeParse(args);
      if (!parsed.success) return { status: 400, body: { error: 'Invalid request', details: parsed.error.issues } };
      return mutateDebtsArchive(parsed.data.debtId);
    },
  );

  reg(
    'post_http_debts_opening_balance',
    'POST /api/debts/:id/opening-balance parity. **Writes** opening balance (**persisted**).',
    DebtOpeningBalanceMcpSchema.shape,
    args => {
      const parsed = DebtOpeningBalanceMcpSchema.safeParse(args);
      if (!parsed.success) return { status: 400, body: { error: 'Invalid request', details: parsed.error.issues } };
      const { debtId, ...body } = parsed.data;
      return mutateDebtsOpeningBalance(debtId, body);
    },
  );

  reg(
    'post_http_debt_strategy_plans',
    'POST /api/debt-strategy/plans parity. **Persists** new plan + movements.',
    DebtStrategyCreatePlanBodySchema.shape,
    args => mutateDebtStrategyCreatePlan(args),
  );

  reg(
    'post_http_debt_strategy_activate_suggested',
    'POST /api/debt-strategy/plans/:id/activate-suggested parity. **Persists** activated plan (**writes** registry).',
    DebtActivateSuggestedMcpSchema.shape,
    args => {
      const parsed = DebtActivateSuggestedMcpSchema.safeParse(args);
      if (!parsed.success) return { status: 400, body: { error: 'Invalid request', details: parsed.error.issues } };
      const { suggestedPlanId, ...rest } = parsed.data;
      return mutateDebtStrategyActivateSuggested(suggestedPlanId, rest);
    },
  );

  reg(
    'post_http_debt_strategy_movement_acknowledge',
    'POST acknowledge movement parity. **Updates** movement row (**persisted**).',
    PlanMovementMcpSchema.shape,
    args => {
      const parsed = PlanMovementMcpSchema.safeParse(args);
      if (!parsed.success) return { status: 400, body: { error: 'Invalid request', details: parsed.error.issues } };
      return mutateDebtStrategyMovementAcknowledge(parsed.data.planId, parsed.data.movementId);
    },
  );

  reg(
    'post_http_debt_strategy_movement_dismiss_missed',
    'POST dismiss-missed parity. **Updates** movement (`dismissed_missed_until`, **persisted**). Same path shape as HTTP; `planId` in URL is not validated.',
    DismissMissedMcpSchema.shape,
    args => {
      const parsed = DismissMissedMcpSchema.safeParse(args);
      if (!parsed.success) return { status: 400, body: { error: 'Invalid request', details: parsed.error.issues } };
      return mutateDebtStrategyMovementDismissMissed(parsed.data.movementId, {
        until: parsed.data.until,
      });
    },
  );

  reg(
    'post_http_debt_strategy_plan_pause',
    'POST /api/debt-strategy/plans/:id/pause parity. **Persists** plan status.',
    PlanIdOnlyMcpSchema.shape,
    args => {
      const parsed = PlanIdOnlyMcpSchema.safeParse(args);
      if (!parsed.success) return { status: 400, body: { error: 'Invalid request', details: parsed.error.issues } };
      return mutateDebtStrategyPlanPause(parsed.data.planId);
    },
  );

  reg(
    'post_http_debt_strategy_plan_resume',
    'POST /api/debt-strategy/plans/:id/resume parity. **Persists** plan status.',
    PlanIdOnlyMcpSchema.shape,
    args => {
      const parsed = PlanIdOnlyMcpSchema.safeParse(args);
      if (!parsed.success) return { status: 400, body: { error: 'Invalid request', details: parsed.error.issues } };
      return mutateDebtStrategyPlanResume(parsed.data.planId);
    },
  );

  reg(
    'delete_http_debt_strategy_plan',
    'DELETE /api/debt-strategy/plans/:id parity. **Deletes** plan (**persisted**).',
    PlanIdOnlyMcpSchema.shape,
    args => {
      const parsed = PlanIdOnlyMcpSchema.safeParse(args);
      if (!parsed.success) return { status: 400, body: { error: 'Invalid request', details: parsed.error.issues } };
      return mutateDebtStrategyPlanDelete(parsed.data.planId);
    },
  );

  reg(
    'post_http_debt_strategy_sandbox',
    'POST /api/debt-strategy/sandbox parity. **Read-only** assembled what-if (**no persistence**).',
    DebtStrategySandboxBodySchema.shape,
    args => mutateDebtStrategySandbox(args),
  );

  reg(
    'post_http_budgets',
    'POST /api/budgets parity. **Upserts** budget row (**SQLite**).',
    BudgetUpsertBodySchema.shape,
    args => mutateBudgetUpsert(args),
  );

  reg(
    'delete_http_budgets',
    'DELETE /api/budgets/:id parity. **Deletes** budget row (**204** on success, **persisted**).',
    BudgetDeleteMcpSchema.shape,
    args => {
      const parsed = BudgetDeleteMcpSchema.safeParse(args);
      if (!parsed.success) return { status: 400, body: { error: 'Invalid request', details: parsed.error.issues } };
      return mutateBudgetDelete(parsed.data.budgetId);
    },
  );

  reg(
    'put_http_expenses_simulation_exclusions',
    'PUT /api/expenses/simulation-exclusions parity. **Replaces persisted** fixed-expense simulation exclusion keys.',
    SimulationExclusionsPutBodySchema.shape,
    args => mutateSimulationExclusionsReplace(args),
  );
}
