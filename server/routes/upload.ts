import express, { Request, Response, NextFunction } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { normalizeFileOnDisk } from '../utils/filename-normalizer.js';
import { initDatabase } from '../db/index.js';
import type {
  InvoiceUploadIngestResult,
  UploadedFile,
  UploadResponse,
} from '../types.js';
import { persistIngestedSelfBillFromBuffer } from '../domain/invoices/index.js';
import { todayIsoLocal } from '../../shared/iso-date.js';
import { ACCOUNTS, AccountName } from '../types.js';
import type { UploadResponse as UploadResponseContract } from '../../shared/api-contracts.js';
import { PARSERS } from '../parsers/index.js';
import { ingestCsvFile, type IngestResult } from '../ingestion/ingest-csv-file.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();

const STATEMENTS_DIR = path.join(__dirname, '../../statements');
const INVOICES_DIR = path.join(__dirname, '../../invoices');

/**
 * Safely get a param value as string
 */
function getParam(params: Record<string, string | string[] | undefined>, key: string): string {
  const value = params[key];
  if (Array.isArray(value)) {
    return value[0] || '';
  }
  return value || '';
}

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, _file, cb) => {
    const account = getParam(req.params, 'account');
    const type = getParam(req.params, 'type');
    
    let destDir: string;
    
    if (account === 'invoices') {
      destDir = INVOICES_DIR;
    } else if (ACCOUNTS.includes(account as AccountName) && ['pdf', 'csv'].includes(type)) {
      destDir = path.join(STATEMENTS_DIR, account, type);
    } else {
      return cb(new Error('Invalid account or file type'), '');
    }
    
    // Ensure directory exists
    if (!fs.existsSync(destDir)) {
      fs.mkdirSync(destDir, { recursive: true });
    }
    
    cb(null, destDir);
  },
  filename: (_req, file, cb) => {
    // Keep original filename
    cb(null, file.originalname);
  }
});

/**
 * Result of evaluating whether an uploaded file should be accepted by multer.
 * Exported for unit-testing the pipeline without a full HTTP round-trip.
 */
export type UploadAcceptance =
  | { accepted: true }
  | { accepted: false; reason: string };

/**
 * PURE - Decide whether a given filename is allowed for a given `account` and
 * `type`. The CSV lane optionally widens to a parser's declared
 * `acceptedUploadExtensions` (e.g. `.xls` for banks that ship HTML tables);
 * no account-name string literals live here.
 */
export function evaluateUploadAcceptance(
  filename: string,
  account: string,
  type: string,
): UploadAcceptance {
  const ext = path.extname(filename).toLowerCase();

  if (account === 'invoices') {
    if (ext === '.pdf') return { accepted: true };
    return { accepted: false, reason: 'Invoices must be PDF files' };
  }

  if (type === 'pdf' && ext === '.pdf') return { accepted: true };
  if (type === 'csv' && ext === '.csv') return { accepted: true };

  if (type === 'csv' && ACCOUNTS.includes(account as AccountName)) {
    const extras = PARSERS[account]?.acceptedUploadExtensions ?? [];
    if (extras.includes(ext)) return { accepted: true };
  }

  return {
    accepted: false,
    reason: `Invalid file type. Expected ${type.toUpperCase()} file.`,
  };
}

const upload = multer({ 
  storage,
  fileFilter: (req, file, cb) => {
    const account = getParam(req.params, 'account');
    const type = getParam(req.params, 'type');
    const decision = evaluateUploadAcceptance(file.originalname, account, type);
    if (decision.accepted) return cb(null, true);
    cb(new Error(decision.reason));
  }
});

/**
 * Transcode any non-CSV uploads into CSV files in place, using the parser's
 * declared capability. Preserves the raw bytes in `_originals` so the
 * original download is recoverable, then mutates the `files` array entries
 * so the rest of the upload pipeline (validation, duplicate check,
 * partitioner, normaliser, DB reload) can treat everything as CSV.
 *
 * The parser owns all bank-specific knowledge: byte encoding, how to derive
 * a sensible on-disk filename for the converted file, etc. This route simply
 * dispatches through the capability.
 */
