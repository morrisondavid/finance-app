/**
 * Templates domain — Zod schemas for the `renderTemplate` surface.
 *
 * The `TemplateKindSchema` lives in `shared/api-contracts.ts` (it is a
 * canonical enum shared with frontend form bindings) — we re-export it
 * here so the templates module is a self-contained import surface.
 *
 * `TemplateContextSchema` is the shape Bag-of-Holding passed to
 * `renderTemplate` — a client row, a contract row, a consultant block
 * (who am I + how do I sign off), an optional leave block (populated
 * for `leave` / `sickness` kinds), and `today`. A schema violation
 * becomes a structured {@link TemplateContextInvalid} error.
 *
 * **Leave-type note.** `leave.type` is `'holiday' | 'sick'` —
 * personal-records-only. It never appears in the rendered template
 * body; the template says "I'll be out on [dates]" regardless of the
 * type. Outside-IR35 contracting has no paid-leave concept, so there
 * is deliberately no `paid` field.
 */

import { z } from 'zod';
import {
  ClientSchema,
  ContractSchema,
  IsoDateSchema,
  LeaveTypeSchema,
} from '../../../shared/api-contracts.js';

export { TemplateKindSchema, LeaveTypeSchema } from '../../../shared/api-contracts.js';
export type { TemplateKind, LeaveType } from '../../../shared/api-contracts.js';

/**
 * Consultant sender block — the name + email the template signs off /
 * is sent from. Derived by `buildTemplateContext` from the people
 * registry (name) and the company registry (email), with
 * `client.client_assigned_email` as an optional override.
 */
export const TemplateConsultantSchema = z.object({
  name: z.string().min(1),
  email: z.string().min(1),
});
export type TemplateConsultant = z.infer<typeof TemplateConsultantSchema>;

/**
 * Leave block, populated for `leave` / `sickness` kinds. `dates` is a
 * sorted array of ISO `YYYY-MM-DD` strings (one per working day
 * affected); `range_label` is a pre-rendered human string like
 * "Mon 4 May – Fri 8 May 2026" that the template body drops in
 * verbatim. `type` is internal only (see module docstring).
 */
export const TemplateLeaveSchema = z.object({
  dates: z.array(IsoDateSchema).min(1),
  range_label: z.string().min(1),
  type: LeaveTypeSchema,
});
export type TemplateLeave = z.infer<typeof TemplateLeaveSchema>;

/**
 * Full template context. The client + contract blocks are the
 * canonical registry rows (not stripped) so templates can reference
 * any field via `{{client.legal_name}}` / `{{contract.reference}}` /
 * etc. without the renderer having to know about every field.
 *
 * `recipient_name` is the pre-resolved salutation — keeps the
 * template one-liner-clean (`Hi {{recipient_name}},`) instead of
 * every template repeating the direct-vs-agency `{{#if}}` dance that
 * recipient resolution has to perform anyway. Derived by
 * `buildTemplateContext` using the same matrix as
 * {@link resolveRecipients}.
 */
export const TemplateContextSchema = z.object({
  client: ClientSchema,
  contract: ContractSchema,
  consultant: TemplateConsultantSchema,
  recipient_name: z.string().min(1),
  leave: TemplateLeaveSchema.nullable(),
  today: IsoDateSchema,
});
export type TemplateContext = z.infer<typeof TemplateContextSchema>;

/**
 * Output of `renderTemplate` — the rendered subject + body plus the
 * resolved recipient lists. Neither list carries duplicates; the
 * renderer is responsible for de-duping before returning.
 */
export const TemplateResultSchema = z.object({
  subject: z.string().min(1),
  body: z.string().min(1),
  recipients: z.object({
    to: z.array(z.string().min(1)),
    cc: z.array(z.string()),
  }),
});
export type TemplateResult = z.infer<typeof TemplateResultSchema>;
