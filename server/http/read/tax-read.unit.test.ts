/**
 * Unit tests for tax overview panel split (UK Ltd vs personal SA).
 */

import { describe, it, expect, afterAll, beforeAll, vi } from 'vitest';
import {
  createInMemoryTestDb,
  type TestDbHandles,
} from '../../db/test-harness/in-memory-db.js';
import type { ObligationRow } from '../../../shared/api-contracts.js';
import { buildCapitalGainsPanel, buildSelfAssessmentPanel, buildUkLtdPanel } from './tax-read.js';

const harness: { current: TestDbHandles | null } = { current: null };

vi.mock('../../db/connection.js', () => ({
  getDb: () => {
    if (!harness.current) throw new Error('test db not initialised');
    return harness.current.db;
  },
  get OBLIGATIONS_DIR() {
    if (!harness.current) throw new Error('test db not initialised');
    return harness.current.obligationsDir;
  },
}));

const stubLiabilities = vi.hoisted(() => ({
  vatOwedThisQuarter: 100,
  vatQuarter: { dueDate: '2026-09-07', label: 'May–Jul 2026', startDate: '2026-05-01', endDate: '2026-07-31' },
  corporationTax: 5000,
}));

vi.mock('../../db/repositories/tax.js', async importOriginal => {
  const actual = await importOriginal<typeof import('../../db/repositories/tax.js')>();
  return {
    ...actual,
    getTaxLiabilities: vi.fn(() => ({
      vatOwedThisQuarter: stubLiabilities.vatOwedThisQuarter,
      vatQuarter: stubLiabilities.vatQuarter,
      corporationTax: stubLiabilities.corporationTax,
    })),
  };
});

function saObligation(personId: 'david' | 'heena', amount: number): ObligationRow {
  return {
    id: `auto-sa-${personId}`,
    source: 'auto',
    type: 'self-assessment',
    name: `Self Assessment — ${personId}`,
    entity: 'autonize-it-ltd',
    frequency: 'annual',
    expectedAmount: amount,
    naiveAmount: null,
    adjustmentBasis: null,
    adjustmentSource: null,
    dueDate: '2027-01-31',
    status: 'not-yet-due',
    paidAmount: null,
    paidDate: null,
    paidFromAccount: null,
    paidFromTxHash: null,
    notes: null,
    personId,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  };
}

beforeAll(() => {
  harness.current = createInMemoryTestDb();
});

afterAll(() => {
  harness.current?.cleanup();
});

describe('buildUkLtdPanel', () => {
  it('never emits self-assessment lines when SA obligations exist in input', () => {
    const obligations = [
      saObligation('david', 1200),
      saObligation('heena', 800),
    ];
    const panel = buildUkLtdPanel(new Map(), obligations, '2025/26');
    expect(panel.lines.some(l => l.kind === 'self-assessment')).toBe(false);
    expect(panel.lines.some(l => l.kind === 'vat')).toBe(true);
    expect(panel.lines.some(l => l.kind === 'corporation-tax')).toBe(true);
  });
});

describe('buildSelfAssessmentPanel', () => {
  it('emits one line per person and prefers obligation expectedAmount', () => {
    const obligations = [
      saObligation('david', 2123.24),
      saObligation('heena', 0),
    ];
    const panel = buildSelfAssessmentPanel(new Map(), obligations);
    expect(panel.lines.length).toBe(2);
    expect(panel.lines.every(l => l.kind === 'self-assessment')).toBe(true);

    const davidLine = panel.lines.find(l => l.label.includes('David'));
    const heenaLine = panel.lines.find(l => l.label.includes('Heena'));
    expect(davidLine?.amount).toBe(2123.24);
    expect(heenaLine?.amount).toBe(0);
    expect(panel.headlineTotal).toBe(2123.24);
  });

  it('includes non-resident detail when estimating current tax year', () => {
    const panel = buildSelfAssessmentPanel(new Map(), []);
    for (const line of panel.lines) {
      expect(line.detail).toMatch(/Non-resident basis|Tax year/);
    }
  });
});

describe('buildCapitalGainsPanel', () => {
  it('produces per-person CGT lines when property sale data exists', () => {
    const panel = buildCapitalGainsPanel();
    expect(panel.currency).toBe('GBP');
    if (panel.lines.length > 0) {
      expect(panel.lines.every(l => l.kind === 'capital-gains')).toBe(true);
      expect(panel.headlineTotal).toBeGreaterThan(0);
    }
  });
});
