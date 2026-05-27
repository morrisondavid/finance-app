import type { Response } from 'express';
import type { JsonReadResult } from './types.js';

export function sendJsonRead(res: Response, r: JsonReadResult): void {
  if (r.ok) {
    res.json(r.body);
    return;
  }
  res.status(r.status).json(r.body);
}
