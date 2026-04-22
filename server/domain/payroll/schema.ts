/**
 * Payroll domain — Zod schema + inferred TS types.
 *
 * The payroll domain is a derivation over two upstream registries
 * (obligations + people), so the schema here describes the
 * *hydrated* records the registry surfaces — not a separate
 * source-of-truth data file. The raw rows live in the payroll
 * obligation rows of `obligations-seed.csv` and `obligations.csv`
 * (validated by the obligations schema at read time).
 */

import { z } from 'zod';
import { PersonIdSchema } from '../people/schema.js';

export const DirectorPayrollSchema = z
  .object({
    personId: PersonIdSchema,
    monthlySalary: z.number(),
    tolerance: z.number().nonnegative(),
    namePattern: z.string().min(1),
    label: z.string().min(1),
    code: z.string().min(1),
  })
  .readonly();

export type DirectorPayroll = z.infer<typeof DirectorPayrollSchema>;
