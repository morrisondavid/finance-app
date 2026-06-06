/**
 * Invoices HTTP surface.
 *
 * Endpoints:
 *
 *   GET  /api/invoices                  — Phase 1 list.
 *   GET  /api/invoices/supplier-month-gaps
 *                                       — complete past months with no
 *                                         covering supplier invoice
 *                                         (monthly cadence only).
 *   GET  /api/invoices/draft?contract_id=...
 *                                       — Builds a supplier draft via
 *                                         `composeSupplierInvoiceDraftForContract`
 *                                         (canonical `buildDraftInvoice` internally).
 *                                         No persistence.
 *   POST /api/invoices/monthly/preview — resolve client/contract, compose draft +
 *                                        fingerprint + occupancy / gap-list / workload flags.
 *   POST /api/invoices/monthly/commit — commit when preview fingerprint matches
 *                                        (optional issued notice delivery).
 *   POST /api/invoices/generate         — Phase 2 persists the reviewed
 *                                         draft, renders the PDF, flips
 *                                         the row to `issued`.
 *   POST /api/invoices/reconcile        — Phase 4 runs the pure
 *                                         `planReconciliation` matcher and
 *                                         (when `dryRun=false`) persists
 *                                         proposed payments via
 *                                         `recordInvoicePayments`.
 *   POST /api/invoices/:id/persist-pdf  — Render + write PDF for an existing
 *                                         supplier-issued row (no duplicate create).
 *   GET  /api/invoices/:id/pdf          — Streams the archived PDF only when
 *                                         the file exists on disk.
 *
 * The generate flow is a small workflow: create → render → update. If the
 * render step fails, we flip the row back to `draft` so we never leave
 * a row claiming `status = 'issued'` without a PDF on disk.
 */

import { Router, type Request, type Response } from 'express';
import multer from 'multer';
import { persistIngestedSelfBillFromBuffer } from '../domain/invoices/index.js';
import { todayIsoLocal } from '../../shared/iso-date.js';
import { sendJsonRead } from '../http/read/send-json-read.js';
import { sendJsonMutation } from '../http/mutation/send-json-mutation.js';
import {
  mutateInvoiceGenerate,
  mutateInvoiceReconcile,
} from '../http/mutation/invoices.js';
import {
  mutateMonthlyInvoiceCommit,
  mutateMonthlyInvoicePreview,
} from '../http/mutation/monthly-invoice-workflow.js';
import { mutateInvoicePdfDownload } from '../http/mutation/invoice-pdf-download.js';
import { mutateInvoicePersistPdf } from '../http/mutation/invoice-persist-pdf.js';
import {
  readInvoiceList,
  readInvoiceDraftFromQuery,
  readSupplierMonthGaps,
} from '../http/read/invoices.js';

const router = Router();

router.get('/', (_req: Request, res: Response) => {
  sendJsonRead(res, readInvoiceList());
});

router.get('/draft', (req: Request, res: Response) => {
  sendJsonRead(res, readInvoiceDraftFromQuery(req.query as Record<string, unknown>));
});

router.get('/supplier-month-gaps', (_req: Request, res: Response) => {
  sendJsonRead(res, readSupplierMonthGaps());
});

router.post('/monthly/preview', (req: Request, res: Response) => {
  sendJsonRead(res, mutateMonthlyInvoicePreview(req.body ?? {}));
});

router.post('/monthly/commit', async (req: Request, res: Response) => {
  const result = await mutateMonthlyInvoiceCommit(req.body ?? {});
  sendJsonMutation(res, result);
});

// ─── POST /generate ─────────────────────────────────────────────────────────

router.post('/generate', async (req: Request, res: Response) => {
  const result = await mutateInvoiceGenerate(req.body);
  sendJsonMutation(res, result);
});

// ─── POST /ingest-self-bill ─────────────────────────────────────────────────

// Self-bill PDFs are tiny (1 page). A 5 MB cap is generous and keeps a
// malformed upload from pinning the process.
const INGEST_MAX_BYTES = 5 * 1024 * 1024;

const ingestUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: INGEST_MAX_BYTES, files: 1 },
});

router.post(
  '/ingest-self-bill',
  ingestUpload.any(),
  async (req: Request, res: Response) => {
    const files = (req as Request & { files?: Express.Multer.File[] }).files ?? [];
    const file = files.find(f => f.fieldname === 'pdf');
    if (file === undefined) {
      res.status(400).json({ error: 'No PDF uploaded (field name: pdf)' });
      return;
    }
    if (file.mimetype !== 'application/pdf') {
      res.status(400).json({ error: 'Uploaded file is not a PDF' });
      return;
    }

    const persisted = await persistIngestedSelfBillFromBuffer(
      file.buffer,
      todayIsoLocal(),
    );
    if (!persisted.ok) {
      if (persisted.code === 'duplicate-supplier-invoice') {
        res.status(409).json({ error: persisted.code, detail: persisted.detail });
        return;
      }
      if (persisted.code === 'duplicate-id') {
        const dup = persisted.detail as { invoiceId?: string };
        res.status(409).json({
          error: 'duplicate-id',
          invoiceId: dup.invoiceId,
          detail: persisted.detail,
        });
        return;
      }
      if (persisted.code === 'invalid') {
        res.status(400).json({
          error: 'Invalid ingested invoice',
          details: persisted.detail,
        });
        return;
      }
      if (persisted.code === 'pdf-text-failed') {
        res.status(400).json({
          error: 'Failed to extract text from PDF',
          detail: persisted.detail,
        });
        return;
      }
      if (persisted.code === 'write-pdf-failed' || persisted.code === 'patch-failed') {
        res.status(500).json({ error: persisted.code, detail: persisted.detail });
        return;
      }
      res.status(422).json({ error: persisted.code, detail: persisted.detail });
      return;
    }

    res.json({
      invoice: persisted.invoice,
      parsed: persisted.parsed,
      contract: { id: persisted.contractId },
      client: { id: persisted.clientId },
    });
  },
);

// ─── POST /reconcile ────────────────────────────────────────────────────────

router.post('/reconcile', (req: Request, res: Response) => {
  sendJsonMutation(res, mutateInvoiceReconcile(req.body));
});

// ─── POST /:id/persist-pdf ───────────────────────────────────────────────────

router.post('/:id/persist-pdf', async (req: Request<{ id: string }>, res: Response) => {
  sendJsonMutation(res, await mutateInvoicePersistPdf(req.params.id));
});

// ─── GET /:id/pdf ───────────────────────────────────────────────────────────

router.get('/:id/pdf', async (req: Request<{ id: string }>, res: Response) => {
  const outcome = await mutateInvoicePdfDownload(req.params.id);
  if (outcome.kind === 'json') {
    res.status(outcome.status).json(outcome.body);
    return;
  }
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${outcome.filename}"`);
  res.send(outcome.buffer);
});

export default router;
