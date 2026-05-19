/**
 * Pull durable repo trees from S3 before SQLite opens; push after checkpoints.
 * Gated by BANK_S3_DURABLE_SYNC=1 plus BANK_S3_DURABLE_BUCKET / PREFIX (see README).
 */

import {
  GetObjectCommand,
  ListObjectsV2Command,
  S3Client,
} from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import fs, { createWriteStream } from 'fs';
import path from 'path';
import { pipeline } from 'stream/promises';
import { getDb } from '../db/connection.js';
import { REPO_ROOT } from '../repo-root.js';
import {
  DATA_SYNC_EXCLUDED_BASENAMES,
  DURABLE_TOP_LEVEL_DIRS,
} from './durable-paths.js';

export interface BankS3DurableSyncResolvedConfig {
  readonly bucket: string;
  readonly prefix: string;
  readonly region: string;
  readonly sseKmsKeyId?: string;
  readonly pushIntervalMs: number;
}

let cachedClient: S3Client | undefined;

function normalizeS3Prefix(prefix: string): string {
  const t = prefix.trim().replace(/^\/+/, '');
  return t === '' ? '' : t.endsWith('/') ? t : `${t}/`;
}

export function resolveBankS3DurableSyncConfig(): BankS3DurableSyncResolvedConfig | null {
  const raw = process.env.BANK_S3_DURABLE_SYNC?.trim().toLowerCase();
  if (raw !== '1' && raw !== 'true') return null;

  const bucket = process.env.BANK_S3_DURABLE_BUCKET?.trim();
  if (!bucket || bucket === '') {
    console.warn(
      '[S3Sync] BANK_S3_DURABLE_SYNC is enabled but BANK_S3_DURABLE_BUCKET is missing — sync disabled.',
    );
    return null;
  }

  const prefix = normalizeS3Prefix(process.env.BANK_S3_DURABLE_PREFIX ?? 'bank-state/prod');
  const region =
    process.env.AWS_REGION?.trim() ||
    process.env.AWS_DEFAULT_REGION?.trim() ||
    'eu-west-2';

  const sseRaw = process.env.BANK_S3_DURABLE_SSE_KMS_KEY_ID?.trim();
  const sseKmsKeyId = sseRaw !== undefined && sseRaw !== '' ? sseRaw : undefined;

  const pushRaw = process.env.BANK_S3_DURABLE_PUSH_INTERVAL_MS?.trim();
  let pushIntervalMs = 1800000;
  if (pushRaw !== undefined && pushRaw !== '') {
    const n = Number.parseInt(pushRaw, 10);
    if (!Number.isFinite(n) || n < 60000) {
      console.warn('[S3Sync] Invalid BANK_S3_DURABLE_PUSH_INTERVAL_MS — using 1800000');
    } else {
      pushIntervalMs = n;
    }
  }

  return { bucket, prefix, region, sseKmsKeyId, pushIntervalMs };
}

function getClient(region: string): S3Client {
  if (!cachedClient) {
    cachedClient = new S3Client({ region });
  }
  return cachedClient;
}

function ssePutExtras(cfg: BankS3DurableSyncResolvedConfig): Record<string, string | undefined> {
  if (cfg.sseKmsKeyId !== undefined) {
    return {
      ServerSideEncryption: 'aws:kms',
      SSEKMSKeyId: cfg.sseKmsKeyId,
    };
  }
  return {};
}

/** Walk regular files under absRoot; emitted paths use posix separators relative to relPrefixDir (e.g. `statements`). */
function walkRegularFiles(absRoot: string, relPrefixDir: string): string[] {
  const results: string[] = [];
  if (!fs.existsSync(absRoot)) return results;

  const stack: Array<{ abs: string; rel: string }> = [{ abs: absRoot, rel: relPrefixDir }];
  while (stack.length > 0) {
    const { abs, rel } = stack.pop()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(abs, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const ent of entries) {
      if (ent.name.startsWith('.')) continue;
      const absChild = path.join(abs, ent.name);
      const relChild = `${rel}/${ent.name}`.replace(/\\/g, '/');
      if (ent.isDirectory()) {
        stack.push({ abs: absChild, rel: relChild });
      } else if (ent.isFile()) {
        results.push(relChild);
      }
    }
  }
  return results;
}

function collectLocalRelativePaths(repoRoot: string): string[] {
  const rels = new Set<string>();
  for (const top of DURABLE_TOP_LEVEL_DIRS) {
    const absTop = path.join(repoRoot, top);
    for (const r of walkRegularFiles(absTop, top)) {
      rels.add(r);
    }
  }

  const dataRoot = path.join(repoRoot, 'data');
  if (fs.existsSync(dataRoot)) {
    for (const r of walkRegularFiles(dataRoot, 'data')) {
      const base = path.basename(r);
      if (DATA_SYNC_EXCLUDED_BASENAMES.has(base)) continue;
      rels.add(r);
    }
  }

  return [...rels].sort((a, b) => a.localeCompare(b));
}

