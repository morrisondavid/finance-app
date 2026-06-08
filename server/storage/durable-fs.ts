/**
 * Atomic durable file writes with automatic S3 publish.
 * Single chokepoint: any write under a durable root uploads via {@link uploadDurableRelPathsToS3}.
 */

import fs from 'fs';
import path from 'path';
import { REPO_ROOT } from '../repo-root.js';
import { isDurableRepoRelativePath, uploadDurableRelPathsToS3 } from './s3-durable-sync.js';

let uploadsSuppressed = false;

export function setDurableUploadsSuppressed(suppressed: boolean): void {
  uploadsSuppressed = suppressed;
}

export function areDurableUploadsSuppressed(): boolean {
  return uploadsSuppressed;
}

export function resetDurableUploadsSuppressedForTests(): void {
  uploadsSuppressed = false;
}

function repoRelativePath(absPath: string): string | null {
  const rel = path.relative(REPO_ROOT, absPath).split(path.sep).join('/');
  if (rel.startsWith('..')) {
    return null;
  }
  return rel;
}

function durableReasonFor(rel: string): string {
  const first = rel.split('/', 1)[0];
  return first !== undefined && first !== '' ? first : 'durable';
}

function maybePublish(absPath: string): void {
  if (uploadsSuppressed) {
    return;
  }
  const rel = repoRelativePath(absPath);
  if (rel === null || !isDurableRepoRelativePath(rel)) {
    return;
  }
  void uploadDurableRelPathsToS3([rel], durableReasonFor(rel));
}

/** Atomic write to disk; auto-publish to S3 when under a durable root. */
export function writeDurableFileSync(absPath: string, content: string | Buffer): void {
  const dir = path.dirname(absPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const tmp = `${absPath}.tmp`;
  fs.writeFileSync(tmp, content);
  fs.renameSync(tmp, absPath);
  maybePublish(absPath);
}

/**
 * Append one line to a durable file; auto-publish after append when under a durable root.
 * Not used for batched logs that upload explicitly at run end (e.g. feed-sync-events.jsonl).
 */
export function appendDurableFileSync(absPath: string, line: string): void {
  const dir = path.dirname(absPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.appendFileSync(absPath, line, 'utf-8');
  maybePublish(absPath);
}
