import { describe, it, expect } from 'vitest';
import { renderTemplate } from './render.js';
import { buildTemplateContext } from './build-context.js';
import {
  DirectClientHasNoAgencyRenewalFlow,
  TemplateMissing,
  TemplateContextInvalid,
} from './errors.js';
import {
  getDavidPerson,
  makeDcContractFixture,
  makeDeltaCapitaFixtureClient,
  makeLaFosseFixtureClient,
  makeLfContractFixture,
  makeUkCompanyFixture,
} from './test-helpers.js';

const today = '2026-04-22';

function leaveCtx(kind: 'holiday' | 'sick') {
  return buildTemplateContext({
    client: makeDeltaCapitaFixtureClient(),
    contract: makeDcContractFixture(),
    issuingEntity: makeUkCompanyFixture(),
    consultant: getDavidPerson(),
    leave: { dates: ['2026-05-04', '2026-05-05'], type: kind },
    today,
  });
}

function lfLeaveCtx() {
  return buildTemplateContext({
    client: makeLaFosseFixtureClient(),
    contract: makeLfContractFixture(),
    issuingEntity: makeUkCompanyFixture(),
    consultant: getDavidPerson(),
    leave: { dates: ['2026-02-02'], type: 'holiday' },
    today,
  });
}

function renewalCtx() {
  return buildTemplateContext({
    client: makeLaFosseFixtureClient(),
    contract: makeLfContractFixture(),
    issuingEntity: makeUkCompanyFixture(),
    consultant: getDavidPerson(),
    leave: null,
    today,
  });
}

function invoiceCoverCtx() {
  return buildTemplateContext({
    client: makeDeltaCapitaFixtureClient(),
    contract: makeDcContractFixture(),
    issuingEntity: makeUkCompanyFixture(),
    consultant: getDavidPerson(),
    leave: null,
    today,
  });
}

/** Fake file resolver — returns canned templates keyed by relative path. */
function mkReadFile(files: Record<string, string>): (p: string) => string | null {
  return (p) => files[p] ?? null;
}

const SHARED_LEAVE = `---
subject: Planned leave — {{client.trading_name}}
---
Hi {{client.primary_contact_name}},

Quick note to confirm I'll be out on {{leave.range_label}}:

{{#each leave.dates}}- {{this}}
{{/each}}
Best,
{{consultant.name}}
`;

const SHARED_SICKNESS = `---
subject: Sickness — {{client.trading_name}}
---
Hi {{client.primary_contact_name}},

Letting you know I'm unwell and off today ({{leave.range_label}}).

{{consultant.name}}
`;

const SHARED_INVOICE_COVER = `---
subject: Invoice — {{contract.reference}}
---
Hi {{client.primary_contact_name}},

Please find this period's invoice for {{contract.reference}}.

Best,
{{consultant.name}}
`;

const SHARED_RENEWAL = `---
subject: Renewal — {{contract.reference}}
---
{{#if client.end_client_legal_name}}Hi {{client.primary_contact_name}},

Wanted to flag the upcoming renewal for the contract at {{client.end_client_legal_name}}.{{/if}}

Best,
{{consultant.name}}
`;

const ALL_SHARED_TEMPLATES: Record<string, string> = {
  'clients/templates/leave.hbs': SHARED_LEAVE,
  'clients/templates/sickness.hbs': SHARED_SICKNESS,
  'clients/templates/invoice-cover.hbs': SHARED_INVOICE_COVER,
  'clients/templates/renewal.hbs': SHARED_RENEWAL,
};

