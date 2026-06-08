/**
 * Append-only operational log for feed sync runs (`data/feed-sync-events.jsonl`).
 * Mirrors each line to stdout for `docker logs` parity with the old host cron log.
 */

import fs from 'fs';
import path from 'path';
import {
  FEED_SYNC_EVENTS_REL_PATH,
  FeedSyncEventSchema,
  type AccountName,
  type FeedSyncEvent,
  type FeedSyncEventDetail,
  type FeedSyncEventKind,
  type FeedSyncEventLevel,
  type FeedSyncRunTrigger,
} from '../../../shared/api-contracts.js';
import { REPO_ROOT } from '../../repo-root.js';

export const FEED_SYNC_EVENT_LOG_MAX_LINES = 5000;
const MAX_STACK_LENGTH = 16_384;

export interface FormattedFeedSyncError {
  readonly message: string;
  readonly stack?: string;
  readonly code?: string;
  readonly cause?: string;
}

export interface FeedSyncEventInput {
  readonly runId: string;
  readonly trigger: FeedSyncRunTrigger;
  readonly level: FeedSyncEventLevel;
  readonly kind: FeedSyncEventKind;
  readonly message: string;
  readonly account?: AccountName;
  readonly provider?: 'truelayer' | 'enable';
  readonly detail?: FeedSyncEventDetail;
  readonly stack?: string;
  readonly code?: string;
}

export interface FeedSyncRunLogger {
  readonly runId: string;
  readonly trigger: FeedSyncRunTrigger;
  readonly logEvent: (input: Omit<FeedSyncEventInput, 'runId' | 'trigger'>) => void;
}

function capStack(stack: string): string {
  if (stack.length <= MAX_STACK_LENGTH) {
    return stack;
  }
  return `${stack.slice(0, MAX_STACK_LENGTH)}\n… (truncated)`;
}

function errorCodeFromUnknown(err: unknown): string | undefined {
  if (typeof err === 'object' && err !== null && 'code' in err) {
    const code = (err as { code: unknown }).code;
    if (typeof code === 'string') {
      return code;
    }
  }
  return undefined;
}

function causeMessageFromUnknown(err: unknown): string | undefined {
  if (typeof err !== 'object' || err === null || !('cause' in err)) {
    return undefined;
  }
  const cause = (err as { cause: unknown }).cause;
  if (cause === undefined) {
    return undefined;
  }
  if (cause instanceof Error) {
    return cause.message;
  }
  return String(cause);
}

export function formatFeedSyncError(err: unknown): FormattedFeedSyncError {
  if (err instanceof Error) {
    const stack = err.stack !== undefined ? capStack(err.stack) : undefined;
    const code = errorCodeFromUnknown(err);
    const cause = causeMessageFromUnknown(err);
    return {
      message: err.message,
      stack,
      ...(code === undefined ? {} : { code }),
      ...(cause === undefined ? {} : { cause }),
    };
  }
  return { message: 'Unknown error' };
}

export function feedSyncEventLogPath(root: string = REPO_ROOT): string {
  return path.join(root, FEED_SYNC_EVENTS_REL_PATH);
}

function mirrorEventToConsole(event: FeedSyncEvent): void {
  const parts = [
    '[feed-sync]',
    event.at,
    event.runId.slice(0, 8),
    event.kind,
  ];
  if (event.account !== undefined) {
    parts.push(event.account);
  }
  parts.push(event.message);
  const line = parts.join(' ');
  if (event.level === 'error') {
    console.error(line);
    if (event.stack !== undefined) {
      console.error(event.stack);
    }
  } else if (event.level === 'warn') {
    console.warn(line);
  } else {
    console.log(line);
  }
}

function trimEventLogLines(filePath: string, maxLines: number): void {
  if (!fs.existsSync(filePath)) {
    return;
  }
  let raw: string;
  try {
    raw = fs.readFileSync(filePath, 'utf-8');
  } catch {
    return;
  }
  const lines = raw.split('\n').filter(line => line.trim() !== '');
  if (lines.length <= maxLines) {
    return;
  }
  const trimmed = lines.slice(lines.length - maxLines);
  fs.writeFileSync(filePath, `${trimmed.join('\n')}\n`, 'utf-8');
}

export function appendFeedSyncEvent(
  input: FeedSyncEventInput,
  root: string = REPO_ROOT,
  maxLines: number = FEED_SYNC_EVENT_LOG_MAX_LINES,
): FeedSyncEvent {
  const event = FeedSyncEventSchema.parse({
    at: new Date().toISOString(),
    ...input,
  });

  const filePath = feedSyncEventLogPath(root);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.appendFileSync(filePath, `${JSON.stringify(event)}\n`, 'utf-8');
  trimEventLogLines(filePath, maxLines);
  mirrorEventToConsole(event);
  return event;
}

export function createFeedSyncRunLogger(
  runId: string,
  trigger: FeedSyncRunTrigger,
  root: string = REPO_ROOT,
): FeedSyncRunLogger {
  return {
    runId,
    trigger,
    logEvent: input => {
      appendFeedSyncEvent({ runId, trigger, ...input }, root);
    },
  };
}

export function readFeedSyncEventsForRun(
  runId: string,
  root: string = REPO_ROOT,
  limit?: number,
): FeedSyncEvent[] {
  const filePath = feedSyncEventLogPath(root);
  if (!fs.existsSync(filePath)) {
    return [];
  }

  let raw: string;
  try {
    raw = fs.readFileSync(filePath, 'utf-8');
  } catch {
    return [];
  }

  const events: FeedSyncEvent[] = [];
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (trimmed === '') {
      continue;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed) as unknown;
    } catch {
      continue;
    }
    const result = FeedSyncEventSchema.safeParse(parsed);
    if (!result.success || result.data.runId !== runId) {
      continue;
    }
    events.push(result.data);
  }

  if (limit !== undefined && events.length > limit) {
    return events.slice(events.length - limit);
  }
  return events;
}