function relativeFromKey(fullPrefix: string, key: string): string | null {
  if (!key.startsWith(fullPrefix)) return null;
  const rest = key.slice(fullPrefix.length);
  if (rest === '' || rest.includes('..')) return null;
  return rest;
}

function isAllowedPullRelative(relPosix: string): boolean {
  const seg = relPosix.split('/');
  const top = seg[0];
  if (top === 'data') {
    const base = seg[seg.length - 1];
    return !DATA_SYNC_EXCLUDED_BASENAMES.has(base);
  }
  return (DURABLE_TOP_LEVEL_DIRS as readonly string[]).includes(top);
}

export async function bootstrapPullFromS3IfEnabled(): Promise<void> {
  const cfg = resolveBankS3DurableSyncConfig();
  if (!cfg) return;

  const client = getClient(cfg.region);
  const fullPrefix = cfg.prefix;

  console.log(`[S3Sync] Pulling durable state from s3://${cfg.bucket}/${fullPrefix}`);

  let ContinuationToken: string | undefined;
  let pulled = 0;
  do {
    const resp = await client.send(
      new ListObjectsV2Command({
        Bucket: cfg.bucket,
        Prefix: fullPrefix,
        ContinuationToken,
      }),
    );

    for (const obj of resp.Contents ?? []) {
      const key = obj.Key;
      if (!key || key.endsWith('/')) continue;

      const rel = relativeFromKey(fullPrefix, key);
      if (!rel || !isAllowedPullRelative(rel)) continue;

      const destAbs = path.join(REPO_ROOT, ...rel.split('/'));
      const getResp = await client.send(new GetObjectCommand({ Bucket: cfg.bucket, Key: key }));
      const body = getResp.Body;
      if (!body) continue;

      await fs.promises.mkdir(path.dirname(destAbs), { recursive: true });
      const tmp = `${destAbs}.s3pull.tmp`;
      try {
        await pipeline(body as NodeJS.ReadableStream, createWriteStream(tmp));
        await fs.promises.rename(tmp, destAbs);
        pulled += 1;
      } catch (err) {
        await fs.promises.rm(tmp, { force: true }).catch(() => undefined);
        throw err;
      }
    }

    ContinuationToken = resp.IsTruncated ? resp.NextContinuationToken : undefined;
  } while (ContinuationToken !== undefined);

  console.log(`[S3Sync] Pull finished (${String(pulled)} object(s))`);
}

export function checkpointSqliteWalTruncate(): void {
  try {
    const db = getDb();
    db.pragma('wal_checkpoint(TRUNCATE)');
  } catch {
    // Database may not be initialized yet — ignore.
  }
}

let pushTail: Promise<void> = Promise.resolve();

async function pushDurableStateToS3Impl(reason: string): Promise<void> {
  const cfg = resolveBankS3DurableSyncConfig();
  if (!cfg) return;

  checkpointSqliteWalTruncate();

  const client = getClient(cfg.region);
  const fullPrefix = cfg.prefix;
  const relPaths = collectLocalRelativePaths(REPO_ROOT);

  console.log(`[S3Sync] Pushing durable state (${reason}) → s3://${cfg.bucket}/${fullPrefix}`);

  const sse = ssePutExtras(cfg);

  for (const rel of relPaths) {
    const abs = path.join(REPO_ROOT, ...rel.split('/'));
    const key = `${fullPrefix}${rel}`;

    const upload = new Upload({
      client,
      params: {
        Bucket: cfg.bucket,
        Key: key,
        Body: fs.createReadStream(abs),
        ...sse,
      },
    });

    await upload.done();
  }

  console.log(`[S3Sync] Push finished (${String(relPaths.length)} object(s))`);
}

export async function pushDurableStateToS3(reason: string): Promise<void> {
  const job = pushTail.then(() => pushDurableStateToS3Impl(reason));
  pushTail = job.catch(err => {
    console.error('[S3Sync] Push failed:', err);
  });
  await job;
}

/** Periodic upload in production only (unless overridden later). */
export function startPeriodicS3DurablePush(): NodeJS.Timeout | null {
  const cfg = resolveBankS3DurableSyncConfig();
  if (!cfg) return null;
  if (process.env.NODE_ENV !== 'production') return null;

  return setInterval(() => {
    void pushDurableStateToS3('periodic');
  }, cfg.pushIntervalMs);
}
