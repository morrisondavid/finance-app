import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { parseClientRow } from '../clients/csv-io.js';
import { agencyRow } from '../clients/test-helpers.js';
import { applyInvoiceStatusAfterPayments } from './auto-reconcile.js';
import { recordInvoicePayments } from './mutations.js';
import { planReconciliation } from './reconcile-payments.js';
import {
  __resetInvoiceRegistryForTests,
  buildInvoiceRegistry,
  getInvoiceRegistry,
} from './registry.js';
import {
  __resetInvoicePaymentRegistryForTests,
  buildInvoicePaymentRegistry,
} from './payments-registry.js';
import {
  getInvoicesCsvPath,
  getInvoicePaymentsCsvPath,
  readInvoicePaymentsCsvFile,
  readInvoicesCsvFile,
  writeInvoicesCsvFile,
  parseInvoiceRow,
} from './csv-io.js';
import { rowFromHeaders } from './test-helpers.js';
import type { ClientId } from '../../../shared/api-contracts.js';

let tmpDir: string;
const TODAY = '2026-06-02';

function laFosseEgInvoice(
  id: string,
  paymentReference: string,
  total: string,
  periodStart: string,
) {
  const totalNum = Number(total);
  const subtotal = totalNum / 1.2;
  const vat = totalNum - subtotal;
  return parseInvoiceRow(
    rowFromHeaders({
      id,
      contract_id: 'lf-bh28240',
      client_id: 'la-fosse',
      issuing_entity_id: 'autonize-it-ltd',
      invoice_number: id,
      payment_reference: paymentReference,
      invoice_date: '2025-11-26',
      period_start: periodStart,
      period_end: periodStart,
      days_billed: '3',
      description: 'David Morrison - Consultant Services, Full Stack Engineer',
      currency: 'GBP',
      subtotal: String(subtotal),
      vat_rate: '0.2',
      vat_amount: String(vat),
      total,
      mechanism: 'self-bill',
      status: 'issued',
      due_date: '2025-12-26',
      created_at: '2025-11-26',
      updated_at: '2025-11-26',
    }),
  );
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'auto-reconcile-'));
  const invoices = [
    laFosseEgInvoice('EG-0038', 'SB-280052', '1800', '2025-11-10'),
    laFosseEgInvoice('EG-0039', 'SB-280053', '3000', '2025-11-03'),
    laFosseEgInvoice('EG-0040', 'SB-280054', '3000', '2025-11-17'),
  ];
  writeInvoicesCsvFile(getInvoicesCsvPath(tmpDir), invoices);
  __resetInvoiceRegistryForTests(buildInvoiceRegistry(tmpDir));
  __resetInvoicePaymentRegistryForTests(buildInvoicePaymentRegistry(tmpDir));
});

afterEach(() => {
  __resetInvoiceRegistryForTests();
  __resetInvoicePaymentRegistryForTests();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('applyInvoiceStatusAfterPayments', () => {
  it('flips issued invoices to paid when residual clears', () => {
    const payment = {
      id: 'ip-EG-0038-tx-1',
      invoice_id: 'EG-0038',
      bank_transaction_id: 'tx-1',
      payment_date: '2025-12-24',
      amount_paid: 1800,
      deposit_currency: 'GBP' as const,
      fx_rate_at_payment: null,
      amount_in_invoice_currency: 1800,
      fx_gain_loss: 0,
      residual: 0,
      created_at: TODAY,
      updated_at: null,
    };

    const updates = applyInvoiceStatusAfterPayments([payment], tmpDir);
    expect(updates).toEqual([{ invoiceId: 'EG-0038', status: 'paid' }]);

    __resetInvoiceRegistryForTests(buildInvoiceRegistry(tmpDir));
    expect(getInvoiceRegistry().indexes.byId.get('EG-0038')?.status).toBe('paid');
  });
});

describe('reference-exact batch persist', () => {
  it('records three payment rows for one bank transaction and flips statuses', () => {
    const clientsById = new Map<ClientId, ReturnType<typeof parseClientRow>>([
      [parseClientRow(agencyRow).id, parseClientRow(agencyRow)],
    ]);
    const invoices = [
      laFosseEgInvoice('EG-0038', 'SB-280052', '1800', '2025-11-10'),
      laFosseEgInvoice('EG-0039', 'SB-280053', '3000', '2025-11-03'),
      laFosseEgInvoice('EG-0040', 'SB-280054', '3000', '2025-11-17'),
    ];

    const plan = planReconciliation({
      invoices,
      transactions: [{
        id: '211',
        date: '2025-12-24',
        amount: 7800,
        currency: 'GBP',
        account: 'barclays-current',
        description: 'LA FOSSE LTD SB-280052 SB-280053 SB-280054 BG',
        entityId: 'autonize-it-ltd',
      }],
      clientsById,
      existingPayments: [],
      options: { now: TODAY, amountTolerance: 0.02, maxProximityDays: 120 },
    });

    const referenceExact = plan.proposedPayments.filter(
      p => plan.paymentConfidence.get(p.id) === 'reference-exact',
    );
    expect(referenceExact).toHaveLength(3);

    const persisted = recordInvoicePayments({
      payments: referenceExact,
      invoicesDir: tmpDir,
    });
    expect(persisted.ok).toBe(true);
    if (!persisted.ok) return;

    __resetInvoiceRegistryForTests(buildInvoiceRegistry(tmpDir));
    const statusUpdates = applyInvoiceStatusAfterPayments(persisted.payments, tmpDir);
    expect(statusUpdates).toHaveLength(3);
    expect(statusUpdates.every(u => u.status === 'paid')).toBe(true);

    const onDisk = readInvoicePaymentsCsvFile(getInvoicePaymentsCsvPath(tmpDir));
    expect(onDisk.filter(p => p.bank_transaction_id === '211')).toHaveLength(3);

    const invoiceRows = readInvoicesCsvFile(getInvoicesCsvPath(tmpDir));
    expect(invoiceRows.every(inv => inv.status === 'paid')).toBe(true);
  });
});
