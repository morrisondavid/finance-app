import { z } from 'zod';
import {
  EntityIdSchema,
  IsoDateSchema,
} from '../../../shared/api-contracts.js';
import { getPublicHolidays } from '../../domain/working-days/public-holidays.js';
import { companyById } from '../../domain/company/index.js';
import { jsonReadFail, jsonReadOk, type JsonReadResult } from './types.js';

export const PublicHolidaysQuerySchema = z.object({
  entityId: EntityIdSchema,
  start: IsoDateSchema,
  end: IsoDateSchema,
});

/** GET /api/public-holidays parity. */
export function readPublicHolidaysFromQuery(query: Record<string, unknown>): JsonReadResult {
  const parsed = PublicHolidaysQuerySchema.safeParse(query);
  if (!parsed.success) {
    return jsonReadFail(400, { error: 'invalid-params', issues: parsed.error.issues });
  }

  const { entityId, start, end } = parsed.data;
  const company = companyById(entityId);
  if (!company) {
    return jsonReadFail(404, { error: 'entity-not-found' });
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

  return jsonReadOk({ holidays });
}
