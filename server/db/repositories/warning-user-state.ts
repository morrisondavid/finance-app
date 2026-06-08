/**
 * §2.3 — persisted per-fingerprint snooze / ack (single-user; key is fingerprint only).
 */

import type Database from 'better-sqlite3';
import type { WarningUserState, WarningUserStateUpsertBody } from '../../../shared/api-contracts.js';
import { recomputeAndPersistDataManifest } from '../../data-manifest.js';
import {
  exportWarningUserStateFromDbToCsv,
} from '../warning-user-state-csv.js';

export interface WarningUserStateRow {
  readonly fingerprint: string;
  readonly snoozedUntil: string | null;
  readonly acknowledgedAt: string | null;
  readonly surface: string | null;
}

function rowToWireState(row: WarningUserStateRow): WarningUserState {
  const o: WarningUserState = {};
  if (row.snoozedUntil !== null) o.snoozedUntil = row.snoozedUntil;
  if (row.acknowledgedAt !== null) o.acknowledgedAt = row.acknowledgedAt;
  if (row.surface !== null) {
    if (row.surface === 'dashboard' || row.surface === 'agent' || row.surface === 'both') {
      o.surface = row.surface;
    }
  }
  return o;
}

export function listWarningUserStateMap(db: Database.Database): Map<string, WarningUserState> {
  const rows = db
    .prepare(
      `SELECT fingerprint, snoozed_until AS snoozedUntil, acknowledged_at AS acknowledgedAt, surface
       FROM warning_user_state`,
    )
    .all() as WarningUserStateRow[];
  const map = new Map<string, WarningUserState>();
  for (const r of rows) {
    map.set(r.fingerprint, rowToWireState(r));
  }
  return map;
}

export function upsertWarningUserState(db: Database.Database, input: WarningUserStateUpsertBody): void {
  const existing = db
    .prepare(
      `SELECT fingerprint, snoozed_until AS snoozedUntil, acknowledged_at AS acknowledgedAt, surface
       FROM warning_user_state WHERE fingerprint = ?`,
    )
    .get(input.fingerprint) as WarningUserStateRow | undefined;

  let snoozedUntil = existing?.snoozedUntil ?? null;
  if (input.clearSnooze === true) snoozedUntil = null;
  else if (input.snoozedUntil !== undefined) snoozedUntil = input.snoozedUntil;

  let acknowledgedAt = existing?.acknowledgedAt ?? null;
  if (input.acknowledgedAt !== undefined) acknowledgedAt = input.acknowledgedAt;

  let surface: string | null = existing?.surface ?? null;
  if (input.surface !== undefined) surface = input.surface;

  db.prepare(
    `INSERT INTO warning_user_state (fingerprint, snoozed_until, acknowledged_at, surface, updated_at)
     VALUES (?, ?, ?, ?, datetime('now'))
     ON CONFLICT(fingerprint) DO UPDATE SET
       snoozed_until = excluded.snoozed_until,
       acknowledged_at = excluded.acknowledged_at,
       surface = excluded.surface,
       updated_at = datetime('now')`,
  ).run(input.fingerprint, snoozedUntil, acknowledgedAt, surface);

  exportWarningUserStateFromDbToCsv(db);
  recomputeAndPersistDataManifest();
}
