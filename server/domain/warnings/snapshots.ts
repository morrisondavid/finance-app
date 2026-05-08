/**
 * Warning snapshots — improvement-feedback loop (§1.8).
 *
 * Persists one row per warning at the time the consolidated warnings
 * route is read, so a later request can diff today's warnings against
 * an earlier snapshot. When a fingerprint disappears or its severity
 * drops, this module emits an `info`-severity `warning-cleared` /
 * `warning-improved` entry so risk reduction is visible over time.
 *
 * The `fingerprint` is a stable hash over the warning's *identity*
 * (`code` + sorted `sources` + sorted `context` primitives + `entityId`)
 * — deliberately NOT over `severity`, `title`, `detail`, `id` or
 * `recommended_action`, so the same conceptual warning compares equal
 * between snapshots even if its prose / id / severity changes.
 */

import crypto from 'crypto';
import type Database from 'better-sqlite3';
import type {
  EntityFoundationWarning,
  EntityId,
  WarningSeverity,
} from '../../../shared/api-contracts.js';

const KNOWN_ENTITY_IDS: ReadonlySet<EntityId> = new Set([
  'autonize-it-ltd',
  'autonize-it-fzco',
]);

/**
 * Narrow a free-string `entity_id` from the DB into the typed
 * `EntityId | null` the warning schema expects. Unknown values
 * (corrupted snapshot, unseen entity) become `null` rather than
 * blowing up the response.
 */
function narrowEntityId(value: string | null): EntityId | null {
  if (value === null) return null;
  return KNOWN_ENTITY_IDS.has(value as EntityId) ? (value as EntityId) : null;
}

export interface WarningSnapshotRow {
  readonly snapshotAt: string;
  readonly warningId: string;
  readonly code: string;
  readonly severity: WarningSeverity;
  readonly fingerprint: string;
  readonly entityId: string | null;
  readonly title: string;
}

const SEVERITY_RANK: Record<WarningSeverity, number> = {
  info: 0,
  warn: 1,
  critical: 2,
};

/**
 * Build a stable identity hash. Uses sorted JSON for `sources` and
 * `context` so reorderings within a single emitter run don't perturb
 * the fingerprint.
 */
export function fingerprintWarning(w: EntityFoundationWarning): string {
  const sortedSources = [...w.sources].sort();
  const sortedContext: Array<[string, unknown]> = w.context
    ? Object.keys(w.context)
        .sort()
        .map(k => [k, (w.context as Record<string, unknown>)[k]])
    : [];
  const payload = JSON.stringify({
    code: w.code,
    sources: sortedSources,
    context: sortedContext,
    entityId: w.entityId ?? null,
  });
  return crypto.createHash('sha256').update(payload).digest('hex').slice(0, 32);
}

/** Earliest / latest snapshot timestamps for a logical warning fingerprint (§2.3). */
export function getFingerprintTimeline(
  db: Database.Database,
  fingerprint: string,
): { firstSeenAt: string | null; lastActiveAt: string | null } {
  const row = db
    .prepare(
      `
    SELECT MIN(snapshot_at) AS firstSeen, MAX(snapshot_at) AS lastActive
    FROM warning_snapshots
    WHERE fingerprint = ?
  `,
    )
    .get(fingerprint) as { firstSeen: string | null; lastActive: string | null } | undefined;
  if (row === undefined) {
    return { firstSeenAt: null, lastActiveAt: null };
  }
  return {
    firstSeenAt: row.firstSeen ?? null,
    lastActiveAt: row.lastActive ?? null,
  };
}

