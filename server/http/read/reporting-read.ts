import {
  EntityIdSchema,
  ReportingReadinessResponseSchema,
  ReportingRegimeSchema,
} from '../../../shared/api-contracts.js';
import { computeReportingReadiness } from '../../domain/reporting/index.js';
import { jsonReadFail, jsonReadOk, type JsonReadResult } from './types.js';

interface ReportingReadinessQueryRaw {
  entityId?: unknown;
  regime?: unknown;
  period?: unknown;
}

export function readReportingReadiness(raw: ReportingReadinessQueryRaw): JsonReadResult {
  const entityParsed = EntityIdSchema.safeParse(raw.entityId);
  if (!entityParsed.success) {
    return jsonReadFail(400, { error: 'entityId must be autonize-it-ltd or autonize-it-fzco' });
  }

  const regimeParsed = ReportingRegimeSchema.safeParse(raw.regime);
  if (!regimeParsed.success) {
    return jsonReadFail(400, { error: 'regime must be vat or corporation_tax' });
  }

  if (typeof raw.period !== 'string' || raw.period.trim() === '') {
    return jsonReadFail(400, { error: 'period is required' });
  }

  try {
    const result = computeReportingReadiness({
      entityId: entityParsed.data,
      regime: regimeParsed.data,
      periodLabel: raw.period.trim(),
    });
    return jsonReadOk(ReportingReadinessResponseSchema.parse(result));
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Invalid period';
    return jsonReadFail(400, { error: message });
  }
}
