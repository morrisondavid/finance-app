/**
 * Targeted Upload of durable repo files to S3 (SDK PutObject).
 * Pull from S3 is done on the EC2 host by `aws s3 sync` in `09-docker-run-production.sh`.
 * Resolved when BANK_S3_DURABLE_BUCKET is non-empty — omit locally so uploads are skipped during dev/tests.
 */

import { Upload } from '@aws-sdk/lib-storage';
import { S3Client } from '@aws-sdk/client-s3';
import fs from 'fs';
import path from 'path';
import { REPO_ROOT } from '../repo-root.js';
import { DATA_SYNC_EXCLUDED_BASENAMES, DURABLE_TOP_LEVEL_DIRS } from './durable-paths.js';

export interface BankS3DurableSyncResolvedConfig {
  readonly bucket: string;
  readonly prefix: string;
  readonly region: string;
  readonly sseKmsKeyId?: string;
}

let cachedClient: S3Client | undefined;

function normalizeS3Prefix(prefix: string): string {
  const t = prefix.trim().replace(/^\/+/, '');
  return t === '' ? '' : t.endsWith('/') ? t : `${t}/`;
}

export function resolveBankS3DurableSyncConfig(): BankS3DurableSyncResolvedConfig | null {
  // Durable uploads are a production concern only — a dev machine with the
  // bucket set (e.g. via a shared .env.local) must never push local state
  // to S3, and lacks AWS credentials anyway.
  if (process.env.NODE_ENV !== 'production') {
    return null;
  }
  const bucket = process.env.BANK_S3_DURABLE_BUCKET?.trim();
  if (bucket === undefined || bucket === '') {
    return null;
  }

  const prefix = normalizeS3Prefix(process.env.BANK_S3_DURABLE_PREFIX ?? 'bank-state/prod');
  const region =
    process.env.AWS_REGION?.trim() ||
    process.env.AWS_DEFAULT_REGION?.trim() ||
    'eu-west-2';

  const sseRaw = process.env.BANK_S3_DURABLE_SSE_KMS_KEY_ID?.trim();
  const sseKmsKeyId = sseRaw !== undefined && sseRaw !== '' ? sseRaw : undefined;

  return { bucket, prefix, region, sseKmsKeyId };
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

function normalizeRepoRelativePath(rel: string): string {
  return path.posix.normalize(rel.replace(/\\/g, '/')).replace(/^\/+/, '');
}

function isForbiddenDurablePath(norm: string): boolean {
  return (
    norm === 'secrets' ||
    norm.startsWith('secrets/') ||
    norm.startsWith('node_modules/')
  );
}

/** True when `rel` points at an uploadable durable file under repo root. */
export function isDurableRepoRelativePath(rel: string): boolean {
  const norm = normalizeRepoRelativePath(rel);
  if (norm === '' || norm.startsWith('../') || norm.includes('/../')) {
    return false;
  }
  if (isForbiddenDurablePath(norm)) {
    return false;
  }

  const first = norm.split('/', 2)[0] ?? '';
  const underData = norm === 'data' || norm.startsWith('data/');
  const underDurableRoot = (DURABLE_TOP_LEVEL_DIRS as readonly string[]).includes(first);

  if (!underData && !underDurableRoot) {
    return false;
  }
  if (underData) {
    const base = path.posix.basename(norm);
    if (DATA_SYNC_EXCLUDED_BASENAMES.has(base)) {
      return false;
    }
  }
  return true;
}

/** Allowed relative posix paths rooted at repo — reject `..` and secrets. */
function assertSafeRepoRelative(rel: string): void {
  const norm = normalizeRepoRelativePath(rel);
  if (norm === '' || norm.startsWith('../') || norm.includes('/../')) {
    throw new Error(`[S3Sync] Refusing unsafe durable path: ${rel}`);
  }
  if (isForbiddenDurablePath(norm)) {
    throw new Error(`[S3Sync] Refusing forbidden durable path: ${rel}`);
  }
  if (!isDurableRepoRelativePath(rel)) {
    throw new Error(`[S3Sync] Path not under durable roots: ${rel}`);
  }
}

let uploadTail: Promise<void> = Promise.resolve();

async function uploadDurableRelPathsToS3Impl(
  repoRelativePaths: readonly string[],
  reason: string,
): Promise<void> {
  const cfg = resolveBankS3DurableSyncConfig();
  if (!cfg) return;

  const dedup = [...new Set(repoRelativePaths.filter(p => p.trim() !== ''))].sort((a, b) =>
    a.localeCompare(b),
  );
  if (dedup.length === 0) return;

  for (const rel of dedup) {
    assertSafeRepoRelative(rel);
  }

  const client = getClient(cfg.region);
  const sse = ssePutExtras(cfg);

  console.log(`[S3Sync] Upload ${String(dedup.length)} object(s) (${reason}) → s3://${cfg.bucket}/${cfg.prefix}`);

  for (const rel of dedup) {
    const abs = path.join(REPO_ROOT, ...rel.split('/'));
    if (!fs.existsSync(abs)) {
      console.warn(`[S3Sync] Skip missing file: ${rel}`);
      continue;
    }
    const st = fs.statSync(abs);
    if (!st.isFile()) {
      console.warn(`[S3Sync] Skip non-file: ${rel}`);
      continue;
    }
    const key = `${cfg.prefix}${rel}`;
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

  console.log(`[S3Sync] Upload finished (${String(dedup.length)} path(s))`);
}

/** Queue uploads so callers can fire-and-forget without overlapping streams. */
export async function uploadDurableRelPathsToS3(
  repoRelativePaths: readonly string[],
  reason: string,
): Promise<void> {
  const job = uploadTail.then(() =>
    uploadDurableRelPathsToS3Impl(repoRelativePaths, reason).catch(err => {
      console.error('[S3Sync] Targeted upload failed:', err);
    }),
  );
  uploadTail = job;
  await job;
}
