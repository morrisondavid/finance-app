import { beforeAll } from 'vitest';
import { initConnection } from '../connection.js';
import {
  ensurePopulatedLedgerForVitest,
  integrationLedgerDbPath,
} from './populated-ledger-cache.js';

/**
 * Open a populated ledger for MCP integration / contract tests.
 * Pass `import.meta.url` so each test file gets its own SQLite copy.
 */
export function usePopulatedIntegrationDatabase(testModuleUrl: string): void {
  beforeAll(async () => {
    const dbPath = integrationLedgerDbPath(testModuleUrl);
    await ensurePopulatedLedgerForVitest(dbPath);
    process.env.BANK_STATEMENTS_DB_PATH = dbPath;
    initConnection();
  }, 300_000);
}
