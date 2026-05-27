/**
 * POST `/api/contracts/:id/renew` — validated JSON placeholder (501 until full renew flow lands).
 */

import { z } from 'zod';
import { findContractById } from '../../domain/contracts/index.js';
import { parseContractId } from '../read/contracts.js';
import type { JsonMutationResult } from './types.js';

export const ContractRenewRequestSchema = z.object({
  start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  day_rate: z.number().nonnegative().optional(),
});

export function mutateContractsRequestRenewal(rawContractId: string, body: unknown): JsonMutationResult {
  const parsedId = parseContractId(rawContractId);
  if (parsedId === null) {
    return { status: 404, body: { error: 'Contract not found' } };
  }
  const contract = findContractById(parsedId);
  if (!contract) {
    return { status: 404, body: { error: 'Contract not found' } };
  }

  const parsed = ContractRenewRequestSchema.safeParse(body);
  if (!parsed.success) {
    return {
      status: 400,
      body: {
        error: 'Invalid request',
        details: parsed.error.issues,
      },
    };
  }

  return {
    status: 501,
    body: {
      error: 'RenewFlowNotImplemented',
      detail:
        "Renewals aren't wired through to contracts.csv yet. Your inputs were accepted and validated — the next shipment will persist them, supersede the old contract row, and re-seed the renewal deadline.",
      received: {
        contract_id: contract.id,
        start_date: parsed.data.start_date,
        end_date: parsed.data.end_date,
        day_rate: parsed.data.day_rate ?? null,
      },
    },
  };
}
