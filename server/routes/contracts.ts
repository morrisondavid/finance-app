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
import {
  AccrualResponseSchema,
  ContractIdSchema,
  ContractsListResponseSchema,
  EntityIdSchema,
  ExpectedReceiptsResponseSchema,
  LeaveCreateResponseSchema,
  LeaveIdSchema,
  LeaveListResponseSchema,
  LeaveRequestSchema,
  TemplatePreviewRequestSchema,
  TemplatePreviewResponseSchema,
  type Contract,
  type LeaveRow,
} from '../../shared/api-contracts.js';
import { buildAggregateAccrualResponse } from '../domain/contracts/aggregate-accrual.js';
import { allContracts, findContractById } from '../domain/contracts/queries.js';
import {
  deleteLeaveRow,
  findLeaveById,
  leaveForContract,
  upsertLeaveRows,
  allLeave,
  composeLeaveId,
} from '../domain/leave/index.js';
import { findClientById } from '../domain/clients/queries.js';
import { companyById } from '../domain/company/queries.js';
import { getPerson } from '../domain/people/queries.js';
import {
  buildTemplateContext,
  renderTemplate,
  DirectClientHasNoAgencyRenewalFlow,
  TemplateContextInvalid,
  TemplateMissing,
} from '../domain/templates/index.js';
import { todayIsoLocal } from '../../shared/iso-date.js';
import { holidayDatesForEntity } from '../domain/working-days/public-holidays.js';
import { buildExpectedReceipts } from '../domain/contracts/expected-receipts.js';
import { computeAccrual } from '../domain/contracts/income-accrual.js';
import { resolveLastPaymentsForContracts } from '../domain/contracts/last-payment-resolver.js';

const router = express.Router();

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : 'Unknown error';
}

