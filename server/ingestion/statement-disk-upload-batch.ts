/**
 * Disk-backed statement upload batch (`POST /api/upload/:account/:type`) —
 * extracted for reuse by the Express router and MCP base64 ingestion.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { normalizeFileOnDisk } from '../utils/filename-normalizer.js';
import { initDatabase } from '../db/index.js';
import type { UploadedFile, UploadResponse } from '../types.js';
import { ACCOUNTS } from '../types.js';
import type { AccountName } from '../types.js';
import { durableRelPathsAfterCsvIngest, ingestCsvFile, type IngestResult } from './ingest-csv-file.js';
import { REPO_ROOT } from '../repo-root.js';
import { uploadDurableRelPathsToS3 } from '../storage/s3-durable-sync.js';
import { recomputeAndPersistDataManifest } from '../data-manifest.js';
import { PARSERS } from '../parsers/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const STATEMENTS_DIR = path.join(__dirname, '../../statements');

/** Matches HTTP upload success bodies; avoids `readonly` arrays conflicting with {@link UploadResponse}. */
type AggregateUploadOkBody = UploadResponse;

export const STATEMENTS_UPLOAD_ROOT = STATEMENTS_DIR;
export interface DiskBackedUploadFileLike {
  path: string;
  originalname: string;
  size: number;
  filename: string;
}

function transcodeNonCsvUploads(files: DiskBackedUploadFileLike[], account: string): void {
  const parser = PARSERS[account];
  if (!parser?.transcodeUpload) return;

  const originalsDir = path.join(STATEMENTS_DIR, account, 'csv', '_originals');
  if (!fs.existsSync(originalsDir)) {
    fs.mkdirSync(originalsDir, { recursive: true });
  }

  for (const f of files) {
    const ext = path.extname(f.originalname).toLowerCase();
    if (ext === '.csv') continue;

    fs.copyFileSync(f.path, path.join(originalsDir, f.originalname));

    const raw = fs.readFileSync(f.path);
    const { csv, filenameHint } = parser.transcodeUpload(raw, f.originalname);

    const csvPath = path.join(path.dirname(f.path), filenameHint);
    fs.writeFileSync(csvPath, csv, 'utf-8');
    if (csvPath !== f.path) fs.unlinkSync(f.path);

    f.path = csvPath;
    f.filename = path.basename(csvPath);
    f.originalname = filenameHint;
  }
}

function processPdfBatch(
  files: readonly DiskBackedUploadFileLike[],
  account: string,
  overwrite: boolean,
): {
  readonly status: 200 | 409;
  readonly body: AggregateUploadOkBody | { readonly message: string; readonly duplicates: string[] };
} {
  const originalsDir = path.join(STATEMENTS_DIR, account, 'pdf', '_originals');
  if (!fs.existsSync(originalsDir)) {
    fs.mkdirSync(originalsDir, { recursive: true });
  }

  const duplicates = files
    .filter(f => fs.existsSync(path.join(originalsDir, f.originalname)))
    .map(f => f.originalname);

  if (duplicates.length > 0 && !overwrite) {
    for (const f of files) {
      try {
        fs.unlinkSync(f.path);
      } catch {
        /* ignore */
      }
    }
    return {
      status: 409,
      body: {
        message: `${String(duplicates.length)} file(s) already exist in originals`,
        duplicates,
      },
    };
  }

  const uploadedFiles: UploadedFile[] = [];
  for (const f of files) {
    fs.copyFileSync(f.path, path.join(originalsDir, f.originalname));
    const result = normalizeFileOnDisk(f.path, account);
    uploadedFiles.push({
      originalFilename: f.originalname,
      filename: result.normalized,
      size: f.size,
      path: result.newPath ?? f.path,
      renamed: result.renamed,
    });
  }

  return {
    status: 200,
    body: {
      message: `Successfully uploaded ${String(files.length)} file(s)`,
      files: uploadedFiles,
      account,
      type: 'pdf',
    },
  };
}

async function maybePublishPdfArtifacts(resultBody: AggregateUploadOkBody, account: string): Promise<void> {
  const originalsDir = path.join(STATEMENTS_DIR, account, 'pdf', '_originals');
  const paths = new Set<string>();
  for (const f of resultBody.files) {
    const base = f.originalFilename ?? f.filename;
    const originalRel = path
      .relative(REPO_ROOT, path.join(originalsDir, base))
      .split(path.sep)
      .join('/');
    const finalRel = `statements/${account}/pdf/${f.filename}`;
    paths.add(originalRel);
    paths.add(finalRel);
  }
  recomputeAndPersistDataManifest();
  try {
    await uploadDurableRelPathsToS3([...paths, 'data/manifest.json'], 'pdf-upload');
  } catch (err) {
    console.error('[Upload batch] S3 durable upload after PDF batch failed:', err);
  }
}

