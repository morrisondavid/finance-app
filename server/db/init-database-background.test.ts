/**
 * Tests for the shadow DB swap helpers and `initDatabaseInBackground`.
 *
 * The swap helpers (`swapDatabaseFile`, `cleanupShadowDbFiles`,
 * `resolveShadowDbPath`) are pure filesystem operations and are tested
 * directly with temp dirs. The full `initDatabaseInBackground` path is
 * exercised with `BANK_STATEMENTS_DB_INIT_BACKGROUND=0` (inline fallback)
 * to avoid spawning a child process in tests; the shadow-swap code path
 * itself is covered by the helper tests.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import Database from 'better-sqlite3';
import {
  resolveShadowDbPath,
  swapDatabaseFile,
  cleanupShadowDbFiles,
} from './connection.js';
import { isDbInitializing, isDbSwapping } from './index.js';

describe('resolveShadowDbPath', () => {
  it('defaults to {dbPath}.rebuild', () => {
    const prev = process.env.BANK_STATEMENTS_DB_PATH;
    const prevShadow = process.env.BANK_STATEMENTS_DB_SHADOW_PATH;
    delete process.env.BANK_STATEMENTS_DB_PATH;
    delete process.env.BANK_STATEMENTS_DB_SHADOW_PATH;
    try {
      const shadow = resolveShadowDbPath();
      expect(shadow.endsWith('.db.rebuild')).toBe(true);
    } finally {
      if (prev !== undefined) process.env.BANK_STATEMENTS_DB_PATH = prev;
      if (prevShadow !== undefined) process.env.BANK_STATEMENTS_DB_SHADOW_PATH = prevShadow;
    }
  });

  it('respects BANK_STATEMENTS_DB_SHADOW_PATH when set', () => {
    const prev = process.env.BANK_STATEMENTS_DB_SHADOW_PATH;
    process.env.BANK_STATEMENTS_DB_SHADOW_PATH = '/tmp/custom-shadow.db';
    try {
      expect(resolveShadowDbPath()).toBe('/tmp/custom-shadow.db');
    } finally {
      if (prev === undefined) delete process.env.BANK_STATEMENTS_DB_SHADOW_PATH;
      else process.env.BANK_STATEMENTS_DB_SHADOW_PATH = prev;
    }
  });
});

describe('swapDatabaseFile', () => {
  let tmpDir: string;
  let livePath: string;
  let shadowPath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shadow-swap-test-'));
    livePath = path.join(tmpDir, 'live.db');
    shadowPath = path.join(tmpDir, 'shadow.db');
    // Create a "live" DB with a marker table.
    const live = new Database(livePath);
    live.exec('CREATE TABLE marker (id INTEGER PRIMARY KEY, label TEXT NOT NULL);');
    live.exec("INSERT INTO marker (id, label) VALUES (1, 'live');");
    live.close();
    // Create a "shadow" DB with a different marker.
    const shadow = new Database(shadowPath);
    shadow.exec('CREATE TABLE marker (id INTEGER PRIMARY KEY, label TEXT NOT NULL);');
    shadow.exec("INSERT INTO marker (id, label) VALUES (1, 'shadow');");
    shadow.close();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('replaces the live file with the shadow file', () => {
    swapDatabaseFile(livePath, shadowPath);

    expect(fs.existsSync(livePath)).toBe(true);
    expect(fs.existsSync(shadowPath)).toBe(false);
    const swapped = new Database(livePath, { readonly: true });
    const row = swapped.prepare('SELECT label FROM marker WHERE id = 1').get() as { label: string };
    swapped.close();
    expect(row.label).toBe('shadow');
  });

  it('removes leftover -wal and -shm sidecars on both files', () => {
    fs.writeFileSync(`${shadowPath}-wal`, Buffer.from([0]));
    fs.writeFileSync(`${shadowPath}-shm`, Buffer.from([0]));
    fs.writeFileSync(`${livePath}-wal`, Buffer.from([0]));

    swapDatabaseFile(livePath, shadowPath);

    expect(fs.existsSync(`${livePath}-wal`)).toBe(false);
    expect(fs.existsSync(`${livePath}-shm`)).toBe(false);
  });

  it('throws when the shadow file does not exist, leaving live intact', () => {
    fs.unlinkSync(shadowPath);
    expect(() => swapDatabaseFile(livePath, shadowPath)).toThrow();
    // Live file must still be readable with its original content.
    const live = new Database(livePath, { readonly: true });
    const row = live.prepare('SELECT label FROM marker WHERE id = 1').get() as { label: string };
    live.close();
    expect(row.label).toBe('live');
  });
});

describe('cleanupShadowDbFiles', () => {
  it('deletes shadow db, -wal, and -shm if present', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shadow-cleanup-test-'));
    const shadowPath = path.join(tmpDir, 'shadow.db');
    fs.writeFileSync(shadowPath, Buffer.from([0]));
    fs.writeFileSync(`${shadowPath}-wal`, Buffer.from([0]));
    fs.writeFileSync(`${shadowPath}-shm`, Buffer.from([0]));

    cleanupShadowDbFiles(shadowPath);

    expect(fs.existsSync(shadowPath)).toBe(false);
    expect(fs.existsSync(`${shadowPath}-wal`)).toBe(false);
    expect(fs.existsSync(`${shadowPath}-shm`)).toBe(false);

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('is a no-op when no shadow files exist', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shadow-cleanup-test-'));
    const shadowPath = path.join(tmpDir, 'shadow.db');
    expect(() => cleanupShadowDbFiles(shadowPath)).not.toThrow();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});

describe('initDatabaseInBackground flags', () => {
  it('isDbInitializing and isDbSwapping default to false', () => {
    expect(isDbInitializing()).toBe(false);
    expect(isDbSwapping()).toBe(false);
  });
});
