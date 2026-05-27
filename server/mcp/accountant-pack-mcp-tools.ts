/**
 * Accountant document bundle outcome tools (slice 2 scaffolding). Manifests arrive in a follow-up PR.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

const AccountantPackInputSchema = z.object({
  /** Human label for the statutory / reporting period (e.g. FY2025 VAT Q1). */
  period_label: z.string().min(3),
});

type PackId = 'vat' | 'corp_tax' | 'sa';

function accountantPackNotConfiguredStructured(pack: PackId, periodLabel: string) {
  return {
    ok: false as const,
    code: 'accountant-pack-not-configured' as const,
    pack,
    period_label: periodLabel,
    missing_documents: [{ code: 'manifest-not-implemented' }] as const,
    message:
      'Accountant bundles are not wired to storage yet. This tool reserves the outcome shape (period + missing_documents) for slice 2 manifests.',
  };
}

/** @internal */
export function runAccountantPackVatMcpTool(args: unknown) {
  const parsed = AccountantPackInputSchema.safeParse(args ?? {});
  if (!parsed.success) {
    const body = { error: 'invalid-params', issues: parsed.error.issues };
    return {
      isError: true as const,
      content: [{ type: 'text' as const, text: JSON.stringify(body, null, 2) }],
    };
  }
  const structuredContent = accountantPackNotConfiguredStructured('vat', parsed.data.period_label);
  return {
    isError: true as const,
    content: [{ type: 'text' as const, text: JSON.stringify(structuredContent, null, 2) }],
    structuredContent,
  };
}

/** @internal */
export function runAccountantPackCorpTaxMcpTool(args: unknown) {
  const parsed = AccountantPackInputSchema.safeParse(args ?? {});
  if (!parsed.success) {
    const body = { error: 'invalid-params', issues: parsed.error.issues };
    return {
      isError: true as const,
      content: [{ type: 'text' as const, text: JSON.stringify(body, null, 2) }],
    };
  }
  const structuredContent = accountantPackNotConfiguredStructured('corp_tax', parsed.data.period_label);
  return {
    isError: true as const,
    content: [{ type: 'text' as const, text: JSON.stringify(structuredContent, null, 2) }],
    structuredContent,
  };
}

/** @internal */
export function runAccountantPackSaMcpTool(args: unknown) {
  const parsed = AccountantPackInputSchema.safeParse(args ?? {});
  if (!parsed.success) {
    const body = { error: 'invalid-params', issues: parsed.error.issues };
    return {
      isError: true as const,
      content: [{ type: 'text' as const, text: JSON.stringify(body, null, 2) }],
    };
  }
  const structuredContent = accountantPackNotConfiguredStructured('sa', parsed.data.period_label);
  return {
    isError: true as const,
    content: [{ type: 'text' as const, text: JSON.stringify(structuredContent, null, 2) }],
    structuredContent,
  };
}

export function registerAccountantPackMcpTools(server: McpServer): void {
  server.registerTool(
    'accountant_pack_vat',
    {
      description:
        'Slice 2 scaffolding — VAT support pack. Returns structured `missing_documents` once manifests exist; today surfaces `accountant-pack-not-configured`.',
      inputSchema: AccountantPackInputSchema.shape,
    },
    async raw => runAccountantPackVatMcpTool(raw ?? {}),
  );

  server.registerTool(
    'accountant_pack_corp_tax',
    {
      description:
        'Slice 2 scaffolding — corporation tax document pack. Same outcome envelope as VAT; manifest wiring is TODO.',
      inputSchema: AccountantPackInputSchema.shape,
    },
    async raw => runAccountantPackCorpTaxMcpTool(raw ?? {}),
  );

  server.registerTool(
    'accountant_pack_sa',
    {
      description:
        'Slice 2 scaffolding — self-assessment pack placeholder. Use when SA bundles are implemented against bank-statement coverage rules.',
      inputSchema: AccountantPackInputSchema.shape,
    },
    async raw => runAccountantPackSaMcpTool(raw ?? {}),
  );
}
