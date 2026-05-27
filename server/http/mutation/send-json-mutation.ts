import type { Response } from 'express';
import type { JsonMutationResult } from './types.js';

/** Writes the same status/body an Express handler would have sent. */
export function sendJsonMutation(res: Response, result: JsonMutationResult): void {
  if (result.status === 204) {
    res.status(204).end();
    return;
  }
  res.status(result.status).json(result.body);
}
