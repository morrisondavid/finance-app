/**
 * Pure projection from `clients.csv` rows onto the Clients-tab UI's
 * two-panel layout.
 *
 * Why a projection rather than a schema change: the user's mental model
 * surfaces **end clients** as the primary relationship (Delta Capita
 * pays me, Edwin Group pays La Fosse who pays me — but Edwin is who I
 * actually work with). The underlying registry still models things
 * correctly as direct/agency — we just invert how the UI presents them.
 *
 * Outputs:
 *   - {@link EndClientTile} per end client. Direct rows produce one
 *     tile with `editTarget: 'client'`. Agency rows produce one tile
 *     with `editTarget: 'end_client'` plus a `viaAgency` back-reference
 *     so the tile can render a "via La Fosse" badge.
 *   - {@link AgencyTile} per agency row. This is purely the agency-
 *     level surface (contacts, VAT), with a `brokersEndClients` list so
 *     the agency row can show which relationships it brokers.
 *
 * Pure — no DOM, no fetch, no registry access — so `clients-
 * partition.test.ts` can drive every branch from fixtures.
 */

import type { Client, ClientId } from '../../../shared/api-contracts.js';

export type TbcString = string | 'TBC';

/**
 * One row in the Clients tab's "End clients" panel. Maps back to one
 * row in `clients.csv` via `id` + `editTarget`.
 */
export interface EndClientTile {
  readonly id: ClientId;
  readonly editTarget: 'client' | 'end_client';
  readonly legalName: string;
  readonly tradingName: string;
  readonly address: string | null;
  readonly primaryContactName: TbcString | null;
  readonly primaryContactEmail: TbcString | null;
  readonly secondaryContactName: TbcString | null;
  readonly secondaryContactEmail: TbcString | null;
  readonly viaAgency: { readonly id: ClientId; readonly tradingName: string } | null;
  readonly active: boolean;
}

/**
 * One row in the Clients tab's "Agencies" panel. Only agency-kind
 * registry rows land here.
 */
export interface AgencyTile {
  readonly id: ClientId;
  readonly legalName: string;
  readonly tradingName: string;
  readonly address: string;
  readonly vatNumber: TbcString | null;
  readonly primaryContactName: TbcString;
  readonly primaryContactEmail: TbcString;
  readonly secondaryContactName: TbcString | null;
  readonly secondaryContactEmail: TbcString | null;
  readonly brokersEndClients: readonly { readonly id: ClientId; readonly tradingName: string }[];
  readonly active: boolean;
}

export interface ClientsPartition {
  readonly endClients: readonly EndClientTile[];
  readonly agencies: readonly AgencyTile[];
}

/**
 * Project the flat client list into the Clients-tab's two-panel shape.
 * Direct rows surface once (as end clients). Agency rows surface twice:
 * once as an end-client tile (the end client's details) and once as an
 * agency tile (the broker itself).
 *
 * Ordering: end clients in registry order, with direct rows surfacing
 * before the end-clients reached via agencies. Agencies follow registry
 * order. No secondary sort — registry order IS the ordering, both for
 * predictability and so reordering `clients.csv` reorders the UI.
 */
export function partitionClientsForUi(
  clients: readonly Client[],
): ClientsPartition {
  const directTiles: EndClientTile[] = [];
  const agencyTiles: EndClientTile[] = [];
  const agencies: AgencyTile[] = [];

  for (const client of clients) {
    if (client.kind === 'direct') {
      directTiles.push({
        id: client.id,
        editTarget: 'client',
        legalName: client.legal_name,
        tradingName: client.trading_name,
        address: client.billing_address,
        primaryContactName: client.primary_contact_name,
        primaryContactEmail: client.primary_contact_email,
        secondaryContactName: client.secondary_contact_name,
        secondaryContactEmail: client.secondary_contact_email,
        viaAgency: null,
        active: client.active,
      });
      continue;
    }

    // agency — emit both views.
    // Derive an end-client trading name from the legal name by stripping
    // common company-suffix noise ("Ltd", "Limited") so the UI can show
    // "Edwin Group" rather than "The Edwin Group Ltd".
    const endClientTradingName = simplifyLegalName(client.end_client_legal_name);
    agencyTiles.push({
      id: client.id,
      editTarget: 'end_client',
      legalName: client.end_client_legal_name,
      tradingName: endClientTradingName,
      address: client.end_client_address,
      primaryContactName: client.end_client_primary_contact_name,
      primaryContactEmail: client.end_client_primary_contact_email,
      secondaryContactName: client.end_client_secondary_contact_name,
      secondaryContactEmail: client.end_client_secondary_contact_email,
      viaAgency: { id: client.id, tradingName: client.trading_name },
      active: client.active,
    });

    agencies.push({
      id: client.id,
      legalName: client.legal_name,
      tradingName: client.trading_name,
      address: client.billing_address,
      vatNumber: client.vat_number,
      primaryContactName: client.primary_contact_name,
      primaryContactEmail: client.primary_contact_email,
      secondaryContactName: client.secondary_contact_name,
      secondaryContactEmail: client.secondary_contact_email,
      brokersEndClients: [
        { id: client.id, tradingName: endClientTradingName },
      ],
      active: client.active,
    });
  }

  return {
    endClients: [...directTiles, ...agencyTiles],
    agencies,
  };
}

/**
 * Best-effort "friendly" name from a legal name — strips a trailing
 * "Ltd" / "Limited" / "Plc" and a leading "The " so badges render more
 * cleanly. Leaves anything it doesn't recognise unchanged.
 */
function simplifyLegalName(legal: string): string {
  let out = legal.trim();
  const leadingThe = /^the\s+/i;
  if (leadingThe.test(out)) out = out.replace(leadingThe, '');
  const trailingSuffix = /\s+(ltd|limited|plc|llp|inc|incorporated|corp|corporation)\.?$/i;
  out = out.replace(trailingSuffix, '');
  return out.trim();
}
