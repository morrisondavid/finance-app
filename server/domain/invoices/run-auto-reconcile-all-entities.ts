/**
 * Central auto-reconcile runner — reference-exact matches for both entities,
 * then payment/status drift sync. Used on startup, statement upload, and feed sync.
 */

import type { EntityId } from '../../../shared/api-contracts.js';
import {
  autoReconcileHighConfidence,
  syncInvoiceStatusesFromPayments,
  type AutoReconcileHighConfidenceInput,
  type AutoReconcileHighConfidenceResult,
} from './auto-reconcile.js';

const RECONCILE_ENTITY_IDS: readonly EntityId[] = [
  'autonize-it-ltd',
  'autonize-it-fzco',
];

export interface RunAutoReconcileAllEntitiesResult {
  readonly byEntity: Readonly<Partial<Record<EntityId, AutoReconcileHighConfidenceResult>>>;
  readonly statusUpdates: readonly { readonly invoiceId: string; readonly status: 'paid' | 'partial' }[];
}

export function runAutoReconcileAllEntities(
  input: AutoReconcileHighConfidenceInput = {},
): RunAutoReconcileAllEntitiesResult {
  const byEntity: Partial<Record<EntityId, AutoReconcileHighConfidenceResult>> = {};

  for (const entityId of RECONCILE_ENTITY_IDS) {
    try {
      const result = autoReconcileHighConfidence({ ...input, entityId });
      byEntity[entityId] = result;
      console.log(
        `[auto-reconcile] ${entityId}: persisted=${String(result.persisted.length)} `
          + `status_updates=${String(result.statusUpdates.length)}`,
      );
    } catch (err) {
      console.error(`[auto-reconcile] ${entityId} failed:`, err);
    }
  }

  let statusUpdates: readonly { invoiceId: string; status: 'paid' | 'partial' }[] = [];
  try {
    statusUpdates = syncInvoiceStatusesFromPayments({});
    if (statusUpdates.length > 0) {
      console.log(
        `[auto-reconcile] syncInvoiceStatusesFromPayments: ${String(statusUpdates.length)} update(s)`,
      );
    }
  } catch (err) {
    console.error('[auto-reconcile] syncInvoiceStatusesFromPayments failed:', err);
  }

  return { byEntity, statusUpdates };
}
