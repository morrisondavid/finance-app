/**
 * MCP entry for `POST /api/upload/:account/:type` using **base64 file payloads**.
 * Canonical disk workflow lives in `server/ingestion/statement-disk-upload-batch.ts`.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { evaluateUploadAcceptance } from '../../ingestion/upload-evaluate-acceptance.js';
import {
  executeStatementDiskUpload,
  type DiskBackedUploadFileLike,
} from '../../ingestion/statement-disk-upload-batch.js';
import type { JsonMutationResult } from './types.js';

/** Stricter caps than browser multipart UX for MCP transports (Hermes sends JSON payloads). */
export const MCP_STATEMENT_UPLOAD_MAX_FILES = 10;
export const MCP_STATEMENT_UPLOAD_MAX_BYTES_PER_FILE = 6 * 1024 * 1024;

function decodeBase64ToBuffer(raw: string, maxBytes: number): Buffer | JsonMutationResult {
  let buf: Buffer;
  try {
    buf = Buffer.from(raw, 'base64');
  } catch {
    return { status: 400, body: { error: 'Invalid base64 payload' } };
  }
  if (buf.byteLength === 0) {
    return { status: 400, body: { error: 'Empty file after base64 decode' } };
  }
  if (buf.byteLength > maxBytes) {
    return {
      status: 413,
      body: { error: 'File too large after decode', maxBytesPerFile: maxBytes },
    };
  }
  return buf;
}

export async function mutateStatementsUploadBase64(payload: unknown): Promise<JsonMutationResult> {
  const schema = validateStatementsBase64Envelope(payload);
  if ('error' in schema) return schema.error;
  const { account, type, overwrite, decoded } = schema;

  const stagingRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bank-stmt-upload-'));

  try {
    const diskFiles: DiskBackedUploadFileLike[] = [];

    for (let i = 0; i < decoded.length; i++) {
      const row = decoded[i];
      const tempPath = path.join(stagingRoot, `${String(i)}_${row.basename}`);
      fs.writeFileSync(tempPath, row.buffer);
      diskFiles.push({
        path: tempPath,
        originalname: row.basename,
        size: row.buffer.byteLength,
        filename: path.basename(tempPath),
      });
    }

    return await executeStatementDiskUpload({
      account,
      type,
      files: diskFiles,
      overwrite,
    });
  } finally {
    try {
      fs.rmSync(stagingRoot, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
}

type DecodedRow = { basename: string; buffer: Buffer };

function validateStatementsBase64Envelope(payload: unknown):
  | { error: JsonMutationResult }
  | {
      account: string;
      type: 'pdf' | 'csv';
      overwrite: boolean;
      decoded: readonly DecodedRow[];
    } {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    return { error: { status: 400, body: { error: 'Invalid body' } } };
  }
  const rec = payload as Record<string, unknown>;
  const account = rec.account;
  const typeRaw = rec.type;
  const filesRaw = rec.files;
  const overwrite = typeof rec.overwrite === 'boolean' ? rec.overwrite : false;

  if (typeof account !== 'string' || account.trim() === '') {
    return { error: { status: 400, body: { error: 'Missing account' } } };
  }
  if (typeRaw !== 'pdf' && typeRaw !== 'csv') {
    return { error: { status: 400, body: { error: 'type must be pdf or csv' } } };
  }

  const type = typeRaw;
  if (!Array.isArray(filesRaw)) {
    return { error: { status: 400, body: { error: 'files must be an array' } } };
  }
  if (filesRaw.length === 0) {
    return { error: { status: 400, body: { error: 'No files uploaded' } } };
  }
  if (filesRaw.length > MCP_STATEMENT_UPLOAD_MAX_FILES) {
    return {
      error: {
        status: 400,
        body: {
          error: 'Too many files for MCP batched upload',
          maxFiles: MCP_STATEMENT_UPLOAD_MAX_FILES,
        },
      },
    };
  }

  const decoded: DecodedRow[] = [];
  let totalDecoded = 0;

  const maxTotalDecoded = MCP_STATEMENT_UPLOAD_MAX_BYTES_PER_FILE * MCP_STATEMENT_UPLOAD_MAX_FILES;

  for (const entry of filesRaw) {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      return { error: { status: 400, body: { error: 'Each file entry must be an object' } } };
    }
    const e = entry as Record<string, unknown>;
    const filename = e.filename;
    const base64 = e.base64;
    if (typeof filename !== 'string' || filename.trim() === '') {
      return { error: { status: 400, body: { error: 'Each file requires filename' } } };
    }
    if (typeof base64 !== 'string' || base64.trim() === '') {
      return { error: { status: 400, body: { error: 'Each file requires base64' } } };
    }
    const basename = path.basename(filename);
    const acceptance = evaluateUploadAcceptance(basename, account.trim(), type);
    if (!acceptance.accepted) {
      return { error: { status: 400, body: { error: acceptance.reason } } };
    }

    const dec = decodeBase64ToBuffer(base64, MCP_STATEMENT_UPLOAD_MAX_BYTES_PER_FILE);
    if (!Buffer.isBuffer(dec)) {
      return { error: dec };
    }
    decoded.push({ basename, buffer: dec });
    totalDecoded += dec.byteLength;
    if (totalDecoded > maxTotalDecoded) {
      return {
        error: {
          status: 413,
          body: { error: 'Total decoded payload exceeds batched MCP limit', maxTotalBytes: maxTotalDecoded },
        },
      };
    }
  }

  return { account: account.trim(), type, overwrite, decoded };
}
