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
import { sendJsonMutation } from '../http/mutation/send-json-mutation.js';
import {
  mutateDeadlinesClearDone,
  mutateDeadlinesCreate,
  mutateDeadlinesMarkDone,
  mutateDeadlinesRemove,
  mutateDeadlinesUpdate,
} from '../http/mutation/deadlines.js';
import { buildDeadlineFeed } from '../db/repositories/deadline-feed.js';
import { buildIcsCalendar } from '../utils/ics-builder.js';
import { sendJsonRead } from '../http/read/send-json-read.js';
import {
  readDeadlinesRoot,
  readDeadlinesFeedQuery,
  readDeadlineById,
} from '../http/read/deadlines-read.js';

const router = express.Router();

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
  sendJsonMutation(res, mutateDeadlinesCreate(req.body));
});

router.put('/:id', (req: Request<{ id: string }>, res: Response) => {
  sendJsonMutation(res, mutateDeadlinesUpdate(req.params.id, req.body));
});

router.delete('/:id', (req: Request<{ id: string }>, res: Response) => {
  sendJsonMutation(res, mutateDeadlinesRemove(req.params.id));
});

router.post('/:id/complete', (req: Request<{ id: string }>, res: Response) => {
  sendJsonMutation(res, mutateDeadlinesMarkDone(req.params.id, req.body ?? {}));
});

router.delete('/:id/complete', (req: Request<{ id: string }>, res: Response) => {
  sendJsonMutation(res, mutateDeadlinesClearDone(req.params.id));
});

export default router;
