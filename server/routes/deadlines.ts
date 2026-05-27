/**
 * /api/deadlines — CRUD for non-financial deadlines + the unified
 * feed + ICS export.
 *
 * Route map:
 *   GET    /api/deadlines             — list all deadlines (CSV projection).
 *   POST   /api/deadlines             — create a deadline.
 *   PUT    /api/deadlines/:id         — update a deadline.
 *   DELETE /api/deadlines/:id         — delete a deadline.
 *   POST   /api/deadlines/:id/complete — mark done (optional completedDate).
 *   DELETE /api/deadlines/:id/complete — unmark done.
 *
 *   GET    /api/deadlines/feed        — unified feed (deadlines + obligations).
 *   GET    /api/deadlines.ics         — ICS export of the same feed.
 *
 * All mutating endpoints: validate body with Zod → repository →
 * re-export deadlines.csv → return the refreshed entity so the client
 * can re-render without a second fetch. Mirrors the debts router.
 */

import express, { Request, Response } from 'express';
import { z } from 'zod';
import {
  DeadlineCreateBodySchema,
  DeadlineUpdateBodySchema,
  DeadlineCompleteBodySchema,
} from '../../shared/api-contracts.js';
import {
  getDeadline,
  createDeadline,
  updateDeadline,
  deleteDeadline,
  markDeadlineDone,
  unmarkDeadlineDone,
} from '../db/repositories/deadlines.js';
import { buildDeadlineFeed } from '../db/repositories/deadline-feed.js';
import { buildIcsCalendar } from '../utils/ics-builder.js';
import { sendJsonRead } from '../http/read/send-json-read.js';
import {
  readDeadlinesRoot,
  readDeadlinesFeedQuery,
  readDeadlineById,
} from '../http/read/deadlines-read.js';

const router = express.Router();

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : 'Unknown error';
}

function isValidationError(msg: string): boolean {
  return (
    msg.includes('must be') ||
    msg.startsWith('Deadline ') ||
    msg.includes('already exists')
  );
}

router.get('/', (_req: Request, res: Response) => {
  sendJsonRead(res, readDeadlinesRoot());
});

/**
 * ICS export. Declared before `/:id` so Express doesn't try to match
 * the `.ics` literal as an id param. Browser / Google Calendar hit
 * this endpoint over HTTP as a subscribed calendar.
 */
router.get('/.ics', (req: Request, res: Response) => {
  try {
    const from = typeof req.query.from === 'string' ? req.query.from : null;
    const to = typeof req.query.to === 'string' ? req.query.to : null;
    const items = buildDeadlineFeed({ from, to });
    const body = buildIcsCalendar(items, { calendarName: 'Bank Statements Deadlines' });
    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.setHeader('Content-Disposition', 'inline; filename="deadlines.ics"');
    res.send(body);
  } catch (error) {
    console.error('[Deadlines] ICS error:', error);
    res.status(500).json({ error: 'Failed to build ICS feed' });
  }
});

router.get('/feed', (req: Request, res: Response) => {
  sendJsonRead(res, readDeadlinesFeedQuery(req.query));
});

router.get('/:id', (req: Request<{ id: string }>, res: Response) => {
  sendJsonRead(res, readDeadlineById(req.params.id));
});

router.post('/', (req: Request, res: Response) => {
  try {
    const body = DeadlineCreateBodySchema.parse(req.body);
    const deadline = createDeadline({
      id: body.id,
      type: body.type,
      title: body.title,
      dueDate: body.dueDate,
      recurrence: body.recurrence,
      notes: body.notes ?? null,
      url: body.url ?? null,
      completedDate: body.completedDate ?? null,
    });
    res.status(201).json({ deadline });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: 'Invalid request', details: error.issues });
      return;
    }
    const msg = errorMessage(error);
    if (isValidationError(msg)) {
      res.status(400).json({ error: msg });
      return;
    }
    console.error('[Deadlines] POST error:', error);
    res.status(500).json({ error: 'Failed to create deadline' });
  }
});

router.put('/:id', (req: Request<{ id: string }>, res: Response) => {
  try {
    const body = DeadlineUpdateBodySchema.parse(req.body);
    const existing = getDeadline(req.params.id);
    if (!existing) {
      res.status(404).json({ error: 'Deadline not found' });
      return;
    }
    const deadline = updateDeadline(req.params.id, body);
    res.json({ deadline });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: 'Invalid request', details: error.issues });
      return;
    }
    const msg = errorMessage(error);
    if (msg.includes('not found')) {
      res.status(404).json({ error: msg });
      return;
    }
    if (isValidationError(msg)) {
      res.status(400).json({ error: msg });
      return;
    }
    console.error('[Deadlines] PUT error:', error);
    res.status(500).json({ error: 'Failed to update deadline' });
  }
});

router.delete('/:id', (req: Request<{ id: string }>, res: Response) => {
  try {
    const deleted = deleteDeadline(req.params.id);
    if (!deleted) {
      res.status(404).json({ error: 'Deadline not found' });
      return;
    }
    res.json({ ok: true });
  } catch (error) {
    console.error('[Deadlines] DELETE error:', error);
    res.status(500).json({ error: 'Failed to delete deadline' });
  }
});

router.post('/:id/complete', (req: Request<{ id: string }>, res: Response) => {
  try {
    const body = DeadlineCompleteBodySchema.parse(req.body ?? {});
    const deadline = markDeadlineDone(req.params.id, body.completedDate);
    if (!deadline) {
      res.status(404).json({ error: 'Deadline not found' });
      return;
    }
    res.json({ deadline });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: 'Invalid request', details: error.issues });
      return;
    }
    console.error('[Deadlines] complete error:', error);
    res.status(500).json({ error: 'Failed to mark deadline done' });
  }
});

router.delete('/:id/complete', (req: Request<{ id: string }>, res: Response) => {
  try {
    const deadline = unmarkDeadlineDone(req.params.id);
    if (!deadline) {
      res.status(404).json({ error: 'Deadline not found' });
      return;
    }
    res.json({ deadline });
  } catch (error) {
    console.error('[Deadlines] uncomplete error:', error);
    res.status(500).json({ error: 'Failed to unmark deadline done' });
  }
});

export default router;
