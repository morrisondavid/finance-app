/**
 * Public holidays endpoint — returns entity-scoped public holidays
 * for a date window. Consumed by the leave calendar (§1.4) for
 * background events and available for any consumer that needs to
 * know "which days are public holidays for this entity?".
 */

import { Router } from 'express';
import { z } from 'zod';
import {
  EntityIdSchema,
  IsoDateSchema,
} from '../../shared/api-contracts.js';
import { getPublicHolidays } from '../domain/working-days/public-holidays.js';
import { companyById } from '../domain/company/index.js';

const router = Router();

const QuerySchema = z.object({
  entityId: EntityIdSchema,
  start: IsoDateSchema,
  end: IsoDateSchema,
});

router.get('/', (req, res) => {
  const parsed = QuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: 'invalid-params', issues: parsed.error.issues });
    return;
  }

  const { entityId, start, end } = parsed.data;
  const company = companyById(entityId);
  if (!company) {
    res.status(404).json({ error: 'entity-not-found' });
    return;
  }

  const startYear = Number(start.slice(0, 4));
  const endYear = Number(end.slice(0, 4));
  const holidays: { date: string; name: string }[] = [];
  for (let y = startYear; y <= endYear; y++) {
    for (const h of getPublicHolidays(company.jurisdiction, y)) {
      if (h.date >= start && h.date <= end) {
        holidays.push(h);
      }
    }
  }

  res.json({ holidays });
});

export default router;