function transcodeNonCsvUploads(
  files: Express.Multer.File[],
  account: string,
): void {
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

interface UploadedFileWithStats extends UploadedFile {
  transactionsAdded?: number;
  duplicatesSkipped?: number;
}

interface UploadResponseWithStats extends UploadResponse {
  totalTransactionsAdded?: number;
  totalDuplicatesSkipped?: number;
}

/**
 * PDF lane: same `_originals/` save + `normalizeFileOnDisk` rename the
 * route always did. Kept inline because the CSV-specific pipeline (validate,
 * partition, DB rebuild) doesn't apply and the CSV ingest function was
 * deliberately scoped to CSV only.
 */
function processPdfBatch(
  files: Express.Multer.File[],
  account: string,
  overwrite: boolean,
): { status: 200 | 409; body: UploadResponseWithStats | { message: string; duplicates: string[] } } {
  const originalsDir = path.join(STATEMENTS_DIR, account, 'pdf', '_originals');
  if (!fs.existsSync(originalsDir)) {
    fs.mkdirSync(originalsDir, { recursive: true });
  }

  const duplicates = files
    .filter(f => fs.existsSync(path.join(originalsDir, f.originalname)))
    .map(f => f.originalname);

  if (duplicates.length > 0 && !overwrite) {
    for (const f of files) {
      try { fs.unlinkSync(f.path); } catch { /* ignore */ }
    }
    return {
      status: 409,
      body: {
        message: `${duplicates.length} file(s) already exist in originals`,
        duplicates,
      },
    };
  }

  const uploadedFiles: UploadedFileWithStats[] = [];
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
      message: `Successfully uploaded ${files.length} file(s)`,
      files: uploadedFiles,
      account,
      type: 'pdf',
    },
  };
}

// POST /api/upload/:account/:type — Upload statement file(s).
// CSV path goes through the **shared** `ingestCsvFile` saga (same code that
// `runFeedSync` calls). PDF path stays inline (originals + normalise only).
// Increased limit to 50 files at once.
router.post('/:account/:type', upload.array('files', 50), async (req: Request, res: Response<UploadResponseContract | { error: string }>) => {
  const account = getParam(req.params, 'account');
  const type = getParam(req.params, 'type');
  const files = req.files as Express.Multer.File[] | undefined;

  if (!files || files.length === 0) {
    res.status(400).json({ error: 'No files uploaded' });
    return;
  }

  const overwrite = req.query.overwrite === 'true';

  // PDF lane — unchanged behaviour.
  if (type === 'pdf') {
    const result = processPdfBatch(files, account, overwrite);
    res.status(result.status).json(result.body);
    return;
  }

  if (type !== 'csv') {
    res.status(400).json({ error: `Invalid file type: ${type}` });
    return;
  }

  // Banks like Santander ship uploads in non-CSV formats; parsers opt in
  // via `acceptedUploadExtensions` + `transcodeUpload`. After this call,
  // every entry in `files` is a CSV from the rest of the pipeline's POV.
  transcodeNonCsvUploads(files, account);

  // Single ingest pass: same function `runFeedSync` calls. Each file's
  // result is independent — invalid files don't block valid ones, and the
  // user-facing 400/409 contract is preserved by aggregating the results
  // into the same response shapes the previous handler returned.
  const uploadedFiles: UploadedFileWithStats[] = [];
  const partitionedFiles: string[] = [];
  const validationFailures: { filename: string; errors: string[] }[] = [];
  const duplicateNames: string[] = [];

  for (const f of files) {
    const result: IngestResult = ingestCsvFile(
      account as AccountName,
      f.path,
      f.originalname,
      { overwrite },
    );
    if (result.outcome === 'invalid') {
      validationFailures.push({ filename: f.originalname, errors: [...result.errors] });
      continue;
    }
    if (result.outcome === 'duplicate') {
      duplicateNames.push(result.originalName);
      continue;
    }
    if (result.partition.deleted) {
      partitionedFiles.push(...result.partition.filesCreated);
    }
    uploadedFiles.push({
      originalFilename: f.originalname,
      filename: result.partition.deleted
        ? `Partitioned into ${result.partition.filesCreated.length} monthly files`
        : result.normalizedFilename,
      size: f.size,
      path: result.finalPath,
      renamed: result.renamed,
    });
  }

  // Rebuild DB once if anything actually landed on disk. This matches the
  // previous "always run initDatabase after a CSV upload, even partial".
  if (uploadedFiles.length > 0) {
    try {
      console.log('[Upload] Reinitializing database after CSV upload...');
      await initDatabase();
      console.log('[Upload] Database reinitialized successfully');
    } catch (err) {
      console.error('[Upload] Error reinitializing database:', err);
    }
  }

  // Response priority preserved: validation > duplicate > ok.
  if (validationFailures.length > 0) {
    const message = validationFailures.length === files.length
      ? 'All uploaded CSV files failed validation'
      : `${validationFailures.length} of ${files.length} files failed validation`;
    res.status(400).json({
      error: 'Invalid CSV format',
      message,
      details: validationFailures,
      validFilesProcessed: uploadedFiles.length,
    });
    return;
  }

  if (duplicateNames.length > 0) {
    res.status(409).json({
      message: `${duplicateNames.length} file(s) already exist in originals`,
      duplicates: duplicateNames,
    });
    return;
  }

  const response: UploadResponseWithStats = {
    message: partitionedFiles.length > 0
      ? `Successfully uploaded and partitioned into ${partitionedFiles.length} monthly files. Database reinitialized.`
      : `Successfully uploaded ${files.length} file(s). Database reinitialized.`,
    files: uploadedFiles,
    account,
    type,
  };
  res.json(response);
});

