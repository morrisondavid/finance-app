/**
 * Invoices HTTP surface.
 *
 * Endpoints:
 *
 *   GET  /api/invoices                  — Phase 1 list.
 *   GET  /api/invoices/draft?contract_id=...
 *                                       — Phase 2 builds a draft via the
 *                                         canonical `buildDraftInvoice`
 *                                         primitive. No persistence.
 *   POST /api/invoices/generate         — Phase 2 persists the reviewed
 *                                         draft, renders the PDF, flips
 *                                         the row to `issued`.
 *   GET  /api/invoices/:id/pdf          — Streams the stored PDF when
 *                                         `pdf_path` resolves on disk; otherwise
 *                                         rebuilds from the invoice row + client +
 *                                         company (so historical seed rows still
 *                                         open a PDF).
 *
 * The generate flow is a small saga: create → render → update. If the
 * render step fails, we flip the row back to `draft` so we never leave
 * a row claiming `status = 'issued'` with `pdf_path = null`.
 */

import fs from 'fs';
import path from 'path';
import { Router, type Request, type Response } from 'express';
import multer from 'multer';
import { z } from 'zod';
import {
  allInvoices,
  buildDraftInvoice,
  createInvoice,
  findInvoiceById,
  InvoiceSchema,
  persistIngestedSelfBillFromBuffer,
  renderInvoicePdf,
  updateInvoice,
  writeInvoicePdf,
  type Invoice,
} from '../domain/invoices/index.js';
import { findContractById } from '../domain/contracts/index.js';
import { findClientById } from '../domain/clients/index.js';
import { companyById } from '../domain/company/index.js';
import { leaveForContract } from '../domain/leave/index.js';
import { todayIsoLocal } from '../../shared/iso-date.js';
import { DEFAULT_INVOICES_DIR } from '../domain/invoices/registry.js';

const router = Router();

router.get('/', (_req: Request, res: Response) => {
  res.json({ invoices: allInvoices() });
});

// ─── GET /draft ─────────────────────────────────────────────────────────────

const DraftQuerySchema = z.object({
  contract_id: z.string().min(1),
});

router.get('/draft', (req: Request, res: Response) => {
  const parsed = DraftQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res
      .status(400)
      .json({ error: 'Invalid request', details: parsed.error.issues });
    return;
  }

  const contract = findContractById(parsed.data.contract_id);
  if (contract === null) {
    res.status(404).json({ error: 'Contract not found' });
    return;
  }

  if (contract.invoice_mechanism !== 'supplier-issued') {
    res.status(400).json({
      error: 'self-bill-contract',
      message:
        'This contract uses self-bill; supplier drafts are not built here. Use ingest for agency PDFs.',
    });
    return;
  }

  const client = findClientById(contract.client_id);
  if (client === null) {
    res.status(404).json({ error: 'Client not found for contract' });
    return;
  }

  const company = companyById(contract.issuing_entity_id);
  if (company === null) {
    res
      .status(404)
      .json({ error: 'Issuing entity not found for contract' });
    return;
  }

  const draft = buildDraftInvoice({
    contract,
    client,
    company,
    leaveRows: leaveForContract(contract.id),
    existingInvoices: allInvoices(),
    today: todayIsoLocal(),
  });

  res.json({ invoice: draft });
});

// ─── POST /generate ─────────────────────────────────────────────────────────

const GenerateBodySchema = z.object({
  invoice: InvoiceSchema,
});

