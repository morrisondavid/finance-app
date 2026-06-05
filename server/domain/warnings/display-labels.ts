/**
 * Human-readable labels for warning titles and detail prose.
 * Entity ids stay kebab-case in `sources` / `entityId`; only display copy uses these.
 */

import type { EntityId, ObligationType } from '../../../shared/api-contracts.js';

const ENTITY_DISPLAY_LABELS: Record<EntityId, string> = {
  'autonize-it-ltd': 'Autonize IT Ltd',
  'autonize-it-fzco': 'Autonize IT FZCO',
};

export function entityDisplayLabel(entityId: EntityId): string {
  return ENTITY_DISPLAY_LABELS[entityId];
}

const TAX_OBLIGATION_DISPLAY_LABELS: Partial<Record<ObligationType, string>> = {
  vat: 'VAT',
  'corporation-tax': 'Corporation Tax',
  'self-assessment': 'Self Assessment',
  'hmrc-ttp': 'HMRC TTP',
};

export function taxObligationTypeDisplayLabel(type: ObligationType): string {
  return TAX_OBLIGATION_DISPLAY_LABELS[type] ?? type;
}
