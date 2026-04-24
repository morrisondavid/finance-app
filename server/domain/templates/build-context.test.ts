import { describe, it, expect } from 'vitest';
import { buildTemplateContext } from './build-context.js';
import { TemplateContextInvalid } from './errors.js';
import {
  getDavidPerson,
  makeDcContractFixture,
  makeDeltaCapitaFixtureClient,
  makeLaFosseFixtureClient,
  makeLfContractFixture,
  makeUkCompanyFixture,
} from './test-helpers.js';

const today = '2026-04-22';

describe('buildTemplateContext — consultant email resolution', () => {
  it('prefers client.client_assigned_email when set (DC has one)', () => {
    const ctx = buildTemplateContext({
      client: makeDeltaCapitaFixtureClient(),
      contract: makeDcContractFixture(),
      issuingEntity: makeUkCompanyFixture(),
      consultant: getDavidPerson(),
      leave: null,
      today,
    });
    expect(ctx.consultant.email).toBe('david.morrison@ext.deltacapita.com');
    expect(ctx.consultant.name).toBe('David Morrison');
  });

  it('falls back to the issuing entity email when client_assigned_email is null (LF)', () => {
    const ctx = buildTemplateContext({
      client: makeLaFosseFixtureClient(),
      contract: makeLfContractFixture(),
      issuingEntity: makeUkCompanyFixture(),
      consultant: getDavidPerson(),
      leave: null,
      today,
    });
    const uk = makeUkCompanyFixture();
    expect(ctx.consultant.email).toBe(uk.email);
  });
});

describe('buildTemplateContext — recipient_name', () => {
  const baseDc = {
    contract: makeDcContractFixture(),
    issuingEntity: makeUkCompanyFixture(),
    consultant: getDavidPerson(),
    leave: null,
    today,
  };

  it('greets the direct primary contact name for DC', () => {
    const ctx = buildTemplateContext({ ...baseDc, client: makeDeltaCapitaFixtureClient() });
    expect(ctx.recipient_name).toBe('Lily Lovegrove-Saville');
  });

  it('greets the end-client primary contact name for an agency client', () => {
    const ctx = buildTemplateContext({
      client: makeLaFosseFixtureClient(),
      contract: makeLfContractFixture(),
      issuingEntity: makeUkCompanyFixture(),
      consultant: getDavidPerson(),
      leave: null,
      today,
    });
    expect(ctx.recipient_name).toBe('Aidan Gray');
  });
});

describe('buildTemplateContext — range_label', () => {
  const fixture = {
    client: makeDeltaCapitaFixtureClient(),
    contract: makeDcContractFixture(),
    issuingEntity: makeUkCompanyFixture(),
    consultant: getDavidPerson(),
    today,
  };

  it('renders a multi-day range as "<first> – <last>"', () => {
    const ctx = buildTemplateContext({
      ...fixture,
      leave: { dates: ['2026-05-04', '2026-05-05', '2026-05-08'], type: 'holiday' },
    });
    expect(ctx.leave?.range_label).toBe('04 May 2026 – 08 May 2026');
  });

  it('renders a single-day range as just the one date', () => {
    const ctx = buildTemplateContext({
      ...fixture,
      leave: { dates: ['2026-05-04'], type: 'holiday' },
    });
    expect(ctx.leave?.range_label).toBe('04 May 2026');
  });

  it('sorts the dates before rendering the range', () => {
    const ctx = buildTemplateContext({
      ...fixture,
      leave: { dates: ['2026-05-08', '2026-05-04', '2026-05-05'], type: 'sick' },
    });
    expect(ctx.leave?.dates).toEqual(['2026-05-04', '2026-05-05', '2026-05-08']);
    expect(ctx.leave?.range_label).toBe('04 May 2026 – 08 May 2026');
  });

  it('preserves the internal leave `type`', () => {
    const ctx = buildTemplateContext({
      ...fixture,
      leave: { dates: ['2026-05-04'], type: 'sick' },
    });
    expect(ctx.leave?.type).toBe('sick');
  });

  it('returns null leave block when none supplied', () => {
    const ctx = buildTemplateContext({ ...fixture, leave: null });
    expect(ctx.leave).toBeNull();
  });
});

describe('buildTemplateContext — FK consistency checks', () => {
  it('throws when the client does not match contract.client_id', () => {
    const wrongClient = makeLaFosseFixtureClient();
    expect(() =>
      buildTemplateContext({
        client: wrongClient,
        contract: makeDcContractFixture(),
        issuingEntity: makeUkCompanyFixture(),
        consultant: getDavidPerson(),
        leave: null,
        today,
      }),
    ).toThrow(TemplateContextInvalid);
  });

  it('throws when the issuing entity does not match contract.issuing_entity_id', () => {
    const uk = makeUkCompanyFixture();
    const misaligned = { ...uk, id: 'autonize-it-fzco' } as typeof uk;
    expect(() =>
      buildTemplateContext({
        client: makeDeltaCapitaFixtureClient(),
        contract: makeDcContractFixture(),
        issuingEntity: misaligned,
        consultant: getDavidPerson(),
        leave: null,
        today,
      }),
    ).toThrow(TemplateContextInvalid);
  });
});
