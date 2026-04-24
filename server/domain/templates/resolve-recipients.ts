/**
 * Recipient resolution — pure function. Given a template `kind` and a
 * `Client` row, return the `{ to, cc }` address list the rendered
 * email should be sent to. Raises structured errors when the
 * (kind, client.kind) combination is invalid.
 *
 * Matrix (per ROADMAP.md §1.2.B):
 *
 * | kind          | direct                          | agency                               |
 * |---------------|---------------------------------|--------------------------------------|
 * | leave         | primary contact                 | end-client contact (agency silent)  |
 * | sickness      | primary contact                 | end-client contact (agency silent)  |
 * | invoice-cover | primary contact                 | end-client contact                   |
 * | renewal       | DirectClientHasNoAgencyRenewal  | agency primary contact (end silent) |
 * | timesheet     | (see below — not shipped yet)   | agency primary contact               |
 *
 * `client.cc_emails` (comma-separated) is appended verbatim to the
 * `cc` list in every case, preserving order and de-duping against the
 * already-collected entries. For every kind where the agency is
 * silent (leave / sickness / invoice-cover), the agency's own
 * `primary_contact_email` / `secondary_contact_email` / `cc_emails`
 * are excluded from both `to` and `cc` — the client is the
 * end-client; the agency is there for billing only.
 *
 * HR contacts (`hr_contact_email`) are cc'd on leave / sickness
 * notices when present — they are the HR system for the contractor,
 * not for the recipient, and they asked to be looped in.
 */

import type { Client, TemplateKind } from '../../../shared/api-contracts.js';
import { DirectClientHasNoAgencyRenewalFlow, TemplateContextInvalid } from './errors.js';

export interface ResolvedRecipients {
  to: readonly string[];
  cc: readonly string[];
}

function isResolvedEmail(value: string | null): value is string {
  return value !== null && value !== 'TBC' && value.length > 0;
}

/** Split `"a@x, b@y"` into `['a@x', 'b@y']`, tolerating whitespace + empties. */
function splitCcList(raw: string | null): readonly string[] {
  if (raw === null || raw.trim() === '') return [];
  return raw.split(',').map(s => s.trim()).filter(s => s.length > 0);
}

function dedupePreserveOrder(addresses: readonly string[]): readonly string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const addr of addresses) {
    const key = addr.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(addr);
  }
  return out;
}

export function resolveRecipients(
  kind: TemplateKind,
  client: Client,
): ResolvedRecipients {
  const ccBase = splitCcList(client.cc_emails);

  switch (kind) {
    case 'renewal': {
      if (client.kind === 'direct') {
        throw new DirectClientHasNoAgencyRenewalFlow(client.id);
      }
      if (!isResolvedEmail(client.primary_contact_email)) {
        throw new TemplateContextInvalid(
          `agency primary_contact_email unresolved for client "${client.id}"`,
          'client.primary_contact_email',
        );
      }
      return {
        to: [client.primary_contact_email],
        cc: dedupePreserveOrder(ccBase),
      };
    }

    case 'timesheet': {
      // Only meaningful for agency-kind clients; symmetric to renewal.
      if (client.kind === 'direct') {
        throw new TemplateContextInvalid(
          `timesheet template is not applicable to direct client "${client.id}"`,
          'client.kind',
        );
      }
      if (!isResolvedEmail(client.primary_contact_email)) {
        throw new TemplateContextInvalid(
          `agency primary_contact_email unresolved for client "${client.id}"`,
          'client.primary_contact_email',
        );
      }
      return {
        to: [client.primary_contact_email],
        cc: dedupePreserveOrder(ccBase),
      };
    }

    case 'leave':
    case 'sickness':
    case 'invoice-cover': {
      if (client.kind === 'direct') {
        if (!isResolvedEmail(client.primary_contact_email)) {
          throw new TemplateContextInvalid(
            `primary_contact_email unresolved for direct client "${client.id}"`,
            'client.primary_contact_email',
          );
        }
        // Direct clients get a fuller cc list: the secondary contact
        // is always copied, plus HR (leave / sickness) or accounts
        // (invoice-cover), plus the free-form `cc_emails` catch-all.
        const extra: string[] = [];
        if (isResolvedEmail(client.secondary_contact_email)) {
          extra.push(client.secondary_contact_email);
        }
        if (kind === 'leave' || kind === 'sickness') {
          if (isResolvedEmail(client.hr_contact_email)) extra.push(client.hr_contact_email);
        } else if (isResolvedEmail(client.accounts_contact_email)) {
          extra.push(client.accounts_contact_email);
        }
        return {
          to: [client.primary_contact_email],
          cc: dedupePreserveOrder([...extra, ...ccBase]),
        };
      }
      // Agency client — route through the end-client's primary
      // contact. Optionally copy the end-client's secondary contact
      // if one is configured. Deliberately DO NOT copy the agency
      // itself on these kinds (the agency only sees timesheets +
      // renewals), so `cc_emails` (which documents the agency's own
      // copy list) is excluded too.
      if (!isResolvedEmail(client.end_client_primary_contact_email)) {
        throw new TemplateContextInvalid(
          `end_client_primary_contact_email unresolved for agency client "${client.id}"`,
          'client.end_client_primary_contact_email',
        );
      }
      const agencyCc: string[] = [];
      if (isResolvedEmail(client.end_client_secondary_contact_email)) {
        agencyCc.push(client.end_client_secondary_contact_email);
      }
      return {
        to: [client.end_client_primary_contact_email],
        cc: dedupePreserveOrder(agencyCc),
      };
    }
  }
}
