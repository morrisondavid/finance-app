import express, { Request, Response, NextFunction } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { normalizeFileOnDisk } from '../utils/filename-normalizer.js';
import { partitionByMonth } from '../utils/csv-partitioner.js';
import { validateAndCleanup } from '../utils/csv-validator.js';
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

// POST /api/upload/:account/:type - Upload a statement file
// Increased limit to 50 files at once
router.post('/:account/:type', upload.array('files', 50), async (req: Request, res: Response<UploadResponseContract | { error: string }>) => {
  const account = getParam(req.params, 'account');
  const type = getParam(req.params, 'type');
  const files = req.files as Express.Multer.File[] | undefined;
  
  if (!files || files.length === 0) {
    res.status(400).json({ error: 'No files uploaded' });
    return;
  }

  // Some banks (e.g. Santander) ship uploads in non-CSV formats. Parsers
  // that opt in via `acceptedUploadExtensions` + `transcodeUpload` get their
  // files converted here so every downstream step (validation, duplicate
  // detection, partitioner, filename normaliser) can treat them like any
  // other CSV upload.
  transcodeNonCsvUploads(files, account);
  
  // For CSV files, validate format BEFORE processing
  if (type === 'csv') {
    const validationErrors: { filename: string; errors: string[] }[] = [];
    const validFiles: Express.Multer.File[] = [];
    
    for (const f of files) {
      const validation = validateAndCleanup(f.path, account, true);
      if (!validation.valid) {
        validationErrors.push({
          filename: f.originalname,
          errors: validation.errors || ['Unknown validation error']
        });
      } else {
        validFiles.push(f);
      }
    }
    
    // If any files failed validation, return error
    if (validationErrors.length > 0) {
      const errorMessage = validationErrors.length === files.length
        ? 'All uploaded CSV files failed validation'
        : `${validationErrors.length} of ${files.length} files failed validation`;
      
      res.status(400).json({
        error: 'Invalid CSV format',
        message: errorMessage,
        details: validationErrors,
        validFilesProcessed: validFiles.length
      });
      
      // If some files are valid, continue processing them below
      if (validFiles.length === 0) {
        return;
      }
      
      // Replace files array with only valid files for processing
      (req as { files?: Express.Multer.File[] }).files = validFiles;
    }
  }
  
  // Re-get files array (may have been filtered)
  const processFiles = req.files as Express.Multer.File[] | undefined;
  if (!processFiles || processFiles.length === 0) {
    return; // All files were invalid and response already sent
  }
  
  const overwrite = req.query.overwrite === 'true';
  
  // Check for duplicate originals BEFORE processing
  if (account !== 'invoices') {
    const originalsDir = path.join(STATEMENTS_DIR, account, type, '_originals');
    if (!fs.existsSync(originalsDir)) {
      fs.mkdirSync(originalsDir, { recursive: true });
    }
    
    const duplicates = processFiles
      .filter(f => fs.existsSync(path.join(originalsDir, f.originalname)))
      .map(f => f.originalname);
    
    if (duplicates.length > 0 && !overwrite) {
      // Clean up uploaded files since we're not processing them
      for (const f of processFiles) {
        try { fs.unlinkSync(f.path); } catch { /* ignore */ }
      }
      res.status(409).json({
        message: `${duplicates.length} file(s) already exist in originals`,
        duplicates
      });
      return;
    }
    
    // Save originals with their original bank-provided filenames
    for (const f of processFiles) {
      const originalDest = path.join(originalsDir, f.originalname);
      fs.copyFileSync(f.path, originalDest);
    }
  }
  
  // Process each file
  const uploadedFiles: UploadedFileWithStats[] = [];
  let partitionedFiles: string[] = [];
  
  for (const f of processFiles) {
    let fileInfo: UploadedFileWithStats;
    
    if (account !== 'invoices') {
      // Normalize filename
      const result = normalizeFileOnDisk(f.path, account);
      const finalPath = result.newPath || f.path;
      
      fileInfo = {
        originalFilename: f.originalname,
        filename: result.normalized,
        size: f.size,
        path: finalPath,
        renamed: result.renamed
      };
      
      // If it's a CSV file, check if it needs partitioning
      if (type === 'csv') {
        try {
          const partitionResult = partitionByMonth(finalPath, account);
          if (partitionResult.deleted) {
            partitionedFiles = partitionedFiles.concat(partitionResult.filesCreated);
            fileInfo.filename = `Partitioned into ${partitionResult.filesCreated.length} monthly files`;
          }
        } catch (err) {
          console.error(`Error partitioning ${f.originalname}:`, err);
        }
      }
    } else {
      fileInfo = {
        filename: f.filename,
        size: f.size,
        path: f.path
      };
    }
    
    uploadedFiles.push(fileInfo);
  }
  
  // For CSV uploads, reinitialize the database to pick up all changes
  if (type === 'csv') {
    try {
      console.log('[Upload] Reinitializing database after CSV upload...');
      await initDatabase();
      console.log('[Upload] Database reinitialized successfully');
    } catch (err) {
      console.error('[Upload] Error reinitializing database:', err);
    }
  }
  
  const response: UploadResponseWithStats = {
    message: `Successfully uploaded ${files.length} file(s)`,
    files: uploadedFiles,
    account,
    type
  };
  
  // Add info about partitioned files
  if (partitionedFiles.length > 0) {
    response.message = `Successfully uploaded and partitioned into ${partitionedFiles.length} monthly files. Database reinitialized.`;
  } else if (type === 'csv') {
    response.message = `Successfully uploaded ${files.length} file(s). Database reinitialized.`;
  }
  
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
