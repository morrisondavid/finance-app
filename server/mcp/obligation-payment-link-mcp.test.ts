import { describe, it, expect, afterAll, beforeEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import {
  ObligationPaymentCandidatesResponseSchema,
  ObligationStateUpsertBodySchema,
} from '../../shared/api-contracts.js';
import { createInMemoryTestDb } from '../db/test-harness/in-memory-db.js';
import { CANONICAL_MCP_TOOL_GROUPS } from './canonical-mcp-tool-registry.js';

const harness = createInMemoryTestDb();

vi.mock('../db/connection.js', () => ({
  getDb: () => harness.db,
  OBLIGATIONS_DIR: harness.obligationsDir,
}));

const { readObligationPaymentCandidates } = await import('../http/read/obligation-payment-candidates.js');
const { mutateFinancialObligationsUpsertState } = await import('../http/mutation/obligations.js');
const { loadManualObligationsFromCsv } = await import('../db/repositories/obligations.js');

const MANUAL_ID = 'manual-mcp-link-test';

afterAll(() => harness.cleanup());

beforeEach(() => {
  harness.db.exec('DELETE FROM transactions; DELETE FROM financial_obligations;');
  for (const name of ['obligations.csv', 'obligation-state.csv']) {
    const csvPath = path.join(harness.obligationsDir, name);
    if (fs.existsSync(csvPath)) fs.unlinkSync(csvPath);
  }
  fs.writeFileSync(
    path.join(harness.obligationsDir, 'obligations.csv'),
    'id,category,frequency,merchant,display_name,account,amount,currency,notes,ownership_david,ownership_heena,person_id,amount_tolerance,due_date,tax_type\n' +
      `${MANUAL_ID},tax-manual,one-off,HMRC,Self Assessment Tax,,2123.24,GBP,,,,david,,2026-01-31,self-assessment,\n`,
    'utf8',
  );
  loadManualObligationsFromCsv();
});

describe('obligation payment link MCP parity', () => {
  it('registers list_payment_candidates and upsert_state in the canonical tool groups', () => {
    const tools = CANONICAL_MCP_TOOL_GROUPS.flatMap(([, names]) => names);
    expect(tools).toContain('financial_obligations_list_payment_candidates');
    expect(tools).toContain('financial_obligations_upsert_state');
  });

  it('ObligationStateUpsertBodySchema accepts optional paidFromTxHash', () => {
    const parsed = ObligationStateUpsertBodySchema.safeParse({
      status: 'paid',
      paidFromTxHash: 'tx-hash-abc',
    });
    expect(parsed.success).toBe(true);
  });

  it('readObligationPaymentCandidates returns 400 when filters are missing', () => {
    const result = readObligationPaymentCandidates(MANUAL_ID, {});
    expect(result.ok).toBe(false);
    if (result.ok) {
      expect.fail('expected validation failure');
    }
    expect(result.status).toBe(400);
  });

  it('readObligationPaymentCandidates returns schema-valid candidates (GET /payment-candidates parity)', () => {
    harness.db.prepare(`
      INSERT INTO transactions (hash, date, description, amount, account, type)
      VALUES ('mcp-candidate-hash', '2026-05-14', 'HMRC GOV.UK SA', -2123.24, 'barclaycard', 'expense')
    `).run();

    const result = readObligationPaymentCandidates(MANUAL_ID, {
      account: 'barclaycard',
      year: '2026',
      month: '5',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      expect.fail('expected payment candidates read ok');
    }
    const parsed = ObligationPaymentCandidatesResponseSchema.safeParse(result.body);
    expect(parsed.success).toBe(true);
    expect(parsed.data?.candidates[0]?.hash).toBe('mcp-candidate-hash');
  });

  it('mutateFinancialObligationsUpsertState derives paid fields from paidFromTxHash (MCP upsert parity)', () => {
    harness.db.prepare(`
      INSERT INTO transactions (hash, date, description, amount, account, type)
      VALUES ('mcp-paid-hash', '2026-05-14', 'HMRC GOV.UK SA', -2123.24, 'barclaycard', 'expense')
    `).run();

    const result = mutateFinancialObligationsUpsertState(MANUAL_ID, {
      status: 'paid',
      paidFromTxHash: 'mcp-paid-hash',
    });
    expect(result.status).toBe(200);
    if (result.body === null || typeof result.body !== 'object' || Array.isArray(result.body)) {
      expect.fail('expected obligation body');
    }
    expect(Reflect.get(result.body, 'paidFromTxHash')).toBe('mcp-paid-hash');
    expect(Reflect.get(result.body, 'paidFromAccount')).toBe('barclaycard');
    expect(Reflect.get(result.body, 'status')).toBe('paid');
  });

  it('mutateFinancialObligationsUpsertState rejects paidFromTxHash when amount mismatches (MCP upsert parity)', () => {
    harness.db.prepare(`
      INSERT INTO transactions (hash, date, description, amount, account, type)
      VALUES ('mcp-bad-hash', '2026-02-12', 'FINANCE CHARGE', -30.69, 'barclaycard', 'expense')
    `).run();

    const result = mutateFinancialObligationsUpsertState(MANUAL_ID, {
      status: 'paid',
      paidFromTxHash: 'mcp-bad-hash',
    });
    expect(result.status).toBe(400);
    if (result.body === null || typeof result.body !== 'object' || Array.isArray(result.body)) {
      expect.fail('expected error body');
    }
    expect(Reflect.get(result.body, 'error')).toMatch(/does not match obligation expected/i);
  });
});
