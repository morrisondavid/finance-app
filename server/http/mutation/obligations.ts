/**
 * Mutations backing `/api/obligations*` — Express + MCP (`financial_obligations_*` tools).
 */

import {
  CreateDismissalBodySchema,
  CreateObligationBodySchema,
  ObligationStateUpsertBodySchema,
  UpdateObligationBodySchema,
} from '../../../shared/api-contracts.js';
import {
  addDismissal,
  isAutoObligationId,
  NonAutoDismissalError,
  removeDismissal,
} from '../../db/repositories/obligation-dismissals.js';
import {
  createManualObligation,
  deleteManualObligation,
  getObligationById,
  NonManualStateError,
  resetManualObligationState,
  updateManualObligation,
  upsertManualObligationState,
  toApiObligation,
} from '../../db/repositories/obligations.js';
import type { JsonMutationResult } from './types.js';
import { resyncAutoSeedersForTypes, resyncSeederForAutoId } from './obligations-resync.js';

export function mutateFinancialObligationsCreate(body: unknown): JsonMutationResult {
  try {
    const parsed = CreateObligationBodySchema.safeParse(body);
    if (!parsed.success) {
      return {
        status: 400,
        body: { error: `Invalid body: ${parsed.error.issues.map(i => i.message).join(', ')}` },
      };
    }
    const row = createManualObligation(parsed.data);
    resyncAutoSeedersForTypes([row.type]);
    return { status: 201, body: toApiObligation(row) };
  } catch (error) {
    console.error('Error creating obligation:', error);
    return { status: 500, body: { error: 'Failed to create obligation' } };
  }
}

export function mutateFinancialObligationsUpdate(id: string, body: unknown): JsonMutationResult {
  try {
    const existing = getObligationById(id);
    if (!existing) {
      return { status: 404, body: { error: 'Obligation not found' } };
    }
    if (existing.source !== 'manual') {
      return { status: 403, body: { error: 'Cannot edit auto-derived obligations' } };
    }

    const parsed = UpdateObligationBodySchema.safeParse(body);
    if (!parsed.success) {
      return {
        status: 400,
        body: { error: `Invalid body: ${parsed.error.issues.map(i => i.message).join(', ')}` },
      };
    }
    const updated = updateManualObligation(id, parsed.data);
    if (!updated) {
      return { status: 404, body: { error: 'Obligation not found' } };
    }
    resyncAutoSeedersForTypes([existing.type, updated.type]);
    return { status: 200, body: toApiObligation(updated) };
  } catch (error) {
    console.error('Error updating obligation:', error);
    return { status: 500, body: { error: 'Failed to update obligation' } };
  }
}

export function mutateFinancialObligationsDelete(id: string): JsonMutationResult {
  try {
    const existing = getObligationById(id);
    if (!existing) {
      return { status: 404, body: { error: 'Obligation not found' } };
    }
    if (existing.source !== 'manual') {
      return { status: 403, body: { error: 'Cannot delete auto-derived obligations' } };
    }
    deleteManualObligation(id);
    resyncAutoSeedersForTypes([existing.type]);
    return { status: 200, body: { success: true } };
  } catch (error) {
    console.error('Error deleting obligation:', error);
    return { status: 500, body: { error: 'Failed to delete obligation' } };
  }
}

export function mutateFinancialObligationsUpsertState(id: string, body: unknown): JsonMutationResult {
  try {
    const parsed = ObligationStateUpsertBodySchema.safeParse(body);
    if (!parsed.success) {
      return {
        status: 400,
        body: { error: `Invalid body: ${parsed.error.issues.map(i => i.message).join(', ')}` },
      };
    }
    try {
      const row = upsertManualObligationState(id, parsed.data);
      if (!row) {
        return { status: 404, body: { error: 'Obligation not found' } };
      }
      return { status: 200, body: toApiObligation(row) };
    } catch (err) {
      if (err instanceof NonManualStateError) {
        return { status: 400, body: { error: err.message } };
      }
      throw err;
    }
  } catch (error) {
    console.error('Error upserting obligation state:', error);
    return { status: 500, body: { error: 'Failed to update obligation state' } };
  }
}

export function mutateFinancialObligationsResetState(id: string): JsonMutationResult {
  try {
    try {
      const removed = resetManualObligationState(id);
      if (!removed) {
        return { status: 404, body: { error: 'No state override to reset' } };
      }
      return { status: 200, body: { success: true } };
    } catch (err) {
      if (err instanceof NonManualStateError) {
        return { status: 400, body: { error: err.message } };
      }
      throw err;
    }
  } catch (error) {
    console.error('Error resetting obligation state:', error);
    return { status: 500, body: { error: 'Failed to reset obligation state' } };
  }
}

export function mutateFinancialObligationsDismissAuto(body: unknown): JsonMutationResult {
  try {
    const parsed = CreateDismissalBodySchema.safeParse(body);
    if (!parsed.success) {
      return {
        status: 400,
        body: { error: `Invalid body: ${parsed.error.issues.map(i => i.message).join(', ')}` },
      };
    }

    try {
      const saved = addDismissal({
        obligationId: parsed.data.obligationId,
        reason: parsed.data.reason ?? null,
      });
      resyncSeederForAutoId(saved.obligationId);
      return { status: 201, body: saved };
    } catch (err) {
      if (err instanceof NonAutoDismissalError) {
        return { status: 400, body: { error: err.message } };
      }
      throw err;
    }
  } catch (error) {
    console.error('Error creating dismissal:', error);
    return { status: 500, body: { error: 'Failed to create dismissal' } };
  }
}

export function mutateFinancialObligationsUndismissAuto(obligationId: string): JsonMutationResult {
  try {
    if (typeof obligationId !== 'string' || !isAutoObligationId(obligationId)) {
      return { status: 400, body: { error: 'Dismissal id must be an auto-* obligation id' } };
    }
    const removed = removeDismissal(obligationId);
    if (!removed) {
      return { status: 404, body: { error: 'Dismissal not found' } };
    }
    resyncSeederForAutoId(obligationId);
    return { status: 200, body: { success: true } };
  } catch (error) {
    console.error('Error removing dismissal:', error);
    return { status: 500, body: { error: 'Failed to remove dismissal' } };
  }
}
