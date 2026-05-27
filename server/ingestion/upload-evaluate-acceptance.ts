/**
 * Pure rules for multipart upload acceptance — shared by `/api/upload` + MCP decode path.
 */

import path from 'path';
import { ACCOUNTS } from '../types.js';
import type { AccountName } from '../types.js';
import { PARSERS } from '../parsers/index.js';

/** Result of evaluating whether an uploaded file name is acceptable (mirrors legacy route export). */
export type UploadAcceptance =
  | { accepted: true }
  | { accepted: false; reason: string };

export function evaluateUploadAcceptance(
  filename: string,
  account: string,
  type: string,
): UploadAcceptance {
  const ext = path.extname(filename).toLowerCase();

  if (account === 'invoices') {
    if (ext === '.pdf') return { accepted: true };
    return { accepted: false, reason: 'Invoices must be PDF files' };
  }

  if (type === 'pdf' && ext === '.pdf') return { accepted: true };
  if (type === 'csv' && ext === '.csv') return { accepted: true };

  if (type === 'csv' && ACCOUNTS.includes(account as AccountName)) {
    const extras = PARSERS[account]?.acceptedUploadExtensions ?? [];
    if (extras.includes(ext)) return { accepted: true };
  }

  return {
    accepted: false,
    reason: `Invalid file type. Expected ${type.toUpperCase()} file.`,
  };
}
