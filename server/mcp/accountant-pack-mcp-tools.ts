/**
 * Accountant document bundle outcome tools (readiness / preview / send).
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { EntityId, ReportingRegime } from '../../shared/api-contracts.js';
import {
  computeReportingReadiness,
  formatMissingReadinessSummary,
} from '../domain/reporting/index.js';

const EntityIdOptionalSchema = z.enum(['autonize-it-ltd', 'autonize-it-fzco']).optional();

const AccountantReadinessSnapshotSchema = z.object({
  regime: z.enum(['vat', 'corporation_tax', 'sa', 'all']).optional(),
  period_label: z.string().min(3),
  entityId: EntityIdOptionalSchema,
  deadline_horizon_days: z.coerce.number().int().positive().max(3660).optional(),
});

const AccountantBundlePeriodSchema = z.object({
  period_label: z.string().min(3),
  entityId: EntityIdOptionalSchema,
  previewFingerprint: z.string().optional(),
});

type AccountantPackKind = 'vat' | 'corp_tax' | 'sa';

function resolveEntityId(entityId: EntityId | undefined): EntityId {
  return entityId ?? 'autonize-it-ltd';
}

function resolveReportingRegime(
  regime: string | undefined,
  pack: AccountantPackKind,
): ReportingRegime | null {
  if (regime === 'sa' || regime === 'all') return null;
  if (regime === 'corporation_tax' || pack === 'corp_tax') return 'corporation_tax';
  return 'vat';
}

function readinessNotConfiguredStructured(
  regime: string | undefined,
  periodLabel: string,
  horizon: number | undefined,
  entityId: EntityId,
) {
  return {
    ok: false as const,
    code: 'accountant-readiness-not-configured' as const,
    entityId,
    regime: regime ?? 'all',
    period_label: periodLabel,
    deadline_horizon_days: horizon ?? null,
    present: [] as const,
    missing: [{ code: 'manifest-not-implemented' }] as const,
    recommended_next_steps: [
      'Regime must be vat or corporation_tax for readiness checks.',
      'Use existing statements + reporting readiness API for manual prep.',
    ],
    message:
      'Readiness snapshot supports vat and corporation_tax only. SA and all are not configured.',
  };
}

function buildReadinessStructured(
  entityId: EntityId,
  regime: ReportingRegime,
  periodLabel: string,
  horizon: number | undefined,
) {
  const readiness = computeReportingReadiness({ entityId, regime, periodLabel });
  const missingSummary = formatMissingReadinessSummary(
    readiness.missing,
    readiness.invoices.missingInvoiceNumbers,
  );
  const recommended_next_steps = readiness.ready
    ? ['Pack is complete for this period.']
    : [
        missingSummary,
        'Upload missing statement PDFs/CSVs and generate missing sales-invoice PDFs, then re-check.',
      ];

  return {
    ok: readiness.ready,
    entityId,
    regime,
    period_label: periodLabel,
    deadline_horizon_days: horizon ?? null,
    ready: readiness.ready,
    present: readiness.present,
    missing: readiness.missing,
    invoices: readiness.invoices,
    periodStartDate: readiness.periodStartDate,
    periodEndDate: readiness.periodEndDate,
    recommended_next_steps,
    message: readiness.ready
      ? 'Reporting pack is ready for this entity and period.'
      : 'Reporting pack is incomplete — see missing items and recommended_next_steps.',
  };
}

function previewNotConfiguredStructured(
  pack: AccountantPackKind,
  periodLabel: string,
  fp: string | undefined,
  entityId: EntityId,
) {
  return {
    ok: false as const,
    code: 'accountant-preview-not-configured' as const,
    entityId,
    pack,
    period_label: periodLabel,
    previewFingerprint: fp ?? null,
    missing_documents: [{ code: 'manifest-not-implemented' }] as const,
    message: 'Preview supports vat and corporation_tax packs only.',
  };
}

function buildPreviewStructured(
  pack: AccountantPackKind,
  entityId: EntityId,
  regime: ReportingRegime,
  periodLabel: string,
  fp: string | undefined,
) {
  const readiness = buildReadinessStructured(entityId, regime, periodLabel, undefined);
  return {
    ...readiness,
    pack,
    previewFingerprint: fp ?? null,
    code: readiness.ok ? 'accountant-preview-ready' : 'accountant-preview-incomplete',
  };
}

function sendNotConfiguredStructured(pack: AccountantPackKind, periodLabel: string, fp: string | undefined) {
  return {
    ok: false as const,
    code: 'accountant-send-not-configured' as const,
    pack,
    period_label: periodLabel,
    previewFingerprint: fp ?? null,
    message:
      'Send tools are stubs — no email/ZIP egress from this MCP call yet. When enabled, outbound must stay owner-inbox-capped via Resend config.',
  };
}

function accountantReadinessEnvelope(args: unknown) {
  const parsed = AccountantReadinessSnapshotSchema.safeParse(args ?? {});
  if (!parsed.success) {
    const body = { error: 'invalid-params', issues: parsed.error.issues };
    return {
      isError: true as const,
      content: [{ type: 'text' as const, text: JSON.stringify(body, null, 2) }],
    };
  }
  const entityId = resolveEntityId(parsed.data.entityId);
  const regime = resolveReportingRegime(parsed.data.regime, 'vat');
  const structuredContent =
    regime === null
      ? readinessNotConfiguredStructured(
          parsed.data.regime,
          parsed.data.period_label,
          parsed.data.deadline_horizon_days,
          entityId,
        )
      : buildReadinessStructured(
          entityId,
          regime,
          parsed.data.period_label,
          parsed.data.deadline_horizon_days,
        );
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(structuredContent, null, 2) }],
    structuredContent,
  };
}

function accountantPreviewEnvelope(pack: AccountantPackKind, args: unknown) {
  const parsed = AccountantBundlePeriodSchema.safeParse(args ?? {});
  if (!parsed.success) {
    const body = { error: 'invalid-params', issues: parsed.error.issues };
    return {
      isError: true as const,
      content: [{ type: 'text' as const, text: JSON.stringify(body, null, 2) }],
    };
  }
  const entityId = resolveEntityId(parsed.data.entityId);
  const regime = resolveReportingRegime(undefined, pack);
  const structuredContent =
    regime === null
      ? previewNotConfiguredStructured(
          pack,
          parsed.data.period_label,
          parsed.data.previewFingerprint,
          entityId,
        )
      : buildPreviewStructured(
          pack,
          entityId,
          regime,
          parsed.data.period_label,
          parsed.data.previewFingerprint,
        );
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(structuredContent, null, 2) }],
    structuredContent,
  };
}

function accountantSendEnvelope(pack: AccountantPackKind, args: unknown) {
  const parsed = AccountantBundlePeriodSchema.safeParse(args ?? {});
  if (!parsed.success) {
    const body = { error: 'invalid-params', issues: parsed.error.issues };
    return {
      isError: true as const,
      content: [{ type: 'text' as const, text: JSON.stringify(body, null, 2) }],
    };
  }
  const structuredContent = sendNotConfiguredStructured(
    pack,
    parsed.data.period_label,
    parsed.data.previewFingerprint,
  );
  return {
    isError: true as const,
    content: [{ type: 'text' as const, text: JSON.stringify(structuredContent, null, 2) }],
    structuredContent,
  };
}

/** @internal — exported for MCP contract tests */
export function runAccountantReadinessSnapshotMcpTool(args: unknown) {
  return accountantReadinessEnvelope(args);
}

