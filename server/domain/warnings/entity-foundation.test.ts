import { describe, it, expect } from 'vitest';
import {
  deriveEntityFoundationWarnings,
  type EntityFoundationWarningInput,
} from './entity-foundation.js';
import type {
  Client,
  Company,
  Contract,
  DirectClient,
  AgencyClient,
  EntityFoundationWarningCode,
  UkCompany,
  UaeCompany,
} from '../../../shared/api-contracts.js';

/**
 * Each warning branch is locked here. If you add or delete a branch,
 * update both the code enum in `shared/api-contracts.ts` *and* the
 * matching test below — the two are kept in deliberate lockstep so a
 * silent warning drop is impossible.
 */

function cleanUk(): UkCompany {
  return {
    id: 'autonize-it-ltd',
    legal_name: 'Autonize IT Limited',
    trading_name: 'Autonize IT Ltd',
    kind: 'ltd',
    jurisdiction: 'UK',
    regulator: 'Companies House',
    company_number: '08842112',
    vat_number: '292 1465 96',
    license_number: null,
    registration_number: null,
    formation_date: '2014-01-01',
    address: '53 Heath Park Road, Romford, RM2 5UL',
    currency: 'GBP',
    bank_sort_code: '20-25-19',
    bank_account_number: '63648923',
    iban: null,
    swift_bic: null,
    email: 'dmorrison@autonize-it.com',
    logo_path: 'autonize-it/logo.svg',
    accountant_name: 'Some Accountant',
    accountant_email: 'accountant@example.com',
    ct_registered: true,
    qfzp_elected: null,
    vat_registered: true,
    active: true,
    updated_at: '2026-04-22',
  };
}

function cleanFzco(): UaeCompany {
  return {
    id: 'autonize-it-fzco',
    legal_name: 'Autonize IT Software Development – FZCO',
    trading_name: 'Autonize IT FZCO',
    kind: 'fzco',
    jurisdiction: 'UAE',
    regulator: 'IFZA (International Free Zone Authority)',
    company_number: null,
    vat_number: null,
    license_number: '73348',
    registration_number: '71347',
    formation_date: '2025-11-04',
    address: 'DSO-IFZA, IFZA Properties, Dubai Silicon Oasis, Dubai, UAE',
    currency: 'AED',
    bank_sort_code: null,
    bank_account_number: null,
    iban: 'AE070260001013540070001',
    swift_bic: 'EBILAEAD',
    email: 'dmorrison@autonize-it.com',
    logo_path: 'autonize-it/logo.svg',
    accountant_name: 'Some Accountant',
    accountant_email: 'accountant@example.com',
    ct_registered: true,
    qfzp_elected: false,
    vat_registered: false,
    active: true,
    updated_at: '2026-04-22',
  };
}

function cleanDirectClient(): DirectClient {
  return {
    id: 'acme',
    legal_name: 'Acme Ltd',
    trading_name: 'Acme',
    kind: 'direct',
    vat_number: 'GB123456789',
    billing_address: '1 Acme Way, London',
    primary_contact_name: 'Jane Doe',
    primary_contact_email: 'jane@acme.test',
    secondary_contact_name: null,
    secondary_contact_email: null,
    hr_contact_name: null,
    hr_contact_email: null,
    accounts_contact_name: null,
    accounts_contact_email: null,
    cc_emails: null,
    end_client_legal_name: null,
    end_client_address: null,
    end_client_primary_contact_name: null,
    end_client_primary_contact_email: null,
    end_client_secondary_contact_name: null,
    end_client_secondary_contact_email: null,
    holiday_system_url: null,
    client_assigned_email: null,
    active: true,
    updated_at: '2026-04-24',
  };
}

function cleanAgencyClient(): AgencyClient {
  return {
    id: 'an-agency',
    legal_name: 'An Agency Ltd',
    trading_name: 'An Agency',
    kind: 'agency',
    vat_number: 'GB987654321',
    billing_address: '2 Agency Road, London',
    primary_contact_name: 'John Smith',
    primary_contact_email: 'john@agency.test',
    secondary_contact_name: null,
    secondary_contact_email: null,
    hr_contact_name: null,
    hr_contact_email: null,
    accounts_contact_name: null,
    accounts_contact_email: null,
    cc_emails: null,
    end_client_legal_name: 'End Client Ltd',
    end_client_address: '3 End Client Street, London',
    end_client_primary_contact_name: 'Alice End',
    end_client_primary_contact_email: 'alice@endclient.test',
    end_client_secondary_contact_name: null,
    end_client_secondary_contact_email: null,
    holiday_system_url: null,
    client_assigned_email: null,
    active: true,
    updated_at: '2026-04-24',
  };
}

