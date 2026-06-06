import express, { Request, Response, NextFunction } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import {
  evaluateUploadAcceptance,
  type UploadAcceptance,
} from '../ingestion/upload-evaluate-acceptance.js';
import type { InvoiceUploadIngestResult, UploadedFile, UploadResponse } from '../types.js';
import { persistIngestedSelfBillFromBuffer } from '../domain/invoices/index.js';
import { todayIsoLocal } from '../../shared/iso-date.js';
import { ACCOUNTS, AccountName } from '../types.js';
import { executeStatementDiskUpload } from '../ingestion/statement-disk-upload-batch.js';
import {
  UPLOAD_MAX_FILES_PER_REQUEST,
  UPLOAD_MAX_PDF_BYTES,
} from '../ingestion/upload-limits.js';
import {
  publishInvoiceUploadArtifacts,
  type InvoiceUploadDiskTouch,
} from '../ingestion/invoice-upload-durable-publish.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();

const STATEMENTS_DIR = path.join(__dirname, '../../statements');
const INVOICES_DIR = path.join(__dirname, '../../invoices');

export { evaluateUploadAcceptance, type UploadAcceptance };

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

const upload = multer({
  storage,
  limits: { fileSize: UPLOAD_MAX_PDF_BYTES },
  fileFilter: (req, file, cb) => {
    const account = getParam(req.params, 'account');
    const type = getParam(req.params, 'type');
    const decision = evaluateUploadAcceptance(file.originalname, account, type);
    if (decision.accepted) return cb(null, true);
    cb(new Error(decision.reason));
  }
});


// POST /api/upload/:account/:type — multipart uploads; MCP uses `post_upload_statements_base64` with the same disk workflow.
router.post('/:account/:type', upload.array('files', UPLOAD_MAX_FILES_PER_REQUEST), async (req: Request, res: Response) => {
  const account = getParam(req.params, 'account');
  const type = getParam(req.params, 'type');
  const files = req.files as Express.Multer.File[] | undefined;

  if (!files || files.length === 0) {
    res.status(400).json({ error: 'No files uploaded' });
    return;
  }

  const overwrite = req.query.overwrite === 'true';

  const outcome = await executeStatementDiskUpload({
    account,
    type,
    overwrite,
    files: files.map(f => ({
      path: f.path,
      originalname: f.originalname,
      size: f.size,
      filename: f.filename,
    })),
  });
  res.status(outcome.status).json(outcome.body);
});


// POST /api/upload/invoices — saves each PDF, then runs the same self-bill
// ingestion pipeline as `POST /api/invoices/ingest-self-bill`. Recognised
// La Fosse self-bills become ledger rows + `invoices/ingested/` copies; all
// other PDFs stay in `invoices/` as archives (same as before ingestion existed).
router.post(
  '/invoices',
  upload.array('files', UPLOAD_MAX_FILES_PER_REQUEST),
  async (req: Request, res: Response) => {
    req.params.account = 'invoices';
    req.params.type = 'pdf';

    const files = req.files as Express.Multer.File[] | undefined;

    if (!files || files.length === 0) {
      res.status(400).json({ error: 'No files uploaded' });
      return;
    }

    const today = todayIsoLocal();
    const ingestOutcomes: InvoiceUploadIngestResult[] = [];
    const durableTouches: InvoiceUploadDiskTouch[] = [];
    let ingestedCount = 0;

    for (const f of files) {
      let buffer: Buffer;
      try {
        buffer = fs.readFileSync(f.path);
      } catch {
        const failed: InvoiceUploadIngestResult = {
          filename: f.originalname,
          outcome: 'failed',
          code: 'read-failed',
          message: 'Could not read uploaded file',
        };
        ingestOutcomes.push(failed);
        durableTouches.push({ outcome: failed });
        continue;
      }

      const persisted = await persistIngestedSelfBillFromBuffer(buffer, today);
      if (persisted.ok) {
        ingestedCount += 1;
        const ingested: InvoiceUploadIngestResult = {
          filename: f.originalname,
          outcome: 'ingested',
          invoiceId: persisted.invoice.id,
        };
        ingestOutcomes.push(ingested);
        durableTouches.push({ outcome: ingested });
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
        const archived: InvoiceUploadIngestResult = {
          filename: f.originalname,
          outcome: 'archived-only',
          code: persisted.code,
          message: 'File kept in invoices/ — not a recognised self-bill layout',
        };
        ingestOutcomes.push(archived);
        durableTouches.push({ outcome: archived, archivedAbsolutePath: f.path });
        continue;
      }

      const failed: InvoiceUploadIngestResult = {
        filename: f.originalname,
        outcome: 'failed',
        code: persisted.code,
        message:
          typeof persisted.detail === 'string'
            ? persisted.detail
            : persisted.code,
      };
      ingestOutcomes.push(failed);
      durableTouches.push({ outcome: failed });
    }

    await publishInvoiceUploadArtifacts(durableTouches);

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
    if (err.code === 'LIMIT_FILE_SIZE') {
      res.status(413).json({
        error: 'File too large',
        maxBytesPerFile: UPLOAD_MAX_PDF_BYTES,
      });
      return;
    }
    if (err.code === 'LIMIT_UNEXPECTED_FILE') {
      res.status(400).json({
        error: `Too many files. Maximum ${String(UPLOAD_MAX_FILES_PER_REQUEST)} files per upload.`,
      });
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