// POST /api/upload/invoices — saves each PDF, then runs the same self-bill
// ingestion pipeline as `POST /api/invoices/ingest-self-bill`. Recognised
// La Fosse self-bills become ledger rows + `invoices/ingested/` copies; all
// other PDFs stay in `invoices/` as archives (same as before ingestion existed).
router.post(
  '/invoices',
  upload.array('files', 50),
  async (req: Request, res: Response<UploadResponseContract | { error: string }>) => {
    req.params.account = 'invoices';
    req.params.type = 'pdf';

    const files = req.files as Express.Multer.File[] | undefined;

    if (!files || files.length === 0) {
      res.status(400).json({ error: 'No files uploaded' });
      return;
    }

    const today = todayIsoLocal();
    const ingestOutcomes: InvoiceUploadIngestResult[] = [];
    let ingestedCount = 0;

    for (const f of files) {
      let buffer: Buffer;
      try {
        buffer = fs.readFileSync(f.path);
      } catch {
        ingestOutcomes.push({
          filename: f.originalname,
          outcome: 'failed',
          code: 'read-failed',
          message: 'Could not read uploaded file',
        });
        continue;
      }

      const persisted = await persistIngestedSelfBillFromBuffer(buffer, today);
      if (persisted.ok) {
        ingestedCount += 1;
        ingestOutcomes.push({
          filename: f.originalname,
          outcome: 'ingested',
          invoiceId: persisted.invoice.id,
        });
        try {
          fs.unlinkSync(f.path);
        } catch {
          // Best-effort — canonical bytes live under invoices/ingested/.
        }
        continue;
      }

      if (
        persisted.code === 'no-parser-match' ||
        persisted.code === 'parse-failed' ||
        persisted.code === 'unexpected-format' ||
        persisted.code === 'no-contract-match'
      ) {
        ingestOutcomes.push({
          filename: f.originalname,
          outcome: 'archived-only',
          code: persisted.code,
          message: 'File kept in invoices/ — not a recognised self-bill layout',
        });
        continue;
      }

      ingestOutcomes.push({
        filename: f.originalname,
        outcome: 'failed',
        code: persisted.code,
        message:
          typeof persisted.detail === 'string'
            ? persisted.detail
            : persisted.code,
      });
    }

    const uploadedFiles: UploadedFile[] = files.map(file => ({
      filename: file.filename,
      size: file.size,
      path: file.path,
    }));

    const parts: string[] = [
      `Received ${files.length} invoice PDF(s)`,
      ingestedCount > 0 ? `${ingestedCount} ingested as self-bill` : null,
      ingestedCount < files.length ? 'others archived or failed (see details)' : null,
    ].filter((p): p is string => p !== null);

    const response: UploadResponse = {
      message: parts.join(' · '),
      files: uploadedFiles,
      invoiceIngestResults: ingestOutcomes,
    };

    res.json(response);
  },
);

// Error handling middleware for multer
router.use((err: Error, _req: Request, res: Response, next: NextFunction) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_UNEXPECTED_FILE') {
      res.status(400).json({ error: 'Too many files. Maximum 50 files per upload.' });
      return;
    }
    res.status(400).json({ error: err.message });
    return;
  }
  if (err) {
    res.status(400).json({ error: err.message });
    return;
  }
  next();
});

export default router;
