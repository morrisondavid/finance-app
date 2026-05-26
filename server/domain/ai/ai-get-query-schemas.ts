/**
 * Zod query shapes for parameterized GET /api/ai/* handlers and matching MCP tools.
 * Express `req.query` values are strings; MCP JSON may use booleans — both are accepted where relevant.
 */

import { z } from 'zod';
import { AccountNameSchema, EntityIdSchema } from '../../../shared/api-contracts.js';

const EntityQuerySchema = z.object({
  entityId: EntityIdSchema.optional(),
});

/** Same semantics as GET /api/ai/liquidity `req.query`. */
export const LiquidityQuerySchema = z.object({
  account: z.string().optional(),
  financialYear: z.string().optional(),
  groupByEntity: z
    .union([z.boolean(), z.enum(['true', 'false'])])
    .optional()
    .transform(v => (v === undefined ? undefined : v === true || v === 'true')),
});

/** GET /api/ai/pipeline */
export const HorizonEntityQuerySchema = EntityQuerySchema.extend({
  days: z.coerce.number().int().positive().default(720),
});

/** GET /api/ai/runway */
export const RunwayQuerySchema = HorizonEntityQuerySchema.extend({
  detail: z.enum(['accounts', 'summary']).default('summary'),
});

/** GET /api/ai/snapshot */
export const SnapshotQuerySchema = RunwayQuerySchema.merge(LiquidityQuerySchema);

/** GET /api/ai/financial-snapshot and GET /api/ai/financial-safety */
export const FinancialSnapshotQuerySchema = SnapshotQuerySchema.extend({
  commitmentDays: z.coerce.number().int().positive().default(90),
});

/** GET /api/ai/spend-by-currency */
export const SpendByCurrencyQuerySchema = z
  .object({
    calendarMonth: z.string().regex(/^\d{4}-\d{2}$/).optional(),
    financialYear: z.string().min(1).optional(),
    entityId: EntityIdSchema.optional(),
    account: AccountNameSchema.optional(),
  })
  .superRefine((data, ctx) => {
    const hasCm = data.calendarMonth !== undefined;
    const hasFy = data.financialYear !== undefined;
    if (hasCm === hasFy) {
      ctx.addIssue({
        code: 'custom',
        message: 'Exactly one of calendarMonth or financialYear is required',
        path: ['calendarMonth'],
      });
    }
  });
