/**
 * Shared test helpers for the transaction-overrides domain.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';

export function mkTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'overrides-reg-'));
}