export type StatementDiskUploadResult = { readonly status: number; readonly body: unknown };

/** Same semantics as `POST /api/upload/:account/:type` after multer has materialised paths. */
export async function executeStatementDiskUpload(opts: {
  readonly account: string;
  readonly type: string;
  readonly files: readonly DiskBackedUploadFileLike[];
  readonly overwrite: boolean;
}): Promise<StatementDiskUploadResult> {
  const { account, type, overwrite } = opts;
  const files = opts.files.map(f => ({
    ...f,
  }));

  if (files.length === 0) {
    return { status: 400, body: { error: 'No files uploaded' } };
  }

  if (type === 'pdf') {
    const result = processPdfBatch(files, account, overwrite);
    if (result.status === 200 && 'files' in result.body) {
      await maybePublishPdfArtifacts(result.body, account);
    }
    return result;
  }

  if (type !== 'csv') {
    return { status: 400, body: { error: `Invalid file type: ${type}` } };
  }

  transcodeNonCsvUploads(files, account);

  const uploadedFiles: UploadedFile[] = [];
  const partitionedFiles: string[] = [];
  const validationFailures: { filename: string; errors: string[] }[] = [];
  const duplicateNames: string[] = [];
  const durableRelPathsTouched = new Set<string>();

  if (!ACCOUNTS.includes(account as AccountName)) {
    return { status: 400, body: { error: 'Invalid account for CSV upload', account } };
  }

  const acc = account as AccountName;

  for (const f of files) {
    const result: IngestResult = ingestCsvFile(acc, f.path, f.originalname, { overwrite });
    if (result.outcome === 'invalid') {
      validationFailures.push({ filename: f.originalname, errors: [...result.errors] });
      continue;
    }
    if (result.outcome === 'duplicate') {
      duplicateNames.push(result.originalName);
      continue;
    }
    for (const rel of durableRelPathsAfterCsvIngest(acc, result)) {
      durableRelPathsTouched.add(rel);
    }
    if (result.partition.deleted) {
      partitionedFiles.push(...result.partition.filesCreated);
    }
    uploadedFiles.push({
      originalFilename: f.originalname,
      filename: result.partition.deleted
        ? `Partitioned into ${String(result.partition.filesCreated.length)} monthly files`
        : result.normalizedFilename,
      size: f.size,
      path: result.finalPath,
      renamed: result.renamed,
    });
  }

  if (uploadedFiles.length > 0) {
    try {
      console.log('[Upload batch] Reinitializing database after CSV upload...');
      await initDatabase();
      console.log('[Upload batch] Database reinitialized successfully');
      try {
        await uploadDurableRelPathsToS3([...durableRelPathsTouched, 'data/manifest.json'], 'csv-upload');
      } catch (err) {
        console.error('[Upload batch] S3 durable upload after CSV ingest failed:', err);
      }
    } catch (err) {
      console.error('[Upload batch] Error reinitializing database:', err);
    }
  }

  if (validationFailures.length > 0) {
    const message =
      validationFailures.length === files.length
        ? 'All uploaded CSV files failed validation'
        : `${String(validationFailures.length)} of ${String(files.length)} files failed validation`;
    return {
      status: 400,
      body: {
        error: 'Invalid CSV format',
        message,
        details: validationFailures,
        validFilesProcessed: uploadedFiles.length,
      },
    };
  }

  if (duplicateNames.length > 0) {
    return {
      status: 409,
      body: {
        message: `${String(duplicateNames.length)} file(s) already exist in originals`,
        duplicates: duplicateNames,
      },
    };
  }

  const response: AggregateUploadOkBody & { readonly type?: string } = {
    message:
      partitionedFiles.length > 0
        ? `Successfully uploaded and partitioned into ${String(partitionedFiles.length)} monthly files. Database reinitialized.`
        : `Successfully uploaded ${String(files.length)} file(s). Database reinitialized.`,
    files: uploadedFiles,
    account,
    type,
  };
  return { status: 200, body: response };
}
