/**
 * Accounts registry manifest test.
 *
 * Asserts that every index on the live accounts registry has at least
 * one documented consumer somewhere in the repo. This is the primary
 * regression lock against "capability drift" — adding an index without
 * also wiring a caller. If you add a new index to
 * `server/domain/accounts/registry.ts`, this test will fail until you
 * either (a) wire a consumer and document it below, or (b) drop the
 * unused index.
 *
 * Conventions:
 *   - Production consumers are preferred.
 *   - Test-only consumers are allowed when the index exists purely as a
 *     regression lock (e.g. "these two accounts must always be the
 *     vatApplicable set"), but the entry must name the specific test
 *     file so reviewers know the index is test-only.
 *   - `functions` names the calling function, query, or describe block.
 */

import { describe, it } from 'vitest';
import { assertManifestConsumers } from '../_shared/manifest-test.js';
import { buildAccountsRegistry } from './registry.js';

describe('accounts registry manifest', () => {
  it('every index has at least one documented consumer', () => {
    const reg = buildAccountsRegistry();
    assertManifestConsumers({
      registry: reg,
      consumers: {
        business: [
          {
            file: 'server/domain/accounts/queries.ts',
            functions: ['businessAccounts'],
          },
          {
            file: 'server/routes/statements.ts',
            functions: ['getBusinessAccounts'],
          },
          {
            file: 'server/db/utils/tax-account-filter.test.ts',
            functions: ['VAT/CT filter integration — never includes a personal account'],
          },
        ],
        personal: [
          {
            file: 'server/domain/accounts/queries.ts',
            functions: ['personalAccounts'],
          },
          {
            file: 'server/db/utils/tax-account-filter.test.ts',
            functions: ['VAT/CT filter integration — never includes a personal account'],
          },
        ],
        byEntity: [
          {
            file: 'server/domain/accounts/queries.ts',
            functions: ['accountsForEntity'],
          },
          {
            file: 'server/domain/warnings/fzco-income.ts',
            functions: ['sumFzcoTrailing12mIncomeAed'],
          },
        ],
        vatApplicable: [
          {
            file: 'server/domain/accounts/queries.ts',
            functions: ['vatApplicableAccounts'],
          },
          {
            file: 'server/db/repositories/vat-auto-seed.ts',
            functions: ['autoSeedVatObligations'],
          },
          {
            file: 'server/db/repositories/tax.ts',
            functions: ['getTaxLiabilities'],
          },
        ],
        vatApplicableByEntity: [
          {
            file: 'server/domain/accounts/queries.ts',
            functions: ['vatApplicableAccounts (entity-scoped path)'],
          },
          {
            file: 'server/domain/accounts/queries.test.ts',
            functions: [
              'vatApplicableAccounts — scopes to a single entity when entityId is supplied',
              'query purity — injection of a fixture registry is honoured',
            ],
          },
        ],
        corpTaxApplicable: [
          {
            file: 'server/domain/accounts/queries.ts',
            functions: ['corpTaxApplicableAccounts'],
          },
          {
            file: 'server/db/repositories/ct-auto-seed.ts',
            functions: ['autoSeedCtObligations'],
          },
          {
            file: 'server/db/repositories/tax.ts',
            functions: ['getTaxLiabilities'],
          },
        ],
        corpTaxApplicableByEntity: [
          {
            file: 'server/domain/accounts/queries.ts',
            functions: ['corpTaxApplicableAccounts (entity-scoped path)'],
          },
          {
            file: 'server/domain/accounts/queries.test.ts',
            functions: ['corpTaxApplicableAccounts — scopes to a single entity'],
          },
        ],
        outgoingPaymentsCapable: [
          {
            file: 'server/domain/accounts/queries.ts',
            functions: ['canMakeOutgoingPayments', 'businessAndPersonalPaymentAccounts'],
          },
          {
            file: 'server/db/repositories/sa-auto-seed.ts',
            functions: ['autoSeedSaObligations'],
          },
        ],
        businessOutgoingPayments: [
          {
            file: 'server/domain/accounts/queries.ts',
            functions: ['businessPaymentAccounts'],
          },
          {
            file: 'server/routes/tax.ts',
            functions: ['/api/vat/payments', '/api/corp-tax/payments'],
          },
          {
            file: 'server/db/repositories/ct-auto-seed.ts',
            functions: ['autoSeedCtObligations'],
          },
        ],
        personalOutgoingPayments: [
          {
            file: 'server/domain/accounts/queries.ts',
            functions: ['personalPaymentAccounts'],
          },
          {
            file: 'server/db/utils/tax-account-filter.test.ts',
            functions: ['VAT/CT filter integration — never includes a personal account'],
          },
        ],
        excludeTransfersFromIncome: [
          {
            file: 'server/domain/accounts/registry.gates.test.ts',
            functions: ['indexes.excludeTransfersFromIncome'],
          },
        ],
        showTaxLiabilities: [
          {
            file: 'server/domain/accounts/registry.gates.test.ts',
            functions: ['indexes.showTaxLiabilities'],
          },
        ],
        creditCards: [
          {
            file: 'server/domain/accounts/queries.ts',
            functions: ['isCreditCard'],
          },
          {
            file: 'server/db/repositories/transactions.ts',
            functions: [
              'detectTransfers',
              'findPotentialTaxPayments',
              'findPotentialCorpTaxPayments',
              'findPotentialSaPayments',
            ],
          },
          {
            file: 'server/parsers/index.ts',
            functions: ['getParser'],
          },
        ],
      },
    });
  });
});
