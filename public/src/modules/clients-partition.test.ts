/**
 * Lock the projection from flat registry rows onto the Clients-tab
 * two-panel shape. Edwin Group surfacing with `editTarget = 'end_client'`
 * and `viaAgency.tradingName = 'La Fosse'` is the load-bearing invariant
 * for the rest of the Clients UI.
 */

import { describe, it, expect } from 'vitest';
import type { Client } from '../../../shared/api-contracts.js';
import { partitionClientsForUi } from './clients-partition.js';

function direct(overrides: Partial<Client> = {}): Client {
  return {
    id: 'delta-capita',
    kind: 'direct',
    legal_name: 'Delta Capita Ltd',
    trading_name: 'Delta Capita',
    vat_number: 'TBC',
    billing_address: '40 Bank Street, London',
    primary_contact_name: 'Lily',
    primary_contact_email: 'lily@dc.example',
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
    updated_at: '2026-05-01',
    end_client_legal_name: null,
    end_client_address: null,
    end_client_primary_contact_name: null,
    end_client_primary_contact_email: null,
    end_client_secondary_contact_name: null,
    end_client_secondary_contact_email: null,
    ...overrides,
  } as Client;
}

function agency(overrides: Partial<Client> = {}): Client {
  return {
    id: 'la-fosse',
    kind: 'agency',
    legal_name: 'La Fosse Associates Limited',
    trading_name: 'La Fosse',
    vat_number: '360 0265 37',
    billing_address: 'Artillery Row, London',
    primary_contact_name: 'TBC',
    primary_contact_email: 'TBC',
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
    updated_at: '2026-05-01',
    end_client_legal_name: 'The Edwin Group Ltd',
    end_client_address: 'Newcastle',
    end_client_primary_contact_name: 'Diane',
    end_client_primary_contact_email: 'diane@edwin.group',
    end_client_secondary_contact_name: null,
    end_client_secondary_contact_email: null,
    ...overrides,
  } as Client;
}

describe('partitionClientsForUi', () => {
  it('returns empty panels for empty input', () => {
    expect(partitionClientsForUi([])).toEqual({ endClients: [], agencies: [] });
  });

  it('projects a direct client onto one end-client tile (editTarget=client)', () => {
    const { endClients, agencies } = partitionClientsForUi([direct()]);
    expect(agencies).toEqual([]);
    expect(endClients).toHaveLength(1);
    expect(endClients[0]).toMatchObject({
      id: 'delta-capita',
      editTarget: 'client',
      tradingName: 'Delta Capita',
      viaAgency: null,
    });
  });

  it('projects an agency client onto both an end-client tile and an agency tile', () => {
    const { endClients, agencies } = partitionClientsForUi([agency()]);

    expect(endClients).toHaveLength(1);
    expect(endClients[0]).toMatchObject({
      id: 'la-fosse',
      editTarget: 'end_client',
      legalName: 'The Edwin Group Ltd',
      tradingName: 'Edwin Group', // `The` + `Ltd` stripped
      viaAgency: { id: 'la-fosse', tradingName: 'La Fosse' },
    });

    expect(agencies).toHaveLength(1);
    expect(agencies[0]).toMatchObject({
      id: 'la-fosse',
      tradingName: 'La Fosse',
      vatNumber: '360 0265 37',
      brokersEndClients: [{ id: 'la-fosse', tradingName: 'Edwin Group' }],
    });
  });

  it('surfaces direct rows before agency-reached end clients, preserving within-group order', () => {
    const dc = direct({ id: 'delta-capita' });
    const other = direct({ id: 'other-direct', trading_name: 'Other' });
    const lf = agency({ id: 'la-fosse' });
    const { endClients } = partitionClientsForUi([dc, lf, other]);
    expect(endClients.map(t => t.id)).toEqual([
      'delta-capita',
      'other-direct',
      'la-fosse',
    ]);
  });

  it('preserves TBC on end-client contact fields so badges can render', () => {
    const { endClients } = partitionClientsForUi([
      agency({ end_client_primary_contact_email: 'TBC' }),
    ]);
    expect(endClients[0].primaryContactEmail).toBe('TBC');
  });

  it('carries inactive flag through to both panels', () => {
    const { endClients, agencies } = partitionClientsForUi([
      agency({ active: false }),
    ]);
    expect(endClients[0].active).toBe(false);
    expect(agencies[0].active).toBe(false);
  });

  it('simplifyLegalName: leaves unrecognised names alone', () => {
    const { endClients } = partitionClientsForUi([
      agency({ end_client_legal_name: 'Acme & Co' }),
    ]);
    expect(endClients[0].tradingName).toBe('Acme & Co');
  });
});
