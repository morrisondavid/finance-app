/**
 * Child-process entry point for background `initDatabase()`.
 *
 * Spawned via `child_process.fork()` from {@link initDatabaseInBackground}
 * so the heavy synchronous SQLite + CSV work runs in a separate process,
 * keeping the main Node event loop free to serve HTTP requests.
 *
 * Communication protocol:
 *   - child writes `{ ok: true }` to stdout on success
 *   - child writes `{ ok: false, error, stack }` on failure
 *   - child exits with code 0 (success) or 1 (failure)
 */

import { initDatabase } from './index.js';

async function main(): Promise<void> {
  await initDatabase();
  process.stdout.write(JSON.stringify({ ok: true }) + '\n');
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  const stack = err instanceof Error ? err.stack : undefined;
  process.stdout.write(JSON.stringify({ ok: false, error: message, stack }) + '\n');
  process.exitCode = 1;
});
