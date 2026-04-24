/**
 * Build the {@link TemplateContext} for a render. Derives the
 * `consultant` block from the registries (no new config file needed)
 * and pre-formats the human `range_label` so templates don't do date
 * arithmetic. Pure over its inputs — no registry global reads, no
 * filesystem.
 *
 * Consultant resolution:
 *
 *   1. `consultant.name` always comes from the `david` row in the
 *      people registry. (There's only one contracting consultant in
 *      this app; if that changes, add a `contract.consultant_id`
 *      column and plumb it through.)
 *   2. `consultant.email` defaults to the issuing entity's `email`
 *      from the company registry (so FZCO contracts sign off as the
 *      FZCO). If `client.client_assigned_email` is set and resolved,
 *      it wins — some clients provision a per-contractor inbox
 *      (`david.morrison@ext.deltacapita.com`) and expect that address
 *      on outgoing mail.
 */

import { formatIsoDateUkLong } from '../../../shared/formatting.js';
import type { Client, Contract, Company } from '../../../shared/api-contracts.js';
import type { KnownPerson } from '../people/data.js';
import type { LeaveType, TemplateContext } from './schema.js';
import { TemplateContextInvalid } from './errors.js';

export interface BuildContextInput {
  client: Client;
  contract: Contract;
  /** The issuing entity for `contract.issuing_entity_id`. */
  issuingEntity: Company;
  /** The contractor — typically `david` from the people registry. */
  consultant: KnownPerson;
  /** Empty / null when rendering a non-leave template kind. */
  leave: { dates: readonly string[]; type: LeaveType } | null;
  /** ISO date the render is rooted against. */
  today: string;
}

/**
 * Which human we greet in the salutation line. Mirrors the `to`
 * routing in {@link resolveRecipients}: direct client → primary
 * contact; agency client → end-client primary contact. Falls back to
 * the client's `trading_name` when the person name is TBC, so the
 * rendered template is always addressable even on a half-configured
 * client row.
 */
function resolveRecipientName(client: Client): string {
  if (client.kind === 'agency') {
    const name = client.end_client_primary_contact_name;
    if (name !== 'TBC' && name.length > 0) return name;
    return client.end_client_legal_name;
  }
  const name = client.primary_contact_name;
  if (name !== 'TBC' && name.length > 0) return name;
  return client.trading_name;
}

function resolveConsultantEmail(client: Client, issuingEntity: Company): string {
  const clientAssigned = client.client_assigned_email;
  if (clientAssigned !== null && clientAssigned !== 'TBC' && clientAssigned.length > 0) {
    return clientAssigned;
  }
  if (issuingEntity.email.length === 0) {
    throw new TemplateContextInvalid(
      `issuing entity "${issuingEntity.id}" has no email configured`,
      'issuingEntity.email',
    );
  }
  return issuingEntity.email;
}

/**
 * Format `['2026-05-04', '2026-05-05', '2026-05-08']` →
 * `"Mon 04 May 2026 – Fri 08 May 2026"`. Uses the existing shared
 * long-form date helper so the format stays consistent with other
 * user-facing surfaces. Single-date inputs render as just the one
 * date.
 */
function buildRangeLabel(isoDates: readonly string[]): string {
  if (isoDates.length === 0) {
    throw new TemplateContextInvalid('leave.dates cannot be empty', 'leave.dates');
  }
  const sorted = [...isoDates].sort();
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  if (first === last) return formatIsoDateUkLong(first);
  return `${formatIsoDateUkLong(first)} – ${formatIsoDateUkLong(last)}`;
}

export function buildTemplateContext(input: BuildContextInput): TemplateContext {
  const { client, contract, issuingEntity, consultant, leave, today } = input;
  if (client.id !== contract.client_id) {
    throw new TemplateContextInvalid(
      `client (${client.id}) does not match contract.client_id (${contract.client_id})`,
      'contract.client_id',
    );
  }
  if (contract.issuing_entity_id !== issuingEntity.id) {
    throw new TemplateContextInvalid(
      `issuingEntity (${issuingEntity.id}) does not match contract.issuing_entity_id (${contract.issuing_entity_id})`,
      'contract.issuing_entity_id',
    );
  }
  return {
    client,
    contract,
    consultant: {
      name: consultant.name,
      email: resolveConsultantEmail(client, issuingEntity),
    },
    recipient_name: resolveRecipientName(client),
    leave: leave === null
      ? null
      : {
          dates: [...leave.dates].sort(),
          range_label: buildRangeLabel(leave.dates),
          type: leave.type,
        },
    today,
  };
}
