import { z } from 'zod';
import {
  AccrualResponseSchema,
  ContractIdSchema,
  ContractsListResponseSchema,
  EntityIdSchema,
  ExpectedReceiptsResponseSchema,
  LeaveListResponseSchema,
  LeaveIdSchema,
} from '../../../shared/api-contracts.js';
import { buildAggregateAccrualResponse } from '../../domain/contracts/aggregate-accrual.js';
import { allContracts, findContractById } from '../../domain/contracts/queries.js';
import { leaveForContract } from '../../domain/leave/index.js';
import { todayIsoLocal } from '../../../shared/iso-date.js';
import { holidayDatesForEntity } from '../../domain/working-days/public-holidays.js';
import { buildExpectedReceipts } from '../../domain/contracts/expected-receipts.js';
import { computeAccrual } from '../../domain/contracts/income-accrual.js';
import { resolveLastPaymentsForContracts } from '../../domain/contracts/last-payment-resolver.js';
import { resolveSettledThroughByContract } from '../../domain/contracts/settled-through-resolver.js';
import { jsonReadFail, jsonReadOk, type JsonReadResult } from './types.js';

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : 'Unknown error';
}

export function parseContractId(raw: string): string | null {
  const parsed = ContractIdSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

export function parseLeaveId(raw: string): string | null {
  const parsed = LeaveIdSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

function resolveContractEntity(idRaw: string) {
  const parsedId = parseContractId(idRaw);
  if (parsedId === null) return null;
  return findContractById(parsedId);
}

export const ContractsExpectedReceiptsQuerySchema = z.object({
  days: z.coerce.number().int().positive().default(720),
  entityId: EntityIdSchema.optional(),
});

/** GET /api/contracts — list */
export function readContractsRoot(): JsonReadResult {
  try {
    const body = ContractsListResponseSchema.parse({ contracts: allContracts() });
    return jsonReadOk(body);
  } catch (error) {
    console.error('[Contracts read] GET / error:', error);
    return jsonReadFail(500, { error: `Failed to list contracts: ${errorMessage(error)}` });
  }
}

/** GET /api/contracts/income-accrual — aggregate */
export function readContractsIncomeAccrualAggregate(): JsonReadResult {
  try {
    return jsonReadOk(buildAggregateAccrualResponse());
  } catch (error) {
    console.error('[Contracts read] GET /income-accrual error:', error);
    return jsonReadFail(500, {
      error: `Failed to compute aggregate accrual: ${errorMessage(error)}`,
    });
  }
}

/** GET /api/contracts/expected-receipts parity. */
export function readContractsExpectedReceiptsFromQuery(
  query: Record<string, unknown>,
): JsonReadResult {
  try {
    const parsed = ContractsExpectedReceiptsQuerySchema.safeParse(query);
    if (!parsed.success) {
      return jsonReadFail(400, { error: 'invalid-params', issues: parsed.error.issues });
    }
    const { days: horizonDays, entityId: filterEntityId } = parsed.data;
    const body = buildExpectedReceipts({ horizonDays, filterEntityId });
    return jsonReadOk(ExpectedReceiptsResponseSchema.parse(body));
  } catch (error) {
    console.error('[Contracts read] GET /expected-receipts error:', error);
    return jsonReadFail(500, {
      error: `Failed to build expected receipts: ${errorMessage(error)}`,
    });
  }
}

/** GET /api/contracts/:id */
export function readContractById(idRaw: string): JsonReadResult {
  const contract = resolveContractEntity(idRaw);
  if (contract === null) {
    return jsonReadFail(404, { error: 'Contract not found' });
  }
  return jsonReadOk({ contract });
}

/** GET /api/contracts/:id/income-accrual */
export function readContractIncomeAccrual(idRaw: string): JsonReadResult {
  const contract = resolveContractEntity(idRaw);
  if (contract === null) {
    return jsonReadFail(404, { error: 'Contract not found' });
  }
  try {
    const today = todayIsoLocal();
    const leaveRows = leaveForContract(contract.id);
    const settledThrough = resolveSettledThroughByContract({ contracts: [contract] });
    const lastPayments = resolveLastPaymentsForContracts({
      contracts: [contract],
      today,
    });
    const yearStart = `${today.slice(0, 4)}-01-01`;
    const yearEnd = `${today.slice(0, 4)}-12-31`;
    const publicHolidayDates = holidayDatesForEntity(contract.issuing_entity_id, yearStart, yearEnd);
    const body = AccrualResponseSchema.parse(
      computeAccrual({
        contract,
        leaveRows,
        today,
        lastPaymentDate: lastPayments.get(contract.id) ?? null,
        settledThroughPeriodEnd: settledThrough.get(contract.id) ?? null,
        publicHolidayDates,
      }),
    );
    return jsonReadOk(body);
  } catch (error) {
    console.error('[Contracts read] GET /:id/income-accrual error:', error);
    return jsonReadFail(500, { error: `Failed to compute accrual: ${errorMessage(error)}` });
  }
}

/** GET /api/contracts/:id/leave — same behaviour when served via HTTP or MCP (`get_http_contract_leave`). */
export function readContractLeave(idRaw: string): JsonReadResult {
  const contract = resolveContractEntity(idRaw);
  if (contract === null) {
    return jsonReadFail(404, { error: 'Contract not found' });
  }
  try {
    const body = LeaveListResponseSchema.parse({
      leave: leaveForContract(contract.id),
    });
    return jsonReadOk(body);
  } catch (error) {
    console.error('[Contracts read] GET /:id/leave error:', error);
    return jsonReadFail(500, { error: `Failed to list leave: ${errorMessage(error)}` });
  }
}
