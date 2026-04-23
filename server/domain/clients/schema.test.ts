/**
 * Zod-level invariants for Client schemas.
 *
 * The CSV parser builds full row objects then runs them through
 * `DirectClientSchema` / `AgencyClientSchema`; this file exercises the
 * Zod layer directly so schema regressions are caught without going
 * through CSV I/O.
 */

import { describe, it, expect } from 'vitest';
import {
  ClientSchema,
  DirectClientSchema,
  AgencyClientSchema,
} from './schema.js';

const directBase = {
  id: 'acme-inc',
  legal_name: 'Acme Inc',
  trading_name: 'Acme',
  kind: 'direct' as const,
  vat_number: null,
  billing_address: '1 Example St',
  primary_contact_name: 'Alice',
  primary_contact_email: 'alice@acme.com',
  secondary_contact_name: null,
  secondary_contact_email: null,
  hr_contact_name: null,
  hr_contact_email: null,
  accounts_contact_name: null,
  accounts_contact_email: null,
  cc_emails: null,
  holiday_system_url: null,
  client_assigned_email: null,
  active: true,
  updated_at: '2026-04-21',
  end_client_legal_name: null,
  end_client_address: null,
  end_client_primary_contact_name: null,
  end_client_primary_contact_email: null,
  end_client_secondary_contact_name: null,
  end_client_secondary_contact_email: null,
};

const agencyBase = {
  ...directBase,
  id: 'big-agency',
  legal_name: 'Big Agency Ltd',
  trading_name: 'Big Agency',
  kind: 'agency' as const,
  end_client_legal_name: 'Real Client Ltd',
  end_client_address: '2 Real St',
  end_client_primary_contact_name: 'Ed',
  end_client_primary_contact_email: 'ed@realclient.com',
};

describe('DirectClientSchema', () => {
  it('accepts a direct row with the end-client block nulled', () => {
    expect(DirectClientSchema.parse(directBase).kind).toBe('direct');
  });

  it('rejects a direct row with a populated end-client block', () => {
    expect(() =>
      DirectClientSchema.parse({
        ...directBase,
        end_client_legal_name: 'Should Not Be Here',
      }),
    ).toThrow();
  });

  it('preserves TBC literal in vat_number', () => {
    const parsed = DirectClientSchema.parse({ ...directBase, vat_number: 'TBC' });
    expect(parsed.vat_number).toBe('TBC');
  });
});

describe('AgencyClientSchema', () => {
  it('accepts an agency row with the end-client block populated', () => {
    const parsed = AgencyClientSchema.parse(agencyBase);
    expect(parsed.kind).toBe('agency');
    expect(parsed.end_client_legal_name).toBe('Real Client Ltd');
  });

  it('rejects an agency row missing end_client_legal_name', () => {
    const { end_client_legal_name: _unused, ...rest } = agencyBase;
    void _unused;
    expect(() => AgencyClientSchema.parse(rest)).toThrow();
  });

  it('allows TBC on end-client contact fields', () => {
    const parsed = AgencyClientSchema.parse({
      ...agencyBase,
      end_client_primary_contact_name: 'TBC',
      end_client_primary_contact_email: 'TBC',
    });
    expect(parsed.end_client_primary_contact_name).toBe('TBC');
    expect(parsed.end_client_primary_contact_email).toBe('TBC');
  });
});

describe('ClientSchema discriminated union', () => {
  it('discriminates on `kind` and narrows the type', () => {
    const direct = ClientSchema.parse(directBase);
    expect(direct.kind).toBe('direct');
    if (direct.kind === 'direct') {
      expect(direct.end_client_legal_name).toBeNull();
    }

    const agency = ClientSchema.parse(agencyBase);
    expect(agency.kind).toBe('agency');
    if (agency.kind === 'agency') {
      expect(agency.end_client_legal_name).toBe('Real Client Ltd');
    }
  });

  it('rejects an unknown kind', () => {
    expect(() => ClientSchema.parse({ ...directBase, kind: 'unknown' })).toThrow();
  });
});
