import { describe, it, expect } from 'vitest';
import { resolveRecipients } from './resolve-recipients.js';
import {
  DirectClientHasNoAgencyRenewalFlow,
  TemplateContextInvalid,
} from './errors.js';
import {
  makeDeltaCapitaFixtureClient,
  makeLaFosseFixtureClient,
} from './test-helpers.js';

describe('resolveRecipients — direct client (Delta Capita)', () => {
  const client = makeDeltaCapitaFixtureClient();

  it('routes `leave` to primary contact + HR + cc_emails on cc', () => {
    const { to, cc } = resolveRecipients('leave', client);
    expect(to).toEqual(['lily.lovegrove@deltacapita.com']);
    expect(cc).toEqual([
      'philip.coleman@deltacapita.com',
      'william.swift@deltacapita.com',
      'hrandrecruitment@deltacapita.com',
      'dan.hedley@deltacapita.com',
    ]);
  });

  it('routes `sickness` the same way as `leave` for direct clients', () => {
    const { to, cc } = resolveRecipients('sickness', client);
    expect(to).toEqual(['lily.lovegrove@deltacapita.com']);
    expect(cc).toContain('william.swift@deltacapita.com');
  });

  it('routes `invoice-cover` to primary + accounts (when present) + cc_emails; no HR on cc', () => {
    const { to, cc } = resolveRecipients('invoice-cover', client);
    expect(to).toEqual(['lily.lovegrove@deltacapita.com']);
    // DC test fixture has no accounts_contact_email, so HR is not copied
    // on invoice-cover — only secondary + cc_emails.
    expect(cc).toEqual([
      'philip.coleman@deltacapita.com',
      'hrandrecruitment@deltacapita.com',
      'dan.hedley@deltacapita.com',
    ]);
    expect(cc).not.toContain('william.swift@deltacapita.com');
  });

  it('raises DirectClientHasNoAgencyRenewalFlow on `renewal`', () => {
    expect(() => resolveRecipients('renewal', client)).toThrow(DirectClientHasNoAgencyRenewalFlow);
  });

  it('raises TemplateContextInvalid on `timesheet` (not applicable to direct clients)', () => {
    expect(() => resolveRecipients('timesheet', client)).toThrow(TemplateContextInvalid);
  });
});

describe('resolveRecipients — agency client (La Fosse / Edwin)', () => {
  const client = makeLaFosseFixtureClient();

  it('routes `leave` to the end-client primary only; La Fosse excluded from cc', () => {
    const { to, cc } = resolveRecipients('leave', client);
    expect(to).toEqual(['aidan.gray@edwingroup.com']);
    expect(cc).toEqual([]);
    expect(cc).not.toContain('accounts@lafosse.com');
  });

  it('routes `sickness` the same way as `leave`', () => {
    const { to, cc } = resolveRecipients('sickness', client);
    expect(to).toEqual(['aidan.gray@edwingroup.com']);
    expect(cc).toEqual([]);
  });

  it('routes `invoice-cover` to the end-client primary only; agency never copied', () => {
    const { to, cc } = resolveRecipients('invoice-cover', client);
    expect(to).toEqual(['aidan.gray@edwingroup.com']);
    expect(cc).toEqual([]);
  });

  it('routes `renewal` to the agency primary (not the end client)', () => {
    const { to, cc } = resolveRecipients('renewal', client);
    expect(to).toEqual(['accounts@lafosse.com']);
    expect(cc).toEqual([]);
  });

  it('routes `timesheet` to the agency primary (not the end client)', () => {
    const { to, cc } = resolveRecipients('timesheet', client);
    expect(to).toEqual(['accounts@lafosse.com']);
    expect(cc).toEqual([]);
  });
});

describe('resolveRecipients — de-dupe', () => {
  const client = makeDeltaCapitaFixtureClient();

  it('returns a cc list with no duplicate addresses (case-insensitive)', () => {
    const { cc } = resolveRecipients('leave', client);
    const lowercased = cc.map(a => a.toLowerCase());
    expect(new Set(lowercased).size).toBe(lowercased.length);
  });
});
