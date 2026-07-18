import { describe, it, expect, vi, beforeEach } from 'vitest';

const autoReconcileHighConfidenceMock = vi.fn();
const syncInvoiceStatusesFromPaymentsMock = vi.fn();

vi.mock('./auto-reconcile.js', () => ({
  autoReconcileHighConfidence: (input: unknown) => autoReconcileHighConfidenceMock(input),
  syncInvoiceStatusesFromPayments: (input: unknown) => syncInvoiceStatusesFromPaymentsMock(input),
}));

import { runAutoReconcileAllEntities } from './run-auto-reconcile-all-entities.js';

beforeEach(() => {
  autoReconcileHighConfidenceMock.mockReset();
  syncInvoiceStatusesFromPaymentsMock.mockReset();
  syncInvoiceStatusesFromPaymentsMock.mockReturnValue([]);
});

describe('runAutoReconcileAllEntities', () => {
  it('runs reference-exact reconcile for both entities then syncs statuses', () => {
    autoReconcileHighConfidenceMock
      .mockReturnValueOnce({ persisted: [{ id: 'ip-1' }], statusUpdates: [], plan: {} })
      .mockReturnValueOnce({ persisted: [], statusUpdates: [], plan: {} });
    syncInvoiceStatusesFromPaymentsMock.mockReturnValue([
      { invoiceId: 'EG-0051', status: 'paid' },
    ]);

    const result = runAutoReconcileAllEntities({ now: '2026-06-02' });

    expect(autoReconcileHighConfidenceMock).toHaveBeenCalledTimes(2);
    expect(autoReconcileHighConfidenceMock).toHaveBeenNthCalledWith(1, {
      now: '2026-06-02',
      entityId: 'autonize-it-ltd',
    });
    expect(autoReconcileHighConfidenceMock).toHaveBeenNthCalledWith(2, {
      now: '2026-06-02',
      entityId: 'autonize-it-fzco',
    });
    expect(syncInvoiceStatusesFromPaymentsMock).toHaveBeenCalledWith({});
    expect(result.byEntity['autonize-it-ltd']?.persisted).toHaveLength(1);
    expect(result.statusUpdates).toEqual([{ invoiceId: 'EG-0051', status: 'paid' }]);
  });

  it('continues when one entity reconcile throws', () => {
    autoReconcileHighConfidenceMock
      .mockImplementationOnce(() => {
        throw new Error('persist failed');
      })
      .mockReturnValueOnce({ persisted: [{ id: 'ip-2' }], statusUpdates: [], plan: {} });

    const result = runAutoReconcileAllEntities();

    expect(autoReconcileHighConfidenceMock).toHaveBeenCalledTimes(2);
    expect(result.byEntity['autonize-it-ltd']).toBeUndefined();
    expect(result.byEntity['autonize-it-fzco']?.persisted).toHaveLength(1);
    expect(syncInvoiceStatusesFromPaymentsMock).toHaveBeenCalledOnce();
  });
});