export function registerAccountantPackMcpTools(server: McpServer): void {
  server.registerTool(
    'accountant_readiness_snapshot',
    {
      description:
        'Readiness report for accountant hand-offs: present/missing statement docs and sales-invoice PDFs per entity+regime+period (no ZIP, no email).',
      inputSchema: AccountantReadinessSnapshotSchema.shape,
    },
    raw => accountantReadinessEnvelope(raw ?? {}),
  );

  server.registerTool(
    'accountant_preview_vat_bundle',
    {
      description: 'VAT pack preview + optional QA fingerprint (**no send**).',
      inputSchema: AccountantBundlePeriodSchema.shape,
    },
    raw => accountantPreviewEnvelope('vat', raw ?? {}),
  );

  server.registerTool(
    'accountant_preview_corporation_tax_bundle',
    {
      description: 'Corporation-tax pack preview + optional QA fingerprint (**no send**).',
      inputSchema: AccountantBundlePeriodSchema.shape,
    },
    raw => accountantPreviewEnvelope('corp_tax', raw ?? {}),
  );

  server.registerTool(
    'accountant_preview_sa_bundle',
    {
      description:
        'Self-assessment pack preview + optional QA fingerprint (**no send**). Not configured yet.',
      inputSchema: AccountantBundlePeriodSchema.shape,
    },
    raw => accountantPreviewEnvelope('sa', raw ?? {}),
  );

  server.registerTool(
    'accountant_send_vat_bundle',
    {
      description:
        '**Guarded** VAT send (**stub**) — **`send` implies outbound** once wired; blast radius capped by owner-only Resend routing. Confirm with the human before calling.',
      inputSchema: AccountantBundlePeriodSchema.shape,
    },
    raw => accountantSendEnvelope('vat', raw ?? {}),
  );

  server.registerTool(
    'accountant_send_corporation_tax_bundle',
    {
      description:
        '**Guarded** corporation-tax send (**stub**) — outbound owner-capped when enabled. Confirm in chat before invoking.',
      inputSchema: AccountantBundlePeriodSchema.shape,
    },
    raw => accountantSendEnvelope('corp_tax', raw ?? {}),
  );

  server.registerTool(
    'accountant_send_sa_bundle',
    {
      description:
        '**Guarded** SA send (**stub**) — outbound owner-capped when enabled. Confirm in chat before invoking.',
      inputSchema: AccountantBundlePeriodSchema.shape,
    },
    raw => accountantSendEnvelope('sa', raw ?? {}),
  );

  const legacyVat = { period_label: z.string().min(3) };
  server.registerTool(
    'accountant_pack_vat',
    {
      description:
        '**Deprecated.** Prefer `accountant_preview_vat_bundle` + `accountant_send_vat_bundle`.',
      inputSchema: legacyVat,
    },
    raw => accountantPreviewEnvelope('vat', raw ?? {}),
  );

  server.registerTool(
    'accountant_pack_corp_tax',
    {
      description: '**Deprecated.** Prefer `accountant_preview_corporation_tax_bundle`.',
      inputSchema: legacyVat,
    },
    raw => accountantPreviewEnvelope('corp_tax', raw ?? {}),
  );

  server.registerTool(
    'accountant_pack_sa',
    {
      description: '**Deprecated.** Prefer `accountant_preview_sa_bundle`.',
      inputSchema: legacyVat,
    },
    raw => accountantPreviewEnvelope('sa', raw ?? {}),
  );
}
