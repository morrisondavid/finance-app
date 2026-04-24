/**
 * Templates domain — public barrel. Not a canonical registry (there
 * is no set-wise config to index) so the directory is excluded from
 * the all-registries manifest sweep via `NON_REGISTRY_DIRS`.
 */

export {
  TemplateKindSchema,
  LeaveTypeSchema,
  TemplateConsultantSchema,
  TemplateLeaveSchema,
  TemplateContextSchema,
  TemplateResultSchema,
  type TemplateKind,
  type LeaveType,
  type TemplateConsultant,
  type TemplateLeave,
  type TemplateContext,
  type TemplateResult,
} from './schema.js';

export {
  DirectClientHasNoAgencyRenewalFlow,
  TimesheetNotApplicableForSupplierIssued,
  TemplateMissing,
  TemplateContextInvalid,
} from './errors.js';

export { interpolate } from './interpolate.js';
export { resolveRecipients, type ResolvedRecipients } from './resolve-recipients.js';
export { buildTemplateContext, type BuildContextInput } from './build-context.js';
export { renderTemplate, type RenderTemplateInput } from './render.js';