describe('renderTemplate — happy paths', () => {
  it('renders a DC `leave` email with resolved recipients + interpolated body', () => {
    const result = renderTemplate({
      kind: 'leave',
      context: leaveCtx('holiday'),
      readFile: mkReadFile(ALL_SHARED_TEMPLATES),
    });
    expect(result.subject).toBe('Planned leave — Delta Capita');
    expect(result.body).toContain('Hi Lily Lovegrove-Saville');
    expect(result.body).toContain('04 May 2026 – 05 May 2026');
    expect(result.body).toContain('- 2026-05-04');
    expect(result.body).toContain('- 2026-05-05');
    expect(result.body).toContain('David Morrison');
    expect(result.recipients.to).toEqual(['lily.lovegrove@deltacapita.com']);
    expect(result.recipients.cc).toEqual([
      'philip.coleman@deltacapita.com',
      'william.swift@deltacapita.com',
      'hrandrecruitment@deltacapita.com',
      'dan.hedley@deltacapita.com',
    ]);
  });

  it('renders a DC `sickness` email routed the same way as leave', () => {
    const result = renderTemplate({
      kind: 'sickness',
      context: leaveCtx('sick'),
      readFile: mkReadFile(ALL_SHARED_TEMPLATES),
    });
    expect(result.subject).toBe('Sickness — Delta Capita');
    expect(result.recipients.to).toEqual(['lily.lovegrove@deltacapita.com']);
  });

  it('renders a DC `invoice-cover` email', () => {
    const result = renderTemplate({
      kind: 'invoice-cover',
      context: invoiceCoverCtx(),
      readFile: mkReadFile(ALL_SHARED_TEMPLATES),
    });
    expect(result.subject).toBe('Invoice — Delta Capita · 01 Jan 2026–30 Apr 2026');
    expect(result.body).toContain('Delta Capita · 01 Jan 2026–30 Apr 2026');
    expect(result.recipients.to).toEqual(['lily.lovegrove@deltacapita.com']);
  });

  it('renders a LF agency `leave` email to Aidan, no cc', () => {
    const result = renderTemplate({
      kind: 'leave',
      context: lfLeaveCtx(),
      readFile: mkReadFile(ALL_SHARED_TEMPLATES),
    });
    expect(result.recipients.to).toEqual(['aidan.gray@edwingroup.com']);
    expect(result.recipients.cc).toEqual([]);
  });

  it('renders a LF `renewal` with the {{#if}} block expanded (agency → end-client phrasing)', () => {
    const result = renderTemplate({
      kind: 'renewal',
      context: renewalCtx(),
      readFile: mkReadFile(ALL_SHARED_TEMPLATES),
    });
    expect(result.subject).toBe('Renewal — La Fosse · 06 Jan 2026–31 Mar 2026');
    expect(result.body).toContain('The Edwin Group Ltd');
    expect(result.recipients.to).toEqual(['accounts@lafosse.com']);
  });

  it('prefers a per-client override file when one is available', () => {
    const override = `---
subject: DC-specific leave — {{client.trading_name}}
---
Custom DC body
`;
    const result = renderTemplate({
      kind: 'leave',
      context: leaveCtx('holiday'),
      readFile: mkReadFile({
        ...ALL_SHARED_TEMPLATES,
        'clients/templates/delta-capita/leave.hbs': override,
      }),
    });
    expect(result.subject).toBe('DC-specific leave — Delta Capita');
    expect(result.body).toContain('Custom DC body');
  });
});

describe('renderTemplate — error paths', () => {
  it('throws TemplateMissing when neither override nor shared file is on disk', () => {
    expect(() =>
      renderTemplate({
        kind: 'leave',
        context: leaveCtx('holiday'),
        readFile: mkReadFile({}),
      }),
    ).toThrow(TemplateMissing);
  });

  it('throws DirectClientHasNoAgencyRenewalFlow on DC renewal', () => {
    expect(() =>
      renderTemplate({
        kind: 'renewal',
        context: buildTemplateContext({
          client: makeDeltaCapitaFixtureClient(),
          contract: makeDcContractFixture(),
          issuingEntity: makeUkCompanyFixture(),
          consultant: getDavidPerson(),
          leave: null,
          today,
        }),
        readFile: mkReadFile(ALL_SHARED_TEMPLATES),
      }),
    ).toThrow(DirectClientHasNoAgencyRenewalFlow);
  });

  it('throws TemplateContextInvalid when the template references an unresolved path', () => {
    expect(() =>
      renderTemplate({
        kind: 'leave',
        context: leaveCtx('holiday'),
        readFile: mkReadFile({
          'clients/templates/leave.hbs': '---\nsubject: s\n---\n{{nonexistent.field}}',
        }),
      }),
    ).toThrow(TemplateContextInvalid);
  });

  it('throws TemplateContextInvalid when the template has no frontmatter', () => {
    expect(() =>
      renderTemplate({
        kind: 'leave',
        context: leaveCtx('holiday'),
        readFile: mkReadFile({ 'clients/templates/leave.hbs': 'no frontmatter here' }),
      }),
    ).toThrow(TemplateContextInvalid);
  });

  it('throws TemplateContextInvalid when the frontmatter has no subject', () => {
    expect(() =>
      renderTemplate({
        kind: 'leave',
        context: leaveCtx('holiday'),
        readFile: mkReadFile({ 'clients/templates/leave.hbs': '---\nfoo: bar\n---\nbody' }),
      }),
    ).toThrow(TemplateContextInvalid);
  });
});
