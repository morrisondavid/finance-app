/**
 * CSV I/O for `debt-strategy/plans.csv` (§1.9).
 *
 * Read AND write — plans mutate via the `/api/debt-strategy` route
 * (activate, pause, complete, delete). Every mutation re-exports the
 * canonical CSV so the file is always authoritative on disk; the
 * registry is the materialised view rebuilt on startup.
 *
 * Critical invariant: rows with `status === 'suggested'` MUST NOT
 * appear in the persisted CSV. Suggested plans are ephemeral
 * route-level entities computed fresh by `auto-suggest-plans` on each
 * call. The writer filters them out; a test locks this.
 */

import path from 'path';
import {
  PlanSchema,
  PlanPersistedStatusSchema,
  type Plan,
  type PlanPersistedStatus,
} from './schema.js';
import {
  createCsvDecoders,
  nullIfEmpty,
  readCsvRecords,
} from '../../utils/csv-decoders.js';
import { atomicWriteCsv, escapeCsvField } from '../../utils/csv-helpers.js';

const decoders = createCsvDecoders('Plan');
const {
  requireNonEmpty,
  decodeNumber,
  decodeNullableNumber,
  decodeIsoDate,
  decodeNullableIsoDate,
} = decoders;

export const PLANS_CSV_FILENAME = 'plans.csv';

export const PLAN_CSV_HEADERS = [
  'id',
  'display_name',
  'goal_type',
  'target_id',
  'target_amount',
  'target_account',
  'target_date_or_asap',
  'currency',
  'scope',
  'intensity',
  'monthly_allocation',
  'status',
  'activated_at',
  'completed_at',
  'projected_completion_date',
  'notes',
  'updated_at',
] as const;

export function getPlansCsvPath(debtStrategyDir: string): string {
  return path.join(debtStrategyDir, PLANS_CSV_FILENAME);
}

const ISO_DATE_OR_ASAP_RE = /^(?:ASAP|\d{4}-\d{2}-\d{2})$/;

function decodeIsoDateOrAsap(value: string | undefined, field: string, rowId: string): string {
  const raw = requireNonEmpty(value, field, rowId);
  if (!ISO_DATE_OR_ASAP_RE.test(raw)) {
    throw new Error(`Plan ${rowId}: ${field} must be 'ASAP' or yyyy-mm-dd, got '${raw}'`);
  }
  return raw;
}

function decodePersistedStatus(value: string | undefined, rowId: string): PlanPersistedStatus {
  const raw = requireNonEmpty(value, 'status', rowId);
  const parsed = PlanPersistedStatusSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(
      `Plan ${rowId}: status must be one of active|paused|completed (NOT 'suggested' — those are ephemeral), got '${raw}'`,
    );
  }
  return parsed.data;
}

export function parsePlanRow(row: Record<string, string>): Plan {
  const rowId = nullIfEmpty(row.id) ?? '<missing-id>';
  return PlanSchema.parse({
    id: requireNonEmpty(row.id, 'id', rowId),
    display_name: requireNonEmpty(row.display_name, 'display_name', rowId),
    goal_type: requireNonEmpty(row.goal_type, 'goal_type', rowId),
    target_id: nullIfEmpty(row.target_id),
    target_amount: decodeNullableNumber(row.target_amount, 'target_amount', rowId),
    target_account: requireNonEmpty(row.target_account, 'target_account', rowId),
    target_date_or_asap: decodeIsoDateOrAsap(row.target_date_or_asap, 'target_date_or_asap', rowId),
    currency: requireNonEmpty(row.currency, 'currency', rowId),
    scope: requireNonEmpty(row.scope, 'scope', rowId),
    intensity: requireNonEmpty(row.intensity, 'intensity', rowId),
    monthly_allocation: decodeNumber(row.monthly_allocation, 'monthly_allocation', rowId),
    status: decodePersistedStatus(row.status, rowId),
    activated_at: decodeIsoDate(row.activated_at, 'activated_at', rowId),
    completed_at: decodeNullableIsoDate(row.completed_at, 'completed_at', rowId),
    projected_completion_date: decodeNullableIsoDate(
      row.projected_completion_date,
      'projected_completion_date',
      rowId,
    ),
    notes: nullIfEmpty(row.notes),
    updated_at: decodeIsoDate(row.updated_at, 'updated_at', rowId),
  });
}

export function readPlansCsvFile(csvPath: string): Plan[] {
  const rows: Plan[] = [];
  for (const row of readCsvRecords(csvPath)) {
    if (!nullIfEmpty(row.id)) continue;
    rows.push(parsePlanRow(row));
  }
  return rows;
}

function planToCsvRow(p: Plan): string {
  const cells = [
    p.id,
    escapeCsvField(p.display_name),
    p.goal_type,
    p.target_id ?? '',
    p.target_amount === null ? '' : String(p.target_amount),
    p.target_account,
    p.target_date_or_asap,
    p.currency,
    p.scope,
    p.intensity,
    String(p.monthly_allocation),
    p.status,
    p.activated_at,
    p.completed_at ?? '',
    p.projected_completion_date ?? '',
    p.notes === null ? '' : escapeCsvField(p.notes),
    p.updated_at,
  ];
  return cells.join(',');
}

/**
 * Write all plans to CSV atomically. **Filters out `status='suggested'`
 * rows** — suggested plans are ephemeral and must never persist. A test
 * locks this invariant by force-constructing an invalid input. In
 * normal use, `Plan.status` is type-narrowed to active|paused|completed
 * so the filter is a runtime safety net.
 */
export function writePlansCsvFile(csvPath: string, plans: readonly Plan[]): void {
  const persistable = plans.filter(
    p => (p.status as string) !== 'suggested',
  );
  const sorted = [...persistable].sort((a, b) => a.id.localeCompare(b.id));
  const lines = [PLAN_CSV_HEADERS.join(',')];
  for (const p of sorted) {
    lines.push(planToCsvRow(p));
  }
  atomicWriteCsv(csvPath, `${lines.join('\n')}\n`);
}