/** Persist every warning at `snapshotAt`. No-op for an empty array. */
export function recordSnapshot(
  db: Database.Database,
  snapshotAt: string,
  warnings: readonly EntityFoundationWarning[],
): void {
  if (warnings.length === 0) return;
  const insert = db.prepare(`
    INSERT INTO warning_snapshots
      (snapshot_at, warning_id, code, severity, fingerprint, entity_id, title)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const tx = db.transaction((rows: readonly EntityFoundationWarning[]) => {
    for (const w of rows) {
      insert.run(
        snapshotAt,
        w.id,
        w.code,
        w.severity,
        fingerprintWarning(w),
        w.entityId ?? null,
        w.title,
      );
    }
  });
  tx(warnings);
}

/** Read a previously-recorded snapshot's rows, in DB order. */
export function loadSnapshot(db: Database.Database, snapshotAt: string): WarningSnapshotRow[] {
  const stmt = db.prepare(`
    SELECT snapshot_at AS snapshotAt, warning_id AS warningId, code, severity,
           fingerprint, entity_id AS entityId, title
    FROM warning_snapshots
    WHERE snapshot_at = ?
  `);
  return stmt.all(snapshotAt) as WarningSnapshotRow[];
}

/**
 * Most recent `snapshot_at` strictly older than `before`, or null when
 * there's no earlier snapshot.
 */
export function findPreviousSnapshotAt(
  db: Database.Database,
  before: string,
): string | null {
  const row = db
    .prepare(`SELECT MAX(snapshot_at) AS at FROM warning_snapshots WHERE snapshot_at < ?`)
    .get(before) as { at: string | null } | undefined;
  return row?.at ?? null;
}

/** Drop snapshot rows whose `snapshot_at` is strictly older than `cutoff`. */
export function trimSnapshotsBefore(db: Database.Database, cutoff: string): number {
  const info = db
    .prepare(`DELETE FROM warning_snapshots WHERE snapshot_at < ?`)
    .run(cutoff);
  return info.changes;
}

export interface DiffInput {
  readonly now: string;
  readonly currentWarnings: readonly EntityFoundationWarning[];
  readonly previousSnapshot: readonly WarningSnapshotRow[];
  readonly previousSnapshotAt: string;
}

/**
 * Compare today's warnings against a previously-recorded snapshot.
 * Emits two flavours of `info`-severity entry:
 *   - `warning-cleared`: a fingerprint present in `previousSnapshot`
 *     does not appear in `currentWarnings` today.
 *   - `warning-improved`: a fingerprint present in both snapshots, with
 *     a strictly lower severity rank today than previously.
 *
 * Boundary: when `previousSnapshot` is empty (first run, no history),
 * returns an empty array — improvement only makes sense relative to a
 * known prior state.
 */
export function diffAgainstPreviousSnapshot(
  input: DiffInput,
): EntityFoundationWarning[] {
  if (input.previousSnapshot.length === 0) return [];

  const currentByFp = new Map<string, EntityFoundationWarning>();
  for (const w of input.currentWarnings) {
    currentByFp.set(fingerprintWarning(w), w);
  }

  const out: EntityFoundationWarning[] = [];
  const seenFingerprints = new Set<string>();

  for (const prev of input.previousSnapshot) {
    if (seenFingerprints.has(prev.fingerprint)) continue;
    seenFingerprints.add(prev.fingerprint);

    const current = currentByFp.get(prev.fingerprint);
    if (current === undefined) {
      out.push({
        id: `warning-cleared:${prev.fingerprint}`,
        code: 'warning-cleared',
        severity: 'info',
        title: `Cleared: ${prev.title}`,
        detail:
          `A previously emitted ${prev.severity} warning (${prev.code}) is no longer firing today. ` +
          `Last seen on ${prev.snapshotAt}.`,
        recommended_action:
          `No action — improvement noted. Confirm the underlying data is current; clearance only counts when the source data still produces this signal in principle.`,
        sources: [`prev-fingerprint:${prev.fingerprint}`, 'snapshot-diff'],
        entityId: narrowEntityId(prev.entityId),
        context: {
          originalCode: prev.code,
          originalWarningId: prev.warningId,
          previousSeverity: prev.severity,
          previousSnapshotAt: prev.snapshotAt,
        },
      });
      continue;
    }

    if (SEVERITY_RANK[current.severity] < SEVERITY_RANK[prev.severity]) {
      out.push({
        id: `warning-improved:${prev.fingerprint}`,
        code: 'warning-improved',
        severity: 'info',
        title: `Improved: ${current.title}`,
        detail:
          `Severity has dropped from ${prev.severity} to ${current.severity} since ${prev.snapshotAt}. ` +
          `Underlying signal: ${prev.code}.`,
        recommended_action:
          `Keep going — the trajectory is in your favour. Re-checking the underlying signal will tell you what specifically changed.`,
        sources: [`prev-fingerprint:${prev.fingerprint}`, 'snapshot-diff'],
        entityId: narrowEntityId(prev.entityId),
        context: {
          originalCode: prev.code,
          originalWarningId: prev.warningId,
          previousSeverity: prev.severity,
          currentSeverity: current.severity,
          previousSnapshotAt: prev.snapshotAt,
          currentWarningId: current.id,
        },
      });
    }
  }

  return out;
}