router.post('/generate', async (req: Request, res: Response) => {
  const parsed = GenerateBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res
      .status(400)
      .json({ error: 'Invalid request', details: parsed.error.issues });
    return;
  }

  const draft: Invoice = {
    ...parsed.data.invoice,
    status: 'draft',
    pdf_path: null,
  };

  const contractForGenerate = findContractById(draft.contract_id);
  if (contractForGenerate === null) {
    res.status(400).json({ error: 'Draft references unknown contract' });
    return;
  }
  if (contractForGenerate.invoice_mechanism !== 'supplier-issued') {
    res.status(400).json({
      error: 'self-bill-contract',
      message:
        'This contract uses self-bill; supplier invoice generation does not apply. Use ingest instead.',
    });
    return;
  }

  const createResult = createInvoice({ invoice: draft });
  if (!createResult.ok) {
    if (createResult.code === 'duplicate-id') {
      res
        .status(409)
        .json({ error: 'duplicate-id', invoiceId: createResult.invoiceId });
      return;
    }
    res
      .status(400)
      .json({ error: 'Invalid request', details: createResult.issues });
    return;
  }

  const contract = findContractById(createResult.invoice.contract_id);
  const client = findClientById(createResult.invoice.client_id);
  const company = companyById(createResult.invoice.issuing_entity_id);
  if (contract === null || client === null || company === null) {
    // The draft referenced dangling ids — rewind the create so we don't
    // keep a header-only row in the ledger.
    rewindToDraftOrSkip(createResult.invoice.id);
    res.status(400).json({ error: 'Draft references unknown entities' });
    return;
  }

  try {
    const writeResult = await writeInvoicePdf({
      invoice: createResult.invoice,
      company,
      client,
    });

    const patchResult = updateInvoice({
      invoiceId: createResult.invoice.id,
      patch: { status: 'issued', pdf_path: writeResult.relativePath },
    });

    if (!patchResult.ok) {
      res
        .status(500)
        .json({ error: 'Failed to flip invoice to issued' });
      return;
    }

    res.json({ invoice: patchResult.invoice });
  } catch (err) {
    // Best-effort rewind: leave the row as `draft` with `pdf_path: null`
    // so the UI surfaces it as "needs regeneration" rather than a
    // success. Don't delete — the user's review is still worth keeping.
    rewindToDraftOrSkip(createResult.invoice.id);
    res.status(500).json({
      error: 'PDF render failed',
      detail: err instanceof Error ? err.message : String(err),
    });
  }
});

function rewindToDraftOrSkip(invoiceId: string): void {
  const existing = findInvoiceById(invoiceId);
  if (existing === null) return;
  if (existing.status === 'draft' && existing.pdf_path === null) return;
  updateInvoice({
    invoiceId,
    patch: { status: 'draft', pdf_path: null },
  });
}

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

// ─── GET /:id/pdf ───────────────────────────────────────────────────────────

router.get('/:id/pdf', async (req: Request<{ id: string }>, res: Response) => {
  const invoice = findInvoiceById(req.params.id);
  if (invoice === null) {
    res.status(404).json({ error: 'Invoice not found' });
    return;
  }

  const projectRoot = path.dirname(DEFAULT_INVOICES_DIR);

  if (invoice.pdf_path !== null) {
    const absolutePath = path.resolve(projectRoot, invoice.pdf_path);
    if (fs.existsSync(absolutePath)) {
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader(
        'Content-Disposition',
        `inline; filename="${invoice.id}.pdf"`,
      );
      fs.createReadStream(absolutePath).pipe(res);
      return;
    }
  }

  const contract = findContractById(invoice.contract_id);
  const client = findClientById(invoice.client_id);
  const company = companyById(invoice.issuing_entity_id);
  if (contract === null || client === null || company === null) {
    res.status(404).json({
      error:
        invoice.pdf_path === null
          ? 'Invoice has no PDF and linked entities are missing'
          : 'PDF file missing on disk and invoice cannot be re-rendered',
    });
    return;
  }

  try {
    const buffer = await renderInvoicePdf(invoice, company, client);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `inline; filename="${invoice.id}.pdf"`,
    );
    res.send(buffer);
  } catch (err) {
    res.status(500).json({
      error: 'PDF render failed',
      detail: err instanceof Error ? err.message : String(err),
    });
  }
});

export default router;
