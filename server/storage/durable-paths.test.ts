import { describe, expect, it } from 'vitest';
import {
  DATA_DIGEST_SKIP_BASENAMES,
  DATA_SYNC_EXCLUDED_BASENAMES,
  DURABLE_TOP_LEVEL_DIRS,
} from './durable-paths.js';

describe('durable-paths', () => {
  it('never syncs Enable OAuth blob via DATA_SYNC_EXCLUDED_BASENAMES', () => {
    expect(DATA_SYNC_EXCLUDED_BASENAMES.has('enable-sessions.json')).toBe(true);
  });

  it('digest skips derived SQLite artefacts plus sessions', () => {
    expect(DATA_DIGEST_SKIP_BASENAMES.has('transactions.db')).toBe(true);
    expect(DATA_DIGEST_SKIP_BASENAMES.has('manifest.json')).toBe(true);
    expect(DATA_DIGEST_SKIP_BASENAMES.has('enable-sessions.json')).toBe(true);
  });

  it('lists every top-level durable directory mirrored to S3', () => {
    expect(DURABLE_TOP_LEVEL_DIRS).toContain('statements');
    expect(DURABLE_TOP_LEVEL_DIRS).toContain('invoices');
    expect(DURABLE_TOP_LEVEL_DIRS.length).toBe(11);
  });
});