function input(overrides: Partial<EntityFoundationWarningInput> = {}): EntityFoundationWarningInput {
  return {
    companies: [cleanUk(), cleanFzco()],
    clients: [] as Client[],
    contracts: [] as Contract[],
    fzcoTrailing12mIncomeAed: 0,
    interCompanyMovementCount: 0,
    today: new Date('2026-03-15T00:00:00Z'),
    ...overrides,
  };
}

function codes(input: ReturnType<typeof deriveEntityFoundationWarnings>): EntityFoundationWarningCode[] {
  return input.map(w => w.code);
}

describe('deriveEntityFoundationWarnings', () => {
  it('emits zero warnings when all fields are resolved and income is below thresholds', () => {
    const warnings = deriveEntityFoundationWarnings(input());
    expect(warnings).toHaveLength(0);
  });

  describe('company-tbc-fields', () => {
    it('emits one warning per entity with TBC fields, listing each field', () => {
      const uk = cleanUk();
      uk.formation_date = 'TBC';
      uk.accountant_name = 'TBC';
      const fzco = cleanFzco();
      fzco.iban = 'TBC';
      fzco.qfzp_elected = 'TBC';
      fzco.ct_registered = true;

      const warnings = deriveEntityFoundationWarnings(input({ companies: [uk, fzco] }));

      const ukWarning = warnings.find(w => w.id === 'entity-foundation.company-tbc-fields.autonize-it-ltd');
      const fzcoWarning = warnings.find(w => w.id === 'entity-foundation.company-tbc-fields.autonize-it-fzco');
      expect(ukWarning).toBeDefined();
      expect(fzcoWarning).toBeDefined();
      expect(ukWarning?.detail).toContain('formation_date');
      expect(ukWarning?.detail).toContain('accountant_name');
      expect(fzcoWarning?.detail).toContain('iban');
      expect(fzcoWarning?.detail).toContain('qfzp_elected');
    });

    it('does not emit for entities with no TBC fields', () => {
      const warnings = deriveEntityFoundationWarnings(input());
      expect(codes(warnings)).not.toContain('company-tbc-fields');
    });
  });

  describe('fzco-ct-status-unknown', () => {
    it('emits when ct_registered is TBC', () => {
      const fzco = cleanFzco();
      fzco.ct_registered = 'TBC';
      const warnings = deriveEntityFoundationWarnings(input({ companies: [cleanUk(), fzco] }));
      expect(codes(warnings)).toContain('fzco-ct-status-unknown');
    });

    it('emits when qfzp_elected is TBC', () => {
      const fzco = cleanFzco();
      fzco.qfzp_elected = 'TBC';
      const warnings = deriveEntityFoundationWarnings(input({ companies: [cleanUk(), fzco] }));
      expect(codes(warnings)).toContain('fzco-ct-status-unknown');
    });

    it('does not emit when both are concrete booleans', () => {
      const warnings = deriveEntityFoundationWarnings(input());
      expect(codes(warnings)).not.toContain('fzco-ct-status-unknown');
    });
  });

  describe('UAE VAT thresholds', () => {
    it('emits voluntary warning at AED 187,500', () => {
      const warnings = deriveEntityFoundationWarnings(input({ fzcoTrailing12mIncomeAed: 187_500 }));
      expect(codes(warnings)).toContain('fzco-vat-voluntary-threshold-crossed');
      expect(codes(warnings)).not.toContain('fzco-vat-mandatory-threshold-crossed');
    });

    it('emits voluntary warning at AED 374,999 (just under mandatory)', () => {
      const warnings = deriveEntityFoundationWarnings(input({ fzcoTrailing12mIncomeAed: 374_999 }));
      expect(codes(warnings)).toContain('fzco-vat-voluntary-threshold-crossed');
      expect(codes(warnings)).not.toContain('fzco-vat-mandatory-threshold-crossed');
    });

    it('emits mandatory warning at exactly AED 375,000 and suppresses voluntary', () => {
      const warnings = deriveEntityFoundationWarnings(input({ fzcoTrailing12mIncomeAed: 375_000 }));
      expect(codes(warnings)).toContain('fzco-vat-mandatory-threshold-crossed');
      expect(codes(warnings)).not.toContain('fzco-vat-voluntary-threshold-crossed');
      const mandatory = warnings.find(w => w.code === 'fzco-vat-mandatory-threshold-crossed');
      expect(mandatory?.severity).toBe('critical');
    });

    it('emits neither below AED 187,500', () => {
      const warnings = deriveEntityFoundationWarnings(input({ fzcoTrailing12mIncomeAed: 187_499 }));
      expect(codes(warnings)).not.toContain('fzco-vat-voluntary-threshold-crossed');
      expect(codes(warnings)).not.toContain('fzco-vat-mandatory-threshold-crossed');
    });
  });

  describe('ifza-license-renewal-due', () => {
    it('emits warn when renewal is within 60 days (formation anniversary window)', () => {
      // formation_date = 2025-11-04. On 2026-09-10 the next
      // anniversary (2026-11-04) is 55 days away — inside the window.
      const warnings = deriveEntityFoundationWarnings(input({
        today: new Date('2026-09-10T00:00:00Z'),
      }));
      const renewal = warnings.find(w => w.code === 'ifza-license-renewal-due');
      expect(renewal).toBeDefined();
      expect(renewal?.severity).toBe('warn');
      expect(renewal?.detail).toContain('2026-11-04');
    });

    it('escalates to critical when renewal is within 14 days', () => {
      const warnings = deriveEntityFoundationWarnings(input({
        today: new Date('2026-10-25T00:00:00Z'),
      }));
      const renewal = warnings.find(w => w.code === 'ifza-license-renewal-due');
      expect(renewal?.severity).toBe('critical');
    });

    it('emits critical + "expired" detail when the anniversary is in the past window', () => {
      // Today is 2026-11-05: the 2026-11-04 anniversary passed 1 day
      // ago. Next anniversary is 2027-11-04, far outside the window,
      // so no warning. This verifies the positive-days behaviour.
      const quiet = deriveEntityFoundationWarnings(input({
        today: new Date('2026-11-05T00:00:00Z'),
      }));
      expect(codes(quiet)).not.toContain('ifza-license-renewal-due');
    });

    it('does not emit when the anniversary is more than 60 days away', () => {
      const warnings = deriveEntityFoundationWarnings(input({
        today: new Date('2026-03-15T00:00:00Z'),
      }));
      expect(codes(warnings)).not.toContain('ifza-license-renewal-due');
    });

    it('does not emit when formation_date is TBC (no data, no false alarm)', () => {
      const fzco = cleanFzco();
      fzco.formation_date = 'TBC';
      const warnings = deriveEntityFoundationWarnings(input({
        companies: [cleanUk(), fzco],
        today: new Date('2026-09-10T00:00:00Z'),
      }));
      expect(codes(warnings)).not.toContain('ifza-license-renewal-due');
    });
  });

  describe('client-tbc-fields', () => {
    it('emits a warning per agency client with a TBC end-client primary email', () => {
      const agency = cleanAgencyClient();
      agency.end_client_primary_contact_email = 'TBC';
      const warnings = deriveEntityFoundationWarnings(input({ clients: [agency] }));
      const hit = warnings.find(w => w.id === 'entity-foundation.client-tbc-fields.an-agency');
      expect(hit).toBeDefined();
      expect(hit?.code).toBe('client-tbc-fields');
      expect(hit?.detail).toContain('end_client_primary_contact_email');
      expect(hit?.sources).toContain('clients/clients.csv');
    });

    it('emits a warning for a direct client with a TBC primary email', () => {
      const direct = cleanDirectClient();
      direct.primary_contact_email = 'TBC';
      const warnings = deriveEntityFoundationWarnings(input({ clients: [direct] }));
      const hit = warnings.find(w => w.code === 'client-tbc-fields');
      expect(hit).toBeDefined();
      expect(hit?.detail).toContain('primary_contact_email');
    });

    it('does not emit when all contact fields are filled in', () => {
      const agency = cleanAgencyClient();
      const direct = cleanDirectClient();
      const warnings = deriveEntityFoundationWarnings(input({ clients: [agency, direct] }));
      expect(codes(warnings)).not.toContain('client-tbc-fields');
    });

    it('lists multiple TBC fields for the same client in a single warning', () => {
      const agency = cleanAgencyClient();
      agency.primary_contact_name = 'TBC';
      agency.primary_contact_email = 'TBC';
      agency.end_client_primary_contact_name = 'TBC';
      agency.end_client_primary_contact_email = 'TBC';
      const warnings = deriveEntityFoundationWarnings(input({ clients: [agency] }));
      const hits = warnings.filter(w => w.code === 'client-tbc-fields');
      expect(hits).toHaveLength(1);
      expect(hits[0].detail).toContain('primary_contact_name');
      expect(hits[0].detail).toContain('primary_contact_email');
      expect(hits[0].detail).toContain('end_client_primary_contact_name');
      expect(hits[0].detail).toContain('end_client_primary_contact_email');
    });
  });

  describe('inter-company-movement-unclassified', () => {
    it('emits a single aggregated warning when count > 0', () => {
      const warnings = deriveEntityFoundationWarnings(input({ interCompanyMovementCount: 3 }));
      const cross = warnings.filter(w => w.code === 'inter-company-movement-unclassified');
      expect(cross).toHaveLength(1);
      expect(cross[0].title).toContain('3');
    });

    it('pluralises correctly for a single movement', () => {
      const warnings = deriveEntityFoundationWarnings(input({ interCompanyMovementCount: 1 }));
      const cross = warnings.find(w => w.code === 'inter-company-movement-unclassified');
      expect(cross?.title).toContain('1 inter-company money movement require');
    });

    it('does not emit when count is 0', () => {
      const warnings = deriveEntityFoundationWarnings(input({ interCompanyMovementCount: 0 }));
      expect(codes(warnings)).not.toContain('inter-company-movement-unclassified');
    });
  });

  describe('contract-ending-soon', () => {
    const today = new Date('2026-04-24T00:00:00Z');

    function buildContract(overrides: Partial<Contract> & { id: string }): Contract {
      const base: Contract = {
        id: overrides.id,
        client_id: 'la-fosse',
        issuing_entity_id: 'autonize-it-ltd',
        master_id: null,
        reference: 'La Fosse · 06 Jan 2026–31 Mar 2026',
        placement_ref: 'LAF-TEG-001',
        start_date: '2026-01-01',
        end_date: '2026-04-30',
        works_monday: true,
        works_tuesday: true,
        works_wednesday: true,
        works_thursday: true,
        works_friday: true,
        works_saturday: false,
        works_sunday: false,
        day_rate: 500,
        day_rate_currency: 'GBP',
        invoice_currency: 'GBP',
        invoice_cadence: 'weekly',
        invoice_mechanism: 'self-bill',
        payment_terms_days: 14,
        company_notice_weeks: 1,
        supplier_notice_weeks: 1,
        renewal_warning_days: 30,
        job_title: 'Engineer',
        job_description: null,
        work_location: 'Remote',
        conduct_regs: 'opted-out',
        engagement_tax_status: 'outside-ir35',
        jurisdiction: 'England',
        signed_at: '2025-12-20',
        docusign_envelope: null,
        active: true,
        updated_at: '2026-04-24',
      };
      return { ...base, ...overrides };
    }

    it('silent outside the renewal_warning_days window', () => {
      const contract = buildContract({
        id: 'far-future',
        end_date: '2026-07-24', // 91 days away
        renewal_warning_days: 30,
      });
      const warnings = deriveEntityFoundationWarnings(
        input({ contracts: [contract], today }),
      );
      expect(codes(warnings)).not.toContain('contract-ending-soon');
    });

    it('emits warn severity when within window but more than 14 days away', () => {
      const contract = buildContract({
        id: 'warn-band',
        end_date: '2026-05-19', // 25 days away
        renewal_warning_days: 30,
      });
      const warnings = deriveEntityFoundationWarnings(
        input({ contracts: [contract], today }),
      );
      const ending = warnings.filter(w => w.code === 'contract-ending-soon');
      expect(ending).toHaveLength(1);
      expect(ending[0].severity).toBe('warn');
      expect(ending[0].detail).toContain('25 day');
    });

    it('emits critical severity when 14 days or fewer remain', () => {
      const contract = buildContract({
        id: 'critical-band',
        end_date: '2026-05-04', // 10 days away
        renewal_warning_days: 30,
      });
      const warnings = deriveEntityFoundationWarnings(
        input({ contracts: [contract], today }),
      );
      const ending = warnings.filter(w => w.code === 'contract-ending-soon');
      expect(ending).toHaveLength(1);
      expect(ending[0].severity).toBe('critical');
      expect(ending[0].detail).toContain('10 day');
    });

    it('emits critical severity for overdue (active + end_date in the past)', () => {
      const contract = buildContract({
        id: 'overdue',
        end_date: '2026-04-21', // 3 days ago
        renewal_warning_days: 30,
      });
      const warnings = deriveEntityFoundationWarnings(
        input({ contracts: [contract], today }),
      );
      const ending = warnings.filter(w => w.code === 'contract-ending-soon');
      expect(ending).toHaveLength(1);
      expect(ending[0].severity).toBe('critical');
      expect(ending[0].detail).toContain('ended 3 days ago');
    });

    it('skips inactive contracts even when they would otherwise fire', () => {
      const contract = buildContract({
        id: 'inactive',
        end_date: '2026-04-25', // tomorrow, would be critical
        renewal_warning_days: 30,
        active: false,
      });
      const warnings = deriveEntityFoundationWarnings(
        input({ contracts: [contract], today }),
      );
      expect(codes(warnings)).not.toContain('contract-ending-soon');
    });

    it('skips open-ended contracts (end_date === null)', () => {
      const contract = buildContract({
        id: 'open-ended',
        end_date: null,
        renewal_warning_days: 30,
      });
      const warnings = deriveEntityFoundationWarnings(
        input({ contracts: [contract], today }),
      );
      expect(codes(warnings)).not.toContain('contract-ending-soon');
    });

    it('attributes warnings to the issuing entity via sources', () => {
      const uk = buildContract({
        id: 'uk-ltd-row',
        issuing_entity_id: 'autonize-it-ltd',
        end_date: '2026-05-04',
        renewal_warning_days: 30,
      });
      const fzco = buildContract({
        id: 'fzco-row',
        issuing_entity_id: 'autonize-it-fzco',
        end_date: '2026-05-04',
        renewal_warning_days: 30,
        conduct_regs: null,
        engagement_tax_status: null,
      });
      const warnings = deriveEntityFoundationWarnings(
        input({ contracts: [uk, fzco], today }),
      );
      const byContractSource = (contractId: string) =>
        warnings.find(w =>
          w.code === 'contract-ending-soon' && w.sources.includes(`contract:${contractId}`),
        );
      expect(byContractSource('uk-ltd-row')?.sources).toContain('entity:autonize-it-ltd');
      expect(byContractSource('fzco-row')?.sources).toContain('entity:autonize-it-fzco');
    });

    it('moves between bands as today advances (today-injection)', () => {
      const contract = buildContract({
        id: 'drifting',
        end_date: '2026-05-04',
        renewal_warning_days: 30,
      });
      // 20 days out → warn
      const far = deriveEntityFoundationWarnings(
        input({ contracts: [contract], today: new Date('2026-04-14T00:00:00Z') }),
      );
      expect(far.find(w => w.code === 'contract-ending-soon')?.severity).toBe('warn');
      // 10 days out → critical
      const near = deriveEntityFoundationWarnings(
        input({ contracts: [contract], today: new Date('2026-04-24T00:00:00Z') }),
      );
      expect(near.find(w => w.code === 'contract-ending-soon')?.severity).toBe('critical');
    });
  });

  describe('composition', () => {
    it('every warning has a unique id', () => {
      const uk = cleanUk();
      uk.accountant_name = 'TBC';
      const fzco = cleanFzco();
      fzco.iban = 'TBC';
      fzco.ct_registered = 'TBC';

      const warnings = deriveEntityFoundationWarnings(input({
        companies: [uk, fzco],
        fzcoTrailing12mIncomeAed: 400_000,
        interCompanyMovementCount: 2,
        today: new Date('2026-09-10T00:00:00Z'),
      }));

      const ids = warnings.map(w => w.id);
      const unique = new Set(ids);
      expect(unique.size).toBe(ids.length);
    });

    it('every warning has a non-empty detail, title, recommended_action, and at least one source', () => {
      const uk = cleanUk();
      uk.formation_date = 'TBC';
      const fzco = cleanFzco();
      fzco.ct_registered = 'TBC';

      const warnings = deriveEntityFoundationWarnings(input({
        companies: [uk, fzco],
        fzcoTrailing12mIncomeAed: 400_000,
        interCompanyMovementCount: 1,
        today: new Date('2026-09-10T00:00:00Z'),
      }));

      expect(warnings.length).toBeGreaterThan(0);
      for (const w of warnings) {
        expect(w.title.length).toBeGreaterThan(0);
        expect(w.detail.length).toBeGreaterThan(0);
        expect(w.recommended_action.length).toBeGreaterThan(0);
        expect(w.sources.length).toBeGreaterThan(0);
      }
    });
  });

  it('gracefully handles an empty companies array (no FZCO ⇒ no FZCO-specific warnings)', () => {
    const warnings = deriveEntityFoundationWarnings({
      companies: [] as Company[],
      clients: [] as Client[],
      contracts: [] as Contract[],
      fzcoTrailing12mIncomeAed: 1_000_000,
      interCompanyMovementCount: 5,
      today: new Date('2026-03-15T00:00:00Z'),
    });
    // Only the inter-company aggregate survives.
    expect(codes(warnings)).toEqual(['inter-company-movement-unclassified']);
  });
});
