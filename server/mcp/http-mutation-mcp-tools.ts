/**
 * MCP tools mirroring canonical JSON mutating Express routes (`server/http/mutation/*`).
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  BudgetUpsertBodySchema,
  ContractIdSchema,
  ClientUpdateSchema,
  CreateDismissalBodySchema,
  CreateObligationBodySchema,
  DeadlineCompleteBodySchema,
  DeadlineCreateBodySchema,
  DeadlineUpdateBodySchema,
  DebtCreateBodySchema,
  DebtOpeningBalanceBodySchema,
  DebtUpdateBodySchema,
  InterCompanyClassifyRequestSchema,
  LeaveRequestSchema,
  ObligationStateUpsertBodySchema,
  SimulationExclusionsPutBodySchema,
  TemplatePreviewRequestSchema,
  UpdateObligationBodySchema,
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
import {
  mutateDeadlinesClearDone,
  mutateDeadlinesCreate,
  mutateDeadlinesMarkDone,
  mutateDeadlinesRemove,
  mutateDeadlinesUpdate,
} from '../http/mutation/deadlines.js';
import {
  mutateFinancialObligationsCreate,
  mutateFinancialObligationsDelete,
  mutateFinancialObligationsDismissAuto,
  mutateFinancialObligationsResetState,
  mutateFinancialObligationsUndismissAuto,
  mutateFinancialObligationsUpdate,
  mutateFinancialObligationsUpsertState,
} from '../http/mutation/obligations.js';
import { mutateClientsUpdate } from '../http/mutation/clients-update.js';
import { mutateWarningsResolveInterCompanyClassifications } from '../http/mutation/warnings-inter-company-classify.js';
import {
  ContractRenewRequestSchema,
  mutateContractsRequestRenewal,
} from '../http/mutation/contracts-renew.js';
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

const DeadlineIdSchema = z.object({ id: z.string().min(1) });
const DeadlineUpdateMcpSchema = DeadlineIdSchema.merge(DeadlineUpdateBodySchema);

const ObligationPathIdSchema = z.object({ obligationId: z.string().min(1) });

const ClientsUpdateMcpSchema = z
  .object({
    clientId: z.string().min(1),
  })
  .and(ClientUpdateSchema);

const ContractsRenewMcpSchema = z
  .object({
    contractId: ContractIdSchema,
  })
  .merge(ContractRenewRequestSchema);
export function registerBankStatementsHttpMutationTools(server: McpServer): void {
  const reg = (
    names: string | readonly [canonical: string, legacy: string],
    description: string,
    inputSchemaShape: Record<string, z.ZodTypeAny>,
    run: (args: unknown) => JsonMutationResult | Promise<JsonMutationResult>,
  ): void => {
    const wrapped = async (raw: unknown) => httpMutationToMcpToolResult(await run(raw ?? {}));
    if (typeof names === 'string') {
      server.registerTool(names, { description, inputSchema: inputSchemaShape }, wrapped);
      return;
    }
    const [canonical, legacy] = names;
    server.registerTool(
      canonical,
      {
        description: `${description} **Preferred MCP identifier.** Legacy alias \`${legacy}\` is deprecated.`,
        inputSchema: inputSchemaShape,
      },
      wrapped,
    );
    server.registerTool(
      legacy,
      {
        description: `**Deprecated.** Prefer \`${canonical}\`. ${description}`,
        inputSchema: inputSchemaShape,
      },
      wrapped,
    );
  };
  reg(
    ['contracts_book_leave', 'post_http_contract_leave'],
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
    ['contracts_delete_leave', 'delete_http_contract_leave'],
    'DELETE /api/contracts/:id/leave/:leaveId parity. **Deletes** future-dated leave row.',
    ContractLeaveDeleteMcpSchema.shape,
    args => {
      const parsed = ContractLeaveDeleteMcpSchema.safeParse(args);
      if (!parsed.success) return { status: 400, body: { error: 'Invalid request', details: parsed.error.issues } };
      return mutateContractDeleteLeave(parsed.data.contractId, parsed.data.leaveId);
    },
  );

  reg(
    ['contracts_preview_leave_notice', 'post_http_contract_leave_preview'],
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
    ['invoices_generate', 'post_http_invoice_generate'],
    'POST /api/invoices/generate parity. **Persists** supplier invoice draft, writes PDF to disk, flips row to issued.',
    InvoiceGenerateBodySchema.shape,
    async args => mutateInvoiceGenerate(args),
  );

  reg(
    ['invoices_reconcile', 'post_http_invoice_reconcile'],
    'POST /api/invoices/reconcile parity. **Preview:** `{ dryRun: true }` (default) returns `plan` + `summary` without writing. **Self-heal:** `{ dryRun: false }` persists proposed payments over the standard 180-day look-back and returns `persisted`, `statusUpdates`, and `summary` (`matchedCount`, `invoiceIds`, `unmatchedDepositCount`). **Scoped:** add `invoiceId` to limit dry-run summary or persist to one invoice (e.g. `{ dryRun: false, invoiceId: "DC-011" }`). **Auto mode:** `{ mode: "auto", dryRun: false }` persists reference-exact matches only. All persist modes write SQLite.',
    InvoiceReconcileBodySchema.shape,
    args => {
      const parsed = InvoiceReconcileBodySchema.safeParse(args ?? {});
      if (!parsed.success) return { status: 400, body: { error: 'Invalid request', details: parsed.error.issues } };
      return mutateInvoiceReconcile(parsed.data);
    },
  );

  reg(
    ['debts_create', 'post_http_debts'],
    'POST /api/debts parity. **Creates** debt row (**CSV + SQLite**).',
    DebtCreateBodySchema.shape,
    args => mutateDebtsCreate(args),
  );

  reg(
    ['debts_update', 'put_http_debts'],
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
    ['debts_archive', 'delete_http_debts'],
    'DELETE /api/debts/:id parity. **Archives** debt (**persisted**).',
    DebtIdBodySchema.shape,
    args => {
      const parsed = DebtIdBodySchema.safeParse(args);
      if (!parsed.success) return { status: 400, body: { error: 'Invalid request', details: parsed.error.issues } };
      return mutateDebtsArchive(parsed.data.debtId);
    },
  );

  reg(
    ['debts_set_opening_balance', 'post_http_debts_opening_balance'],
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
    ['debt_strategy_create_plan', 'post_http_debt_strategy_plans'],
    'POST /api/debt-strategy/plans parity. **Persists** new plan + movements.',
    DebtStrategyCreatePlanBodySchema.shape,
    args => mutateDebtStrategyCreatePlan(args),
  );

  reg(
    ['debt_strategy_activate_suggested_plan', 'post_http_debt_strategy_activate_suggested'],
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
    ['debt_strategy_acknowledge_movement', 'post_http_debt_strategy_movement_acknowledge'],
    'POST acknowledge movement parity. **Updates** movement row (**persisted**).',
    PlanMovementMcpSchema.shape,
    args => {
      const parsed = PlanMovementMcpSchema.safeParse(args);
      if (!parsed.success) return { status: 400, body: { error: 'Invalid request', details: parsed.error.issues } };
      return mutateDebtStrategyMovementAcknowledge(parsed.data.planId, parsed.data.movementId);
    },
  );

  reg(
    ['debt_strategy_dismiss_missed_movement', 'post_http_debt_strategy_movement_dismiss_missed'],
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
    ['debt_strategy_pause_plan', 'post_http_debt_strategy_plan_pause'],
    'POST /api/debt-strategy/plans/:id/pause parity. **Persists** plan status.',
    PlanIdOnlyMcpSchema.shape,
    args => {
      const parsed = PlanIdOnlyMcpSchema.safeParse(args);
      if (!parsed.success) return { status: 400, body: { error: 'Invalid request', details: parsed.error.issues } };
      return mutateDebtStrategyPlanPause(parsed.data.planId);
    },
  );

  reg(
    ['debt_strategy_resume_plan', 'post_http_debt_strategy_plan_resume'],
    'POST /api/debt-strategy/plans/:id/resume parity. **Persists** plan status.',
    PlanIdOnlyMcpSchema.shape,
    args => {
      const parsed = PlanIdOnlyMcpSchema.safeParse(args);
      if (!parsed.success) return { status: 400, body: { error: 'Invalid request', details: parsed.error.issues } };
      return mutateDebtStrategyPlanResume(parsed.data.planId);
    },
  );

  reg(
    ['debt_strategy_delete_plan', 'delete_http_debt_strategy_plan'],
    'DELETE /api/debt-strategy/plans/:id parity. **Deletes** plan (**persisted**).',
    PlanIdOnlyMcpSchema.shape,
    args => {
      const parsed = PlanIdOnlyMcpSchema.safeParse(args);
      if (!parsed.success) return { status: 400, body: { error: 'Invalid request', details: parsed.error.issues } };
      return mutateDebtStrategyPlanDelete(parsed.data.planId);
    },
  );

  reg(
    ['debt_strategy_sandbox_what_if', 'post_http_debt_strategy_sandbox'],
    'POST /api/debt-strategy/sandbox parity. **Read-only** assembled what-if (**no persistence**).',
    DebtStrategySandboxBodySchema.shape,
    args => mutateDebtStrategySandbox(args),
  );

  reg(
    ['budgets_upsert', 'post_http_budgets'],
    'POST /api/budgets parity. **Upserts** budget row (**SQLite**).',
    BudgetUpsertBodySchema.shape,
    args => mutateBudgetUpsert(args),
  );

  reg(
    ['budgets_delete', 'delete_http_budgets'],
    'DELETE /api/budgets/:id parity. **Deletes** budget row (**204** on success, **persisted**).',
    BudgetDeleteMcpSchema.shape,
    args => {
      const parsed = BudgetDeleteMcpSchema.safeParse(args);
      if (!parsed.success) return { status: 400, body: { error: 'Invalid request', details: parsed.error.issues } };
      return mutateBudgetDelete(parsed.data.budgetId);
    },
  );

  reg(
    ['fixed_expenses_put_simulation_exclusions', 'put_http_expenses_simulation_exclusions'],
    'PUT /api/expenses/simulation-exclusions parity. **Replaces persisted** fixed-expense simulation exclusion keys.',
    SimulationExclusionsPutBodySchema.shape,
    args => mutateSimulationExclusionsReplace(args),
  );

  reg(
    'deadlines_create',
    'POST /api/deadlines parity. **Persists** a deadline row.',
    DeadlineCreateBodySchema.shape,
    args => mutateDeadlinesCreate(args),
  );

  reg(
    'deadlines_update',
    'PUT /api/deadlines/:id parity. Body includes `id` plus update fields.',
    DeadlineUpdateMcpSchema.shape,
    args => {
      const parsed = DeadlineUpdateMcpSchema.safeParse(args);
      if (!parsed.success) return { status: 400, body: { error: 'Invalid request', details: parsed.error.issues } };
      const { id, ...body } = parsed.data;
      return mutateDeadlinesUpdate(id, body);
    },
  );

  reg('deadlines_remove', 'DELETE /api/deadlines/:id parity.', DeadlineIdSchema.shape, args => {
    const parsed = DeadlineIdSchema.safeParse(args);
    if (!parsed.success) return { status: 400, body: { error: 'Invalid request', details: parsed.error.issues } };
    return mutateDeadlinesRemove(parsed.data.id);
  });

  reg(
    'deadlines_mark_done',
    'POST /api/deadlines/:id/complete parity. Body includes `id` and optional `completedDate`.',
    DeadlineIdSchema.merge(DeadlineCompleteBodySchema.partial()).shape,
    args => {
      const merged = DeadlineIdSchema.merge(DeadlineCompleteBodySchema.partial()).safeParse(args);
      if (!merged.success)
        return { status: 400, body: { error: 'Invalid request', details: merged.error.issues } };
      const { id, ...rest } = merged.data;
      return mutateDeadlinesMarkDone(id, rest);
    },
  );

  reg('deadlines_clear_done', 'DELETE /api/deadlines/:id/complete parity.', DeadlineIdSchema.shape, args => {
    const parsed = DeadlineIdSchema.safeParse(args);
    if (!parsed.success) return { status: 400, body: { error: 'Invalid request', details: parsed.error.issues } };
    return mutateDeadlinesClearDone(parsed.data.id);
  });

  reg(
    'financial_obligations_create',
    'POST /api/obligations parity. Creates a manual obligation.',
    CreateObligationBodySchema.shape,
    args => mutateFinancialObligationsCreate(args),
  );

  reg(
    'financial_obligations_update',
    'PUT /api/obligations/:id parity for manual obligations. Body includes `obligationId` plus patch fields.',
    ObligationPathIdSchema.merge(UpdateObligationBodySchema).shape,
    args => {
      const parsed = ObligationPathIdSchema.merge(UpdateObligationBodySchema).safeParse(args);
      if (!parsed.success)
        return { status: 400, body: { error: 'Invalid request', details: parsed.error.issues } };
      const { obligationId, ...body } = parsed.data;
      return mutateFinancialObligationsUpdate(obligationId, body);
    },
  );

  reg(
    'financial_obligations_delete',
    'DELETE /api/obligations/:id parity for manual obligations.',
    ObligationPathIdSchema.shape,
    args => {
      const parsed = ObligationPathIdSchema.safeParse(args);
      if (!parsed.success)
        return { status: 400, body: { error: 'Invalid request', details: parsed.error.issues } };
      return mutateFinancialObligationsDelete(parsed.data.obligationId);
    },
  );

  reg(
    'financial_obligations_upsert_state',
    'POST /api/obligations/:id/state parity (manual obligations). Optional `paidFromTxHash` links the settling bank transaction (`transactions.hash`); paid amount/date/account are then derived from the ledger. Omit `paidFromTxHash` for cash/in-person payments. Flow: `financial_obligations_list` → `financial_obligations_list_payment_candidates` → upsert with `{ status: "paid", paidFromTxHash }`.',
    ObligationPathIdSchema.merge(ObligationStateUpsertBodySchema).shape,
    args => {
      const parsed = ObligationPathIdSchema.merge(ObligationStateUpsertBodySchema).safeParse(args);
      if (!parsed.success)
        return { status: 400, body: { error: 'Invalid request', details: parsed.error.issues } };
      const { obligationId, ...body } = parsed.data;
      return mutateFinancialObligationsUpsertState(obligationId, body);
    },
  );

  reg(
    'financial_obligations_reset_state',
    'DELETE /api/obligations/:id/state parity.',
    ObligationPathIdSchema.shape,
    args => {
      const parsed = ObligationPathIdSchema.safeParse(args);
      if (!parsed.success)
        return { status: 400, body: { error: 'Invalid request', details: parsed.error.issues } };
      return mutateFinancialObligationsResetState(parsed.data.obligationId);
    },
  );

  reg(
    'financial_obligations_dismiss_auto',
    'POST /api/obligations/dismissals parity (auto-* ids only).',
    CreateDismissalBodySchema.shape,
    args => mutateFinancialObligationsDismissAuto(args),
  );

  reg(
    'financial_obligations_undismiss_auto',
    'DELETE /api/obligations/dismissals/:id parity.',
    z.object({ obligationId: z.string().min(1) }).shape,
    args => {
      const parsed = z.object({ obligationId: z.string().min(1) }).safeParse(args);
      if (!parsed.success)
        return { status: 400, body: { error: 'Invalid request', details: parsed.error.issues } };
      return mutateFinancialObligationsUndismissAuto(parsed.data.obligationId);
    },
  );

  server.registerTool(
    'clients_update',
    {
      description:
        'PUT /api/clients/:id parity. **`clientId` in JSON body** (same contract id semantics as HTTP path). **Mutates** registry.',
      inputSchema: ClientsUpdateMcpSchema,
    },
    async args => {
      const parsed = ClientsUpdateMcpSchema.safeParse(args);
      if (!parsed.success) {
        return httpMutationToMcpToolResult({
          status: 400,
          body: { error: 'Invalid request', details: parsed.error.issues },
        });
      }
      const { clientId, ...body } = parsed.data;
      return httpMutationToMcpToolResult(mutateClientsUpdate(clientId, body));
    },
  );

  reg(
    'warnings_resolve_inter_company_classifications',
    'POST /api/warnings/inter-company-movements/classify parity. Persist inter-company pair labels when clearing warnings (**low-frequency** workflow).',
    InterCompanyClassifyRequestSchema.shape,
    args => mutateWarningsResolveInterCompanyClassifications(args),
  );

  reg(
    'contracts_request_renewal',
    'POST /api/contracts/:id/renew parity — validates JSON `{ start_date, end_date, day_rate? }` and returns **501** with explanation until renewal persistence ships. Include `contractId`.',
    ContractsRenewMcpSchema.shape,
    args => {
      const parsed = ContractsRenewMcpSchema.safeParse(args);
      if (!parsed.success)
        return { status: 400, body: { error: 'Invalid request', details: parsed.error.issues } };
      const { contractId, ...body } = parsed.data;
      return mutateContractsRequestRenewal(contractId, body);
    },
  );
}
