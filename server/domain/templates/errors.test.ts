import { describe, it, expect } from 'vitest';
import {
  DirectClientHasNoAgencyRenewalFlow,
  TimesheetNotApplicableForSupplierIssued,
  TemplateMissing,
  TemplateContextInvalid,
} from './errors.js';

describe('DirectClientHasNoAgencyRenewalFlow', () => {
  it('carries the client id and name', () => {
    const err = new DirectClientHasNoAgencyRenewalFlow('delta-capita');
    expect(err.name).toBe('DirectClientHasNoAgencyRenewalFlow');
    expect(err.clientId).toBe('delta-capita');
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toContain('delta-capita');
  });
});

describe('TimesheetNotApplicableForSupplierIssued', () => {
  it('carries the contract id and name', () => {
    const err = new TimesheetNotApplicableForSupplierIssued('dc-sow-2026');
    expect(err.name).toBe('TimesheetNotApplicableForSupplierIssued');
    expect(err.contractId).toBe('dc-sow-2026');
    expect(err.message).toContain('dc-sow-2026');
  });
});

describe('TemplateMissing', () => {
  it('surfaces the searched paths in the message', () => {
    const err = new TemplateMissing('leave', 'delta-capita', [
      'clients/templates/delta-capita/leave.hbs',
      'clients/templates/leave.hbs',
    ]);
    expect(err.name).toBe('TemplateMissing');
    expect(err.kind).toBe('leave');
    expect(err.clientId).toBe('delta-capita');
    expect(err.searchedPaths).toEqual([
      'clients/templates/delta-capita/leave.hbs',
      'clients/templates/leave.hbs',
    ]);
    expect(err.message).toContain('clients/templates/leave.hbs');
  });
});

describe('TemplateContextInvalid', () => {
  it('optionally carries a path to the offending field', () => {
    const err = new TemplateContextInvalid('primary_contact_email is TBC', 'client.primary_contact_email');
    expect(err.name).toBe('TemplateContextInvalid');
    expect(err.path).toBe('client.primary_contact_email');
    expect(err.detail).toBe('primary_contact_email is TBC');
    expect(err.message).toContain('client.primary_contact_email');
  });

  it('renders without a path when one is not provided', () => {
    const err = new TemplateContextInvalid('generic failure');
    expect(err.path).toBeUndefined();
    expect(err.message).toBe('Template context invalid: generic failure');
  });
});
