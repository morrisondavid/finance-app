/**
 * TrueLayer transaction API response cache — disk + S3 durable.
 *
 * Default feed-sync behaviour: read local disk, then S3 GetObject when configured;
 * on miss call TrueLayer and write the response back (disk always; S3 when bucket set).
 * Set TRUELAYER_FEED_CACHE_MODE=off only to disable (tests).
 */

import fs from 'fs';
import path from 'path';
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import type { AccountName } from '../../../../shared/api-contracts.js';
import { REPO_ROOT } from '../../../repo-root.js';
import { writeDurableFileSync } from '../../../storage/durable-fs.js';
import {
  resolveBankS3DurableSyncConfig,
  uploadDurableRelPathsToS3,
} from '../../../storage/s3-durable-sync.js';
import type { TrueLayerRawTransaction } from './truelayer-raw-types.js';
import { TrueLayerError } from './truelayer-error.js';

export const TRUELAYER_FEED_CACHE_DIR_REL = 'data/truelayer-feed-cache';

export interface TrueLayerFeedCacheEnvelope {
  readonly provider: 'truelayer';
  readonly fetchedAt: string;
  readonly account: AccountName;
  readonly trueLayerAccountId: string;
  readonly dateFrom: string;
  readonly dateTo: string;
  readonly results: readonly TrueLayerRawTransaction[];
}

/** Default true — cache read/write is on unless explicitly disabled. */
export function isTrueLayerFeedCacheEnabled(
  raw: string | undefined = process.env.TRUELAYER_FEED_CACHE_MODE,
): boolean {
  if (raw === undefined || raw.trim() === '') {
    return true;
  }
  const normalized = raw.trim().toLowerCase();
  return normalized !== 'off' && normalized !== '0' && normalized !== 'false';
}

function sanitizePathSegment(segment: string): string {
  const t = segment.trim();
  if (t === '' || t.includes('..') || t.includes('/') || t.includes('\\')) {
    throw new TrueLayerError('invalid-response', `Invalid TrueLayer cache path segment: ${segment}`);
  }
  return t;
}

export function trueLayerFeedCacheRelPath(
  account: AccountName,
  trueLayerAccountId: string,
  dateFrom: string,
  dateTo: string,
): string {
  const acct = sanitizePathSegment(account);
  const tlId = sanitizePathSegment(trueLayerAccountId);
  const from = sanitizePathSegment(dateFrom);
  const to = sanitizePathSegment(dateTo);
  return `${TRUELAYER_FEED_CACHE_DIR_REL}/${acct}/${tlId}/${from}_${to}.json`;
}

function trueLayerFeedCacheAbsPath(rel: string): string {
  return path.join(REPO_ROOT, ...rel.split('/'));
}

function parseEnvelope(raw: unknown): TrueLayerFeedCacheEnvelope | null {
  if (raw === null || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (o.provider !== 'truelayer') return null;
  if (typeof o.fetchedAt !== 'string') return null;
  if (typeof o.account !== 'string') return null;
  if (typeof o.trueLayerAccountId !== 'string') return null;
  if (typeof o.dateFrom !== 'string' || typeof o.dateTo !== 'string') return null;
  if (!Array.isArray(o.results)) return null;
  return {
    provider: 'truelayer',
    fetchedAt: o.fetchedAt,
    account: o.account as AccountName,
    trueLayerAccountId: o.trueLayerAccountId,
    dateFrom: o.dateFrom,
    dateTo: o.dateTo,
    results: o.results as TrueLayerRawTransaction[],
  };
}

function readEnvelopeFromDisk(rel: string): TrueLayerFeedCacheEnvelope | null {
  const abs = trueLayerFeedCacheAbsPath(rel);
  if (!fs.existsSync(abs)) return null;
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(abs, 'utf-8'));
    return parseEnvelope(parsed);
  } catch {
    return null;
  }
}

async function downloadEnvelopeFromS3(rel: string): Promise<TrueLayerFeedCacheEnvelope | null> {
  const cfg = resolveBankS3DurableSyncConfig();
  if (!cfg) return null;

  const client = new S3Client({ region: cfg.region });
  const key = `${cfg.prefix}${rel}`;
  try {
    const out = await client.send(
      new GetObjectCommand({
        Bucket: cfg.bucket,
        Key: key,
      }),
    );
    const body = await out.Body?.transformToString('utf-8');
    if (body === undefined || body === '') return null;
    const parsed: unknown = JSON.parse(body);
    const envelope = parseEnvelope(parsed);
    if (envelope === null) return null;

    const abs = trueLayerFeedCacheAbsPath(rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    writeDurableFileSync(abs, `${JSON.stringify(envelope, null, 2)}\n`);
    return envelope;
  } catch {
    return null;
  }
}

export interface ReadTrueLayerFeedCacheOpts {
  readonly account: AccountName;
  readonly trueLayerAccountId: string;
  readonly dateFrom: string;
  readonly dateTo: string;
  /** Test override; default follows {@link isTrueLayerFeedCacheEnabled}. */
  readonly enabled?: boolean;
}

/**
 * Load cached raw TrueLayer results. Tries local disk, then S3 GetObject when bucket configured.
 */
export async function readTrueLayerFeedCache(
  opts: ReadTrueLayerFeedCacheOpts,
): Promise<TrueLayerFeedCacheEnvelope | null> {
  const enabled = opts.enabled ?? isTrueLayerFeedCacheEnabled();
  if (!enabled) {
    return null;
  }

  const rel = trueLayerFeedCacheRelPath(
    opts.account,
    opts.trueLayerAccountId,
    opts.dateFrom,
    opts.dateTo,
  );

  const local = readEnvelopeFromDisk(rel);
  if (local !== null) {
    return local;
  }

  return downloadEnvelopeFromS3(rel);
}

export interface WriteTrueLayerFeedCacheOpts {
  readonly account: AccountName;
  readonly trueLayerAccountId: string;
  readonly dateFrom: string;
  readonly dateTo: string;
  readonly results: readonly TrueLayerRawTransaction[];
  /** Test override; default follows {@link isTrueLayerFeedCacheEnabled}. */
  readonly enabled?: boolean;
}

export async function writeTrueLayerFeedCache(opts: WriteTrueLayerFeedCacheOpts): Promise<string> {
  const enabled = opts.enabled ?? isTrueLayerFeedCacheEnabled();
  if (!enabled) {
    return '';
  }

  const rel = trueLayerFeedCacheRelPath(
    opts.account,
    opts.trueLayerAccountId,
    opts.dateFrom,
    opts.dateTo,
  );

  const envelope: TrueLayerFeedCacheEnvelope = {
    provider: 'truelayer',
    fetchedAt: new Date().toISOString(),
    account: opts.account,
    trueLayerAccountId: opts.trueLayerAccountId,
    dateFrom: opts.dateFrom,
    dateTo: opts.dateTo,
    results: opts.results,
  };

  const abs = trueLayerFeedCacheAbsPath(rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  writeDurableFileSync(abs, `${JSON.stringify(envelope, null, 2)}\n`);

  try {
    await uploadDurableRelPathsToS3([rel], 'truelayer-feed-cache');
  } catch (err) {
    console.error('[TrueLayerFeedCache] S3 upload failed:', err);
  }

  return rel;
}
