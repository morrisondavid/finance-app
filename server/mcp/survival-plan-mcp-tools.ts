/**
 * Survival plan MCP mutations — parity with survival-plan CSV persistence.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  SurvivalPlanCommitBodySchema,
  SurvivalPlanGetResponseSchema,
} from '../../shared/api-contracts.js';
import {
  clearSurvivalPlan,
  getActiveSurvivalPlan,
  persistSurvivalPlan,
  readSurvivalPlanFromCsvFile,
  getSurvivalPlanCsvPath,
} from '../db/survival-plan-csv.js';

type McpJsonToolReturn = {
  [x: string]: unknown;
  isError?: true;
  content: { type: 'text'; text: string }[];
  structuredContent?: { [x: string]: unknown };
};

export function runSurvivalPlanGetMcpTool(_args: unknown): McpJsonToolReturn {
  const plan = getActiveSurvivalPlan();
  const structuredContent = SurvivalPlanGetResponseSchema.parse({
    plan: plan === null
      ? null
      : {
          startDate: plan.startDate,
          dailyAmount: plan.dailyAmount,
          scope: plan.scope,
          note: plan.note,
          active: plan.active,
        },
  });
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(structuredContent, null, 2) }],
    structuredContent,
  };
}

export function runSurvivalPlanCommitMcpTool(args: unknown): McpJsonToolReturn {
  const parsed = SurvivalPlanCommitBodySchema.safeParse(args ?? {});
  if (!parsed.success) {
    return {
      isError: true,
      content: [{
        type: 'text' as const,
        text: JSON.stringify({ error: 'invalid-params', issues: parsed.error.issues }, null, 2),
      }],
    };
  }
  if (parsed.data.confirmedInChat !== true) {
    return {
      isError: true,
      content: [{
        type: 'text' as const,
        text: JSON.stringify({
          error: 'confirmation-required',
          message: 'Confirm the survival plan in chat before commit (confirmedInChat: true).',
        }, null, 2),
      }],
    };
  }
  persistSurvivalPlan({
    startDate: parsed.data.startDate,
    dailyAmount: parsed.data.dailyAmount,
    scope: parsed.data.scope,
    currency: 'GBP',
    note: parsed.data.note,
    active: true,
  });
  return runSurvivalPlanGetMcpTool({});
}

export function runSurvivalPlanClearMcpTool(_args: unknown): McpJsonToolReturn {
  clearSurvivalPlan();
  return runSurvivalPlanGetMcpTool({});
}

export function registerSurvivalPlanMcpTools(server: McpServer): void {
  server.registerTool(
    'survival_plan_get',
    {
      description:
        'Read the committed daily survival allowance plan (start date, £/day, scope). Use before `survival_get_allowance` when you need plan context.',
      inputSchema: {},
    },
    raw => runSurvivalPlanGetMcpTool(raw),
  );

  server.registerTool(
    'survival_plan_commit',
    {
      description:
        'Commit a daily discretionary spend cap with rollover tracking. **Requires explicit user confirmation in chat** (`confirmedInChat: true`). Echo `narrativeBasis` from `analytics_get_survival` when committing.',
      inputSchema: SurvivalPlanCommitBodySchema.shape,
    },
    raw => runSurvivalPlanCommitMcpTool(raw),
  );

  server.registerTool(
    'survival_plan_clear',
    {
      description: 'Clear the active survival plan (stops rollover allowance tracking).',
      inputSchema: {},
    },
    raw => runSurvivalPlanClearMcpTool(raw),
  );
}

export { readSurvivalPlanFromCsvFile, getSurvivalPlanCsvPath };
