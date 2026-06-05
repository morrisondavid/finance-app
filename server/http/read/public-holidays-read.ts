import { z } from 'zod';
import {
  EntityIdSchema,
  IsoDateSchema,
  JurisdictionSchema,
} from '../../../shared/api-contracts.js';
import {
  contractWorkingDayJurisdiction,
  getPublicHolidays,
  holidayDatesForJurisdiction,
} from '../../domain/working-days/public-holidays.js';
import { companyById } from '../../domain/company/index.js';
import { findContractById } from '../../domain/contracts/index.js';
import { jsonReadFail, jsonReadOk, type JsonReadResult } from './types.js';

const WindowSchema = z.object({
  start: IsoDateSchema,
  end: IsoDateSchema,
});

export const PublicHolidaysQuerySchema = WindowSchema.extend({
  entityId: EntityIdSchema.optional(),
  contractId: z.string().min(1).optional(),
  jurisdiction: JurisdictionSchema.optional(),
}).refine(
  data => {
    const selectors = [data.entityId, data.contractId, data.jurisdiction].filter(
      value => value !== undefined,
    );
    return selectors.length === 1;
  },
  { message: 'Provide exactly one of entityId, contractId, or jurisdiction' },
);

function holidaysInWindow(
  jurisdiction: 'UK' | 'UAE',
  start: string,
  end: string,
): { date: string; name: string }[] {
  const dates = holidayDatesForJurisdiction(jurisdiction, start, end);
  const startYear = Number(start.slice(0, 4));
  const endYear = Number(end.slice(0, 4));
  const holidays: { date: string; name: string }[] = [];
  for (let y = startYear; y <= endYear; y++) {
    for (const h of getPublicHolidays(jurisdiction, y)) {
      if (dates.has(h.date)) holidays.push(h);
    }
  }
  holidays.sort((a, b) => a.date.localeCompare(b.date));
  return holidays;
}

/** GET /api/public-holidays parity. */
export function readPublicHolidaysFromQuery(query: Record<string, unknown>): JsonReadResult {
  const parsed = PublicHolidaysQuerySchema.safeParse(query);
  if (!parsed.success) {
    return jsonReadFail(400, { error: 'invalid-params', issues: parsed.error.issues });
  }

  const { start, end, entityId, contractId, jurisdiction } = parsed.data;

  if (contractId !== undefined) {
    const contract = findContractById(contractId);
    if (contract === null) {
      return jsonReadFail(404, { error: 'contract-not-found' });
    }
    return jsonReadOk({
      holidays: holidaysInWindow(contractWorkingDayJurisdiction(contract), start, end),
    });
  }

  if (jurisdiction !== undefined) {
    return jsonReadOk({ holidays: holidaysInWindow(jurisdiction, start, end) });
  }

  const company = companyById(entityId!);
  if (!company) {
    return jsonReadFail(404, { error: 'entity-not-found' });
  }

  return jsonReadOk({ holidays: holidaysInWindow(company.jurisdiction, start, end) });
}
