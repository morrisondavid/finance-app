/**
 * Request-scoped read context — deduplicates expensive pure reads within one
 * HTTP/MCP request (forecast inputs, expenses pipeline, consolidated warnings).
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import type Database from 'better-sqlite3';
import {
  buildConsolidatedWarningsResponse,
  type BuildConsolidatedWarningsOptions,
} from '../domain/warnings/consolidated-feed.js';
import {
  runExpensesOverviewPipeline,
} from '../utils/expenses-overview-pipeline.js';
import type { PipelineResult } from '../utils/recurring-pipeline.js';
import type { LoadedForecastInputs } from '../domain/forecast/load-inputs.js';

interface ReadContextBag {
  readonly forecastInputsByKey: Map<string, LoadedForecastInputs>;
  expensesPipeline?: PipelineResult;
  consolidatedWarnings?: ReturnType<typeof buildConsolidatedWarningsResponse>;
  consolidatedWarningsKey?: string;
}

const readContextStorage = new AsyncLocalStorage<ReadContextBag>();

function createReadContextBag(): ReadContextBag {
  return { forecastInputsByKey: new Map() };
}

export function getReadContext(): ReadContextBag | undefined {
  return readContextStorage.getStore();
}

/** Establish a per-request bag for downstream read deduplication. */
export function withReadContext<T>(fn: () => T): T {
  const existing = readContextStorage.getStore();
  if (existing !== undefined) {
    return fn();
  }
  return readContextStorage.run(createReadContextBag(), fn);
}

/** One {@link runExpensesOverviewPipeline} per request when inside read context. */
export function runExpensesOverviewPipelineWithReadContext(): PipelineResult {
  const ctx = getReadContext();
  if (ctx === undefined) {
    return runExpensesOverviewPipeline();
  }
  if (ctx.expensesPipeline === undefined) {
    ctx.expensesPipeline = runExpensesOverviewPipeline();
  }
  return ctx.expensesPipeline;
}

/** Consolidated warnings composer with request-scoped singleton when applicable. */
export function buildConsolidatedWarningsResponseWithReadContext(
  db: Database.Database,
  options: BuildConsolidatedWarningsOptions = {},
): ReturnType<typeof buildConsolidatedWarningsResponse> {
  const ctx = getReadContext();
  const snoozeKey = String(options.applySnoozeListingFilter ?? true);
  if (
    ctx !== undefined &&
    ctx.consolidatedWarnings !== undefined &&
    ctx.consolidatedWarningsKey === snoozeKey
  ) {
    return ctx.consolidatedWarnings;
  }

  const pipeline = runExpensesOverviewPipelineWithReadContext();
  const result = buildConsolidatedWarningsResponse(db, {
    ...options,
    preloaded: { pipeline, ...options.preloaded },
  });

  if (ctx !== undefined) {
    ctx.consolidatedWarnings = result;
    ctx.consolidatedWarningsKey = snoozeKey;
  }

  return result;
}

/** Express middleware: GET `/api/*` handlers share one read context per request. */
export function readContextMiddleware(
  req: { method: string; path: string },
  _res: unknown,
  next: () => void,
): void {
  if (req.method !== 'GET' || !req.path.startsWith('/api/')) {
    next();
    return;
  }
  withReadContext(next);
}
