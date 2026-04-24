/**
 * Templates domain — structured error types.
 *
 * Every failure mode is a named class so routes can translate them to
 * HTTP status codes without string-matching `error.message`. Each
 * error carries enough context on its own fields that a log / API
 * response can reconstruct the exact inputs that failed.
 */

import type { TemplateKind } from './schema.js';

/**
 * Raised when a `renewal` template is requested against a `direct`
 * client. Direct clients run their own renewals — there is no flow to
 * render here. Routes translate this to HTTP 422.
 */
export class DirectClientHasNoAgencyRenewalFlow extends Error {
  readonly name = 'DirectClientHasNoAgencyRenewalFlow';
  constructor(public readonly clientId: string) {
    super(`No agency-renewal flow exists for direct client "${clientId}"`);
  }
}

/**
 * Raised when a `timesheet` template is requested against a contract
 * whose `invoice_mechanism = supplier-issued`. Supplier-issued
 * contracts bill through a consultant-issued invoice, not an agency
 * timesheet — there is nothing to submit. Routes translate this to
 * HTTP 422.
 *
 * Not triggered by anything in this shipment (this bundle renders
 * only `leave | sickness | invoice-cover | renewal`) but the class is
 * committed so 2.3's timesheet flow can reuse it without churn.
 */
export class TimesheetNotApplicableForSupplierIssued extends Error {
  readonly name = 'TimesheetNotApplicableForSupplierIssued';
  constructor(public readonly contractId: string) {
    super(`Timesheet template is not applicable to supplier-issued contract "${contractId}"`);
  }
}

/**
 * Raised when the `.hbs` file for `(clientId, kind)` cannot be found
 * on disk at any resolved candidate path. Routes translate this to
 * HTTP 500 (misconfiguration, not user error).
 */
export class TemplateMissing extends Error {
  readonly name = 'TemplateMissing';
  constructor(
    public readonly kind: TemplateKind,
    public readonly clientId: string,
    public readonly searchedPaths: readonly string[],
  ) {
    super(
      `No template on disk for (kind=${kind}, client=${clientId}). Searched: ${searchedPaths.join(', ')}`,
    );
  }
}

/**
 * Raised when the resolved context failed `TemplateContextSchema`.
 * Typically a `TBC` field leaked through for a template that needs a
 * concrete value, or a placeholder in the template referenced a path
 * that does not exist on the context. Routes translate this to HTTP
 * 500.
 */
export class TemplateContextInvalid extends Error {
  readonly name = 'TemplateContextInvalid';
  constructor(public readonly detail: string, public readonly path?: string) {
    super(
      path === undefined
        ? `Template context invalid: ${detail}`
        : `Template context invalid at "${path}": ${detail}`,
    );
  }
}
