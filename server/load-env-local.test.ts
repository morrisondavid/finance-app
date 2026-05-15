import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { loadEnvLocal } from './load-env-local.js';

describe('loadEnvLocal', () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'load-env-'));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('loads KEY=VAL from .env.local without overwriting existing process.env', () => {
    const prev = process.env.FOO_TEST_LOAD_ENV;
    process.env.FOO_TEST_LOAD_ENV = 'from-shell';
    fs.writeFileSync(
      path.join(dir, '.env.local'),
      'FOO_TEST_LOAD_ENV=from-file\nBAR_TEST_LOAD_ENV=bar-val\n',
      'utf-8',
    );
    loadEnvLocal(dir);
    expect(process.env.FOO_TEST_LOAD_ENV).toBe('from-shell');
    expect(process.env.BAR_TEST_LOAD_ENV).toBe('bar-val');
    delete process.env.BAR_TEST_LOAD_ENV;
    if (prev === undefined) delete process.env.FOO_TEST_LOAD_ENV;
    else process.env.FOO_TEST_LOAD_ENV = prev;
  });
});
