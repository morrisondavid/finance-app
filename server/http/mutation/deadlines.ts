/**
 * Mutations backing `/api/deadlines*` — Express + MCP (`deadlines_*` tools).
 */

import { z } from 'zod';
import {
  DeadlineCompleteBodySchema,
  DeadlineCreateBodySchema,
  DeadlineUpdateBodySchema,
} from '../../../shared/api-contracts.js';
import {
  createDeadline,
  deleteDeadline,
  getDeadline,
  markDeadlineDone,
  unmarkDeadlineDone,
  updateDeadline,
} from '../../db/repositories/deadlines.js';
import type { JsonMutationResult } from './types.js';

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : 'Unknown error';
}

function isValidationError(msg: string): boolean {
  return (
    msg.includes('must be') || msg.startsWith('Deadline ') || msg.includes('already exists')
  );
}

export function mutateDeadlinesCreate(body: unknown): JsonMutationResult {
  try {
    const reqBody = DeadlineCreateBodySchema.parse(body);
    const deadline = createDeadline({
      id: reqBody.id,
      type: reqBody.type,
      title: reqBody.title,
      dueDate: reqBody.dueDate,
      recurrence: reqBody.recurrence,
      notes: reqBody.notes ?? null,
      url: reqBody.url ?? null,
      completedDate: reqBody.completedDate ?? null,
    });
    return { status: 201, body: { deadline } };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return { status: 400, body: { error: 'Invalid request', details: error.issues } };
    }
    const msg = errorMessage(error);
    if (isValidationError(msg)) {
      return { status: 400, body: { error: msg } };
    }
    console.error('[Deadlines] POST error:', error);
    return { status: 500, body: { error: 'Failed to create deadline' } };
  }
}

export function mutateDeadlinesUpdate(id: string, body: unknown): JsonMutationResult {
  try {
    const reqBody = DeadlineUpdateBodySchema.parse(body);
    const existing = getDeadline(id);
    if (!existing) {
      return { status: 404, body: { error: 'Deadline not found' } };
    }
    const deadline = updateDeadline(id, reqBody);
    return { status: 200, body: { deadline } };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return { status: 400, body: { error: 'Invalid request', details: error.issues } };
    }
    const msg = errorMessage(error);
    if (msg.includes('not found')) {
      return { status: 404, body: { error: msg } };
    }
    if (isValidationError(msg)) {
      return { status: 400, body: { error: msg } };
    }
    console.error('[Deadlines] PUT error:', error);
    return { status: 500, body: { error: 'Failed to update deadline' } };
  }
}

export function mutateDeadlinesRemove(id: string): JsonMutationResult {
  try {
    const deleted = deleteDeadline(id);
    if (!deleted) {
      return { status: 404, body: { error: 'Deadline not found' } };
    }
    return { status: 200, body: { ok: true } };
  } catch (error) {
    console.error('[Deadlines] DELETE error:', error);
    return { status: 500, body: { error: 'Failed to delete deadline' } };
  }
}

export function mutateDeadlinesMarkDone(id: string, body: unknown): JsonMutationResult {
  try {
    const reqBody = DeadlineCompleteBodySchema.parse(body ?? {});
    const deadline = markDeadlineDone(id, reqBody.completedDate);
    if (!deadline) {
      return { status: 404, body: { error: 'Deadline not found' } };
    }
    return { status: 200, body: { deadline } };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return { status: 400, body: { error: 'Invalid request', details: error.issues } };
    }
    console.error('[Deadlines] complete error:', error);
    return { status: 500, body: { error: 'Failed to mark deadline done' } };
  }
}

export function mutateDeadlinesClearDone(id: string): JsonMutationResult {
  try {
    const deadline = unmarkDeadlineDone(id);
    if (!deadline) {
      return { status: 404, body: { error: 'Deadline not found' } };
    }
    return { status: 200, body: { deadline } };
  } catch (error) {
    console.error('[Deadlines] uncomplete error:', error);
    return { status: 500, body: { error: 'Failed to unmark deadline done' } };
  }
}
