/**
 * §3.1 — Persisted net-worth snapshot history from canonical CSV (agent read slice).
 */

import type { AiNetWorthHistoryResponse } from '../../../shared/api-contracts.js';
import {
  AiNetWorthHistoryResponseSchema,
  NetWorthSnapshotRowSchema,
} from '../../../shared/api-contracts.js';
import { listNetWorthSnapshotsFromDisk } from '../net-worth/snapshot.js';
import { AI_MANIFEST_SCHEMA_VERSION } from './constants.js';

function csvRowToWire(row: ReturnType<typeof listNetWorthSnapshotsFromDisk>[number]) {
  return NetWorthSnapshotRowSchema.parse({
    periodKey: row.periodKey,
    snapshotDate: row.snapshotDate,
    entityId: row.entityId,
    reportingCurrency: row.reportingCurrency,
    cadence: row.cadence,
    totalCashGbp: row.totalCashGbp,
    totalCreditGbp: row.totalCreditGbp,
    totalObligations12mGbp: row.totalObligations12mGbp,
    totalDebtGbp: row.totalDebtGbp,
    netGbp: row.netGbp,
    formulaVersion: row.formulaVersion,
    capturedAt: row.capturedAt,
  });
}

export function composeAiNetWorthHistory(opts: { readonly generatedAt?: string } = {}): AiNetWorthHistoryResponse {
  const rows = listNetWorthSnapshotsFromDisk();
  const snapshots = rows.map(csvRowToWire);
  return AiNetWorthHistoryResponseSchema.parse({
    generatedAt: opts.generatedAt ?? new Date().toISOString(),
    schemaVersion: AI_MANIFEST_SCHEMA_VERSION,
    snapshots,
  });
}
