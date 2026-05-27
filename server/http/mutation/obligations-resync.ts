/**
 * Rerun auto-seeders after obligation mutations so registry + dismissals stay coherent.
 * Shared by Express routes and `financial_obligations_*` MCP tools.
 */

import { deriveAndInsertAutoSaObligations } from '../../db/repositories/sa-auto-seed.js';
import { deriveAndInsertAutoObligations as deriveAndInsertAutoVatObligations } from '../../db/repositories/vat-auto-seed.js';
import { deriveAndInsertAutoCtObligations } from '../../db/repositories/ct-auto-seed.js';
import { deriveAndInsertAutoTtpObligations } from '../../db/repositories/hmrc-ttp-auto-seed.js';

/** Rerun seeders for obligation types touched by a manual CRUD mutation. */
export function resyncAutoSeedersForTypes(types: Array<string | undefined | null>): void {
  const affected = new Set(types.filter((t): t is string => typeof t === 'string'));
  if (affected.has('self-assessment')) {
    try {
      deriveAndInsertAutoSaObligations();
    } catch (err) {
      console.error('[Obligations] SA resync after mutation failed:', err);
    }
  }
  if (affected.has('corporation-tax')) {
    try {
      deriveAndInsertAutoCtObligations();
    } catch (err) {
      console.error('[Obligations] CT resync after mutation failed:', err);
    }
  }
}

/** Rerun the auto-seeder responsible for a dismissed auto obligation id. */
export function resyncSeederForAutoId(obligationId: string): void {
  try {
    if (obligationId.startsWith('auto-sa-')) {
      deriveAndInsertAutoSaObligations();
    } else if (obligationId.startsWith('auto-vat-')) {
      deriveAndInsertAutoVatObligations();
    } else if (obligationId.startsWith('auto-ct-')) {
      deriveAndInsertAutoCtObligations();
    } else if (obligationId.startsWith('auto-ttp-')) {
      deriveAndInsertAutoTtpObligations();
    }
  } catch (err) {
    console.error('[Obligations] Dismissal resync failed:', err);
  }
}
