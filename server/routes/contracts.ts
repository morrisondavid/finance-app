/**
 * /api/contracts — Contracts tab + leave writer + template preview.
 *
 * Route map (fixed paths registered before `/:id` so Express doesn't
 * mis-match literals as id params):
 *   GET    /api/contracts                              list
 *   GET    /api/contracts/income-accrual               aggregate accrual + rollup
 *   GET    /api/contracts/:id                          single contract
 *   GET    /api/contracts/:id/income-accrual           per-contract accrual
 *   GET    /api/contracts/:id/leave                    per-contract leave log
 *   POST   /api/contracts/:id/leave                    book leave rows
 *   DELETE /api/contracts/:id/leave/:leaveId           remove a future-dated row
 *   POST   /api/contracts/:id/leave-preview            rendered template (no write)
 *
 * Everything delegates to the relevant domain modules:
 *   - `contracts/queries` for the contract lookups.
 *   - `leave/queries` for the read + write surface on `working-days/leave.csv`.
 *   - `contracts/income-accrual` for the pure accrual composition.
 *   - `templates/render` for the preview endpoint.
 *
 * Validation rules:
 *   - Leave dates must lie within the contract window (422 otherwise).
 *   - Past-dated rows are read-only; DELETE rejects with 422.
 *   - Unknown `:id` → 404.
 */

import express, { Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { z } from 'zod';
import type { Contract } from '../../shared/api-contracts.js';
import { findContractById } from '../domain/contracts/queries.js';

import { sendJsonRead } from '../http/read/send-json-read.js';
import { sendJsonMutation } from '../http/mutation/send-json-mutation.js';
import {
  mutateContractBookLeave,
  mutateContractDeleteLeave,
  mutateContractLeavePreview,
} from '../http/mutation/contracts-leave.js';
import {
  parseContractId,
  readContractsRoot,
  readContractsIncomeAccrualAggregate,
  readContractsExpectedReceiptsFromQuery,
  readContractById,
  readContractIncomeAccrual,
  readContractLeave,
} from '../http/read/contracts.js';

const router = express.Router();



function contractOr404(id: string, res: Response): Contract | null {
  const parsedId = parseContractId(id);
  if (parsedId === null) {
    res.status(404).json({ error: 'Contract not found' });
    return null;
  }
  const contract = findContractById(parsedId);
  if (contract === null) {
    res.status(404).json({ error: 'Contract not found' });
    return null;
  }
  return contract;
}

/** Narrow Zod-error branch for the mutating handlers. */
function respondZodError(err: z.ZodError, res: Response): void {
  res.status(400).json({ error: 'Invalid request', details: err.issues });
}

router.get('/', (_req: Request, res: Response) => {
  sendJsonRead(res, readContractsRoot());
});

router.get('/income-accrual', (_req: Request, res: Response) => {
  sendJsonRead(res, readContractsIncomeAccrualAggregate());
});

router.get('/expected-receipts', (req: Request, res: Response) => {
  sendJsonRead(res, readContractsExpectedReceiptsFromQuery(req.query as Record<string, unknown>));
});

router.get('/:id', (req: Request<{ id: string }>, res: Response) => {
  sendJsonRead(res, readContractById(req.params.id));
});

router.get('/:id/income-accrual', (req: Request<{ id: string }>, res: Response) => {
  sendJsonRead(res, readContractIncomeAccrual(req.params.id));
});

router.get('/:id/leave', (req: Request<{ id: string }>, res: Response) => {
  sendJsonRead(res, readContractLeave(req.params.id));
});

router.post('/:id/leave', (req: Request<{ id: string }>, res: Response) => {
  sendJsonMutation(res, mutateContractBookLeave(req.params.id, req.body));
});

router.delete('/:id/leave/:leaveId', (req: Request<{ id: string; leaveId: string }>, res: Response) => {
  sendJsonMutation(res, mutateContractDeleteLeave(req.params.id, req.params.leaveId));
});

router.post('/:id/leave-preview', (req: Request<{ id: string }>, res: Response) => {
  sendJsonMutation(res, mutateContractLeavePreview(req.params.id, req.body));
});

// ---------------------------------------------------------------------------
// GET /api/contracts/:id/document — signed contract PDF download.
//
// Convention-based: looks for `clients/contracts/<id>.pdf` relative to the
// repo root (`process.cwd()` at the time the server was booted). If the
// file isn't there, returns 404 with a message the UI can surface — no
// other storage layer yet, this is the simplest thing that works.
// ---------------------------------------------------------------------------

const CONTRACTS_DOCS_DIR = path.resolve(process.cwd(), 'clients', 'contracts');

router.get('/:id/document', (req: Request<{ id: string }>, res: Response) => {
  const contract = contractOr404(req.params.id, res);
  if (contract === null) return;
  const docPath = path.join(CONTRACTS_DOCS_DIR, `${contract.id}.pdf`);
  if (!fs.existsSync(docPath)) {
    res.status(404).json({
      error: 'ContractDocumentNotFound',
      detail: `No signed PDF found for ${contract.id}. Expected at clients/contracts/${contract.id}.pdf.`,
    });
    return;
  }
  res.download(docPath, `${contract.id}.pdf`);
});

// ---------------------------------------------------------------------------
// POST /api/contracts/:id/renew — placeholder.
//
// Accepts `{ start_date, end_date, day_rate? }` and responds 501 with a
// clear message. The full flow (file upload, new contracts.csv row,
// supersedes-link, renewal deadline re-seed) is not implemented here yet.
// This endpoint exists so the frontend can wire a
// "Renew" button today without the UI branching on whether the endpoint
// exists — the server owns the "not yet" explanation.
// ---------------------------------------------------------------------------

const RenewRequestSchema = z.object({
  start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  day_rate: z.number().nonnegative().optional(),
});

router.post('/:id/renew', (req: Request<{ id: string }>, res: Response) => {
  const contract = contractOr404(req.params.id, res);
  if (contract === null) return;
  const parsed = RenewRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    respondZodError(parsed.error, res);
    return;
  }
  res.status(501).json({
    error: 'RenewFlowNotImplemented',
    detail:
      'Renewals aren\'t wired through to contracts.csv yet. Your inputs were accepted and validated — the next shipment will persist them, supersede the old contract row, and re-seed the renewal deadline.',
    received: {
      contract_id: contract.id,
      start_date: parsed.data.start_date,
      end_date: parsed.data.end_date,
      day_rate: parsed.data.day_rate ?? null,
    },
  });
});

export default router;