function parseContractId(raw: string): string | null {
  const parsed = ContractIdSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

function parseLeaveId(raw: string): string | null {
  const parsed = LeaveIdSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

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

// ---------------------------------------------------------------------------
// GET /api/contracts — list
// ---------------------------------------------------------------------------

router.get('/', (_req: Request, res: Response) => {
  try {
    const body = ContractsListResponseSchema.parse({ contracts: allContracts() });
    res.json(body);
  } catch (error) {
    console.error('[Contracts] GET / error:', error);
    res.status(500).json({ error: `Failed to list contracts: ${errorMessage(error)}` });
  }
});

// ---------------------------------------------------------------------------
// GET /api/contracts/income-accrual — aggregate
// ---------------------------------------------------------------------------

router.get('/income-accrual', (_req: Request, res: Response) => {
  try {
    res.json(buildAggregateAccrualResponse());
  } catch (error) {
    console.error('[Contracts] GET /income-accrual error:', error);
    res.status(500).json({ error: `Failed to compute aggregate accrual: ${errorMessage(error)}` });
  }
});

const ExpectedReceiptsQuerySchema = z.object({
  days: z.coerce.number().int().positive().default(720),
  entityId: EntityIdSchema.optional(),
});

// ---------------------------------------------------------------------------
// GET /api/contracts/expected-receipts
// ---------------------------------------------------------------------------

router.get('/expected-receipts', (req: Request, res: Response) => {
  try {
    const parsed = ExpectedReceiptsQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid-params', issues: parsed.error.issues });
      return;
    }
    const { days: horizonDays, entityId: filterEntityId } = parsed.data;
    const body = buildExpectedReceipts({ horizonDays, filterEntityId });
    res.json(ExpectedReceiptsResponseSchema.parse(body));
  } catch (error) {
    console.error('[Contracts] GET /expected-receipts error:', error);
    res.status(500).json({ error: `Failed to build expected receipts: ${errorMessage(error)}` });
  }
});

// ---------------------------------------------------------------------------
// GET /api/contracts/:id
// ---------------------------------------------------------------------------

router.get('/:id', (req: Request<{ id: string }>, res: Response) => {
  const contract = contractOr404(req.params.id, res);
  if (contract === null) return;
  res.json({ contract });
});

// ---------------------------------------------------------------------------
// GET /api/contracts/:id/income-accrual
// ---------------------------------------------------------------------------

router.get('/:id/income-accrual', (req: Request<{ id: string }>, res: Response) => {
  const contract = contractOr404(req.params.id, res);
  if (contract === null) return;
  try {
    const today = todayIsoLocal();
    const leaveRows = leaveForContract(contract.id);
    const lastPayments = resolveLastPaymentsForContracts({
      contracts: [contract],
      today,
    });
    const yearStart = today.slice(0, 4) + '-01-01';
    const yearEnd = today.slice(0, 4) + '-12-31';
    const publicHolidayDates = holidayDatesForEntity(
      contract.issuing_entity_id, yearStart, yearEnd,
    );
    const body = AccrualResponseSchema.parse(
      computeAccrual({
        contract,
        leaveRows,
        today,
        lastPaymentDate: lastPayments.get(contract.id) ?? null,
        publicHolidayDates,
      }),
    );
    res.json(body);
  } catch (error) {
    console.error('[Contracts] GET /:id/income-accrual error:', error);
    res.status(500).json({ error: `Failed to compute accrual: ${errorMessage(error)}` });
  }
});

// ---------------------------------------------------------------------------
// GET /api/contracts/:id/leave
// ---------------------------------------------------------------------------

router.get('/:id/leave', (req: Request<{ id: string }>, res: Response) => {
  const contract = contractOr404(req.params.id, res);
  if (contract === null) return;
  try {
    const body = LeaveListResponseSchema.parse({
      leave: leaveForContract(contract.id),
    });
    res.json(body);
  } catch (error) {
    console.error('[Contracts] GET /:id/leave error:', error);
    res.status(500).json({ error: `Failed to list leave: ${errorMessage(error)}` });
  }
});

// ---------------------------------------------------------------------------
// POST /api/contracts/:id/leave
// ---------------------------------------------------------------------------

function datesOutsideWindow(
  dates: readonly string[],
  contract: Contract,
): string | null {
  for (const date of dates) {
    if (date < contract.start_date) return date;
    if (contract.end_date !== null && date > contract.end_date) return date;
  }
  return null;
}

router.post('/:id/leave', (req: Request<{ id: string }>, res: Response) => {
  const contract = contractOr404(req.params.id, res);
  if (contract === null) return;

  try {
    const body = LeaveRequestSchema.parse(req.body);
    const offending = datesOutsideWindow(body.dates, contract);
    if (offending !== null) {
      res.status(422).json({
        error: 'LeaveOutsideContractWindow',
        detail: {
          date: offending,
          contract_window: {
            start_date: contract.start_date,
            end_date: contract.end_date,
          },
        },
      });
      return;
    }

    const today = todayIsoLocal();
    const rows: LeaveRow[] = body.dates.map(date => ({
      id: composeLeaveId(contract.id, date),
      contract_id: contract.id,
      date,
      type: body.type,
      notes: body.notes ?? null,
      external_logged: body.external_logged ?? false,
      created_at: today,
      updated_at: today,
    }));

    upsertLeaveRows({ rows });

    const response = LeaveCreateResponseSchema.parse({
      leave: leaveForContract(contract.id),
      created: rows.length,
    });
    res.status(201).json(response);
  } catch (error) {
    if (error instanceof z.ZodError) {
      respondZodError(error, res);
      return;
    }
    console.error('[Contracts] POST /:id/leave error:', error);
    res.status(500).json({ error: `Failed to create leave: ${errorMessage(error)}` });
  }
});

// ---------------------------------------------------------------------------
// DELETE /api/contracts/:id/leave/:leaveId
// ---------------------------------------------------------------------------

router.delete(
  '/:id/leave/:leaveId',
  (req: Request<{ id: string; leaveId: string }>, res: Response) => {
    const contract = contractOr404(req.params.id, res);
    if (contract === null) return;

    const parsedLeaveId = parseLeaveId(req.params.leaveId);
    if (parsedLeaveId === null) {
      res.status(404).json({ error: 'Leave row not found' });
      return;
    }

    const existing = findLeaveById(parsedLeaveId);
    if (existing === null || existing.contract_id !== contract.id) {
      res.status(404).json({ error: 'Leave row not found' });
      return;
    }

    const today = todayIsoLocal();
    if (existing.date < today) {
      res.status(422).json({
        error: 'PastLeaveReadOnly',
        detail: { date: existing.date, today },
      });
      return;
    }

    try {
      deleteLeaveRow({ id: parsedLeaveId });
      res.json({ ok: true });
    } catch (error) {
      console.error('[Contracts] DELETE /:id/leave/:leaveId error:', error);
      res.status(500).json({ error: `Failed to delete leave: ${errorMessage(error)}` });
    }
  },
);

// ---------------------------------------------------------------------------
// POST /api/contracts/:id/leave-preview
// ---------------------------------------------------------------------------

router.post('/:id/leave-preview', (req: Request<{ id: string }>, res: Response) => {
  const contract = contractOr404(req.params.id, res);
  if (contract === null) return;

  try {
    const body = TemplatePreviewRequestSchema.parse(req.body);

    const client = findClientById(contract.client_id);
    if (client === null) {
      res.status(500).json({
        error: `Client ${contract.client_id} missing from registry`,
      });
      return;
    }
    const issuingEntity = companyById(contract.issuing_entity_id);
    if (issuingEntity === null) {
      res.status(500).json({
        error: `Issuing entity ${contract.issuing_entity_id} missing from registry`,
      });
      return;
    }

    const consultant = getPerson('david');
    const kind = body.type === 'sick' ? 'sickness' : 'leave';
    const today = todayIsoLocal();

    const context = buildTemplateContext({
      client,
      contract,
      issuingEntity,
      consultant,
      leave: { dates: body.dates, type: body.type },
      today,
    });

    const rendered = renderTemplate({ kind, context });
    const response = TemplatePreviewResponseSchema.parse(rendered);
    res.json(response);
  } catch (error) {
    if (error instanceof z.ZodError) {
      respondZodError(error, res);
      return;
    }
    if (error instanceof DirectClientHasNoAgencyRenewalFlow) {
      res.status(422).json({ error: error.name, detail: error.message });
      return;
    }
    if (error instanceof TemplateMissing) {
      res.status(500).json({ error: error.name, detail: error.message });
      return;
    }
    if (error instanceof TemplateContextInvalid) {
      res.status(422).json({ error: error.name, detail: error.message });
      return;
    }
    console.error('[Contracts] POST /:id/leave-preview error:', error);
    res.status(500).json({ error: `Failed to render preview: ${errorMessage(error)}` });
  }
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
// supersedes-link, renewal deadline re-seed) lives under §1.2.B Phase B
// in the roadmap. This endpoint exists so the frontend can wire a
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
