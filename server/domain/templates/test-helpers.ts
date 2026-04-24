/**
 * Shared test helpers for the templates domain. Imports parsed client
 * + contract fixtures from the respective domain test-helpers so the
 * template tests always exercise the canonical Zod-validated shape,
 * never a hand-crafted object with drift.
 */

import type {
  Client,
  Company,
  Contract,
  AgencyClient,
} from '../../../shared/api-contracts.js';
import { parseClientRow } from '../clients/csv-io.js';
import { parseContractRow } from '../contracts/csv-io.js';
import { parseCompanyRow } from '../company/csv-io.js';
import { directRow, agencyRow, rowFromHeaders as clientRowFromHeaders } from '../clients/test-helpers.js';
import { dcSowRow, lfContractRow } from '../contracts/test-helpers.js';
import { ukRow as ukCompanyRow, uaeRow as uaeCompanyRow } from '../company/test-helpers.js';
import { PEOPLE_DATA } from '../people/data.js';
import type { KnownPerson } from '../people/data.js';

/**
 * Delta Capita (direct client). Parsed from the canonical CSV row so
 * the shape always matches production data.
 */
export function makeDeltaCapitaFixtureClient(): Client {
  return parseClientRow(directRow);
}

/**
 * La Fosse (agency client) — the committed CSV row has
 * `end_client_primary_contact_email = 'TBC'`, which would fail
 * resolve-recipients. For rendering tests we patch in a concrete
 * address so the recipient matrix is exercisable.
 */
export function makeLaFosseFixtureClient(): AgencyClient {
  const patchedRow = clientRowFromHeaders({
    ...agencyRow,
    primary_contact_email: 'accounts@lafosse.com',
    end_client_primary_contact_email: 'aidan.gray@edwingroup.com',
  });
  const parsed = parseClientRow(patchedRow);
  if (parsed.kind !== 'agency') throw new Error('expected agency client fixture');
  return parsed;
}

export function makeDcContractFixture(): Contract {
  return parseContractRow(dcSowRow);
}

export function makeLfContractFixture(): Contract {
  return parseContractRow(lfContractRow);
}

export function makeUkCompanyFixture(): Company {
  return parseCompanyRow(ukCompanyRow);
}

export function makeUaeCompanyFixture(): Company {
  return parseCompanyRow(uaeCompanyRow);
}

export function getDavidPerson(): KnownPerson {
  const found = PEOPLE_DATA.find(p => p.id === 'david');
  if (!found) throw new Error('david fixture missing from PEOPLE_DATA');
  return found;
}
