/**
 * Mutations backing POST/DELETE `/api/contracts/:id/leave*` — shared by Express + MCP.
 */

import { z } from 'zod';
import {
  LeaveCreateResponseSchema,
  LeaveRequestSchema,
  TemplatePreviewRequestSchema,
  TemplatePreviewResponseSchema,
  type Contract,
  type LeaveRow,
} from '../../../shared/api-contracts.js';
import { findContractById } from '../../domain/contracts/queries.js';
import {
  deleteLeaveRow,
  findLeaveById,
  leaveForContract,
  upsertLeaveRows,
  composeLeaveId,
} from '../../domain/leave/index.js';
import { findClientById } from '../../domain/clients/queries.js';
import { companyById } from '../../domain/company/queries.js';
import { getPerson } from '../../domain/people/queries.js';
import {
  buildTemplateContext,
  renderTemplate,
  DirectClientHasNoAgencyRenewalFlow,
  TemplateContextInvalid,
  TemplateMissing,
} from '../../domain/templates/index.js';
import { todayIsoLocal } from '../../../shared/iso-date.js';
import { parseContractId, parseLeaveId } from '../read/contracts.js';
import type { JsonMutationResult } from './types.js';

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : 'Unknown error';
}

function zodIssuesBody(err: z.ZodError): JsonMutationResult {
  return { status: 400, body: { error: 'Invalid request', details: err.issues } };
}

function datesOutsideWindow(dates: readonly string[], contract: Contract): string | null {
  for (const date of dates) {
    if (date < contract.start_date) return date;
    if (contract.end_date !== null && date > contract.end_date) return date;
  }
  return null;
}

/** Resolve contract for mutation; returns HTTP-shaped 404 otherwise. */
function contractResolvedOr404(id: string): { contract: Contract } | JsonMutationResult {
  const parsedId = parseContractId(id);
  if (parsedId === null) {
    return { status: 404, body: { error: 'Contract not found' } };
  }
  const contract = findContractById(parsedId);
  if (contract === null) {
    return { status: 404, body: { error: 'Contract not found' } };
  }
  return { contract };
}

/** POST `/api/contracts/:id/leave` — persists leave rows (side effect: CSV / registry). */
export function mutateContractBookLeave(contractIdParam: string, body: unknown): JsonMutationResult {
  const resolved = contractResolvedOr404(contractIdParam);
  if ('status' in resolved) return resolved;
  const { contract } = resolved;

  try {
    const reqBody = LeaveRequestSchema.parse(body);
    const offending = datesOutsideWindow(reqBody.dates, contract);
    if (offending !== null) {
      return {
        status: 422,
        body: {
          error: 'LeaveOutsideContractWindow',
          detail: {
            date: offending,
            contract_window: {
              start_date: contract.start_date,
              end_date: contract.end_date,
            },
          },
        },
      };
    }

    const today = todayIsoLocal();
    const rows: LeaveRow[] = reqBody.dates.map(date => ({
      id: composeLeaveId(contract.id, date),
      contract_id: contract.id,
      date,
      type: reqBody.type,
      notes: reqBody.notes ?? null,
      external_logged: reqBody.external_logged ?? false,
      created_at: today,
      updated_at: today,
    }));

    upsertLeaveRows({ rows });

    const response = LeaveCreateResponseSchema.parse({
      leave: leaveForContract(contract.id),
      created: rows.length,
    });
    return { status: 201, body: response };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return zodIssuesBody(error);
    }
    console.error('[Contracts mutation] POST /:id/leave error:', error);
    return { status: 500, body: { error: `Failed to create leave: ${errorMessage(error)}` } };
  }
}

/** DELETE `/api/contracts/:id/leave/:leaveId` — deletes future dated row only. */
export function mutateContractDeleteLeave(contractIdParam: string, leaveIdParam: string): JsonMutationResult {
  const resolved = contractResolvedOr404(contractIdParam);
  if ('status' in resolved) return resolved;
  const { contract } = resolved;

  const parsedLeaveId = parseLeaveId(leaveIdParam);
  if (parsedLeaveId === null) {
    return { status: 404, body: { error: 'Leave row not found' } };
  }

  const existing = findLeaveById(parsedLeaveId);
  if (existing === null || existing.contract_id !== contract.id) {
    return { status: 404, body: { error: 'Leave row not found' } };
  }

  const today = todayIsoLocal();
  if (existing.date < today) {
    return {
      status: 422,
      body: {
        error: 'PastLeaveReadOnly',
        detail: { date: existing.date, today },
      },
    };
  }

  try {
    deleteLeaveRow({ id: parsedLeaveId });
    return { status: 200, body: { ok: true } };
  } catch (error) {
    console.error('[Contracts mutation] DELETE /:id/leave/:leaveId error:', error);
    return { status: 500, body: { error: `Failed to delete leave: ${errorMessage(error)}` } };
  }
}

/** POST `/api/contracts/:id/leave-preview` — read-only template render (no persistence). */
export function mutateContractLeavePreview(contractIdParam: string, body: unknown): JsonMutationResult {
  const resolved = contractResolvedOr404(contractIdParam);
  if ('status' in resolved) return resolved;
  const { contract } = resolved;

  try {
    const reqBody = TemplatePreviewRequestSchema.parse(body);

    const client = findClientById(contract.client_id);
    if (client === null) {
      return {
        status: 500,
        body: {
          error: `Client ${contract.client_id} missing from registry`,
        },
      };
    }
    const issuingEntity = companyById(contract.issuing_entity_id);
    if (issuingEntity === null) {
      return {
        status: 500,
        body: {
          error: `Issuing entity ${contract.issuing_entity_id} missing from registry`,
        },
      };
    }

    const consultant = getPerson('david');
    const kind = reqBody.type === 'sick' ? 'sickness' : 'leave';
    const today = todayIsoLocal();

    const context = buildTemplateContext({
      client,
      contract,
      issuingEntity,
      consultant,
      leave: { dates: reqBody.dates, type: reqBody.type },
      today,
    });

    const rendered = renderTemplate({ kind, context });
    const response = TemplatePreviewResponseSchema.parse(rendered);
    return { status: 200, body: response };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return zodIssuesBody(error);
    }
    if (error instanceof DirectClientHasNoAgencyRenewalFlow) {
      return { status: 422, body: { error: error.name, detail: error.message } };
    }
    if (error instanceof TemplateMissing) {
      return { status: 500, body: { error: error.name, detail: error.message } };
    }
    if (error instanceof TemplateContextInvalid) {
      return { status: 422, body: { error: error.name, detail: error.message } };
    }
    console.error('[Contracts mutation] POST /:id/leave-preview error:', error);
    return { status: 500, body: { error: `Failed to render preview: ${errorMessage(error)}` } };
  }
}
