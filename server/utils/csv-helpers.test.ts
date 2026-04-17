import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { escapeCsvField, ensureDir, atomicWriteCsv } from './csv-helpers.js';

describe('escapeCsvField', () => {
  it('returns clean values unchanged', () => {
    expect(escapeCsvField('hello')).toBe('hello');
  });

  it('wraps values with commas in quotes', () => {
    expect(escapeCsvField('a,b')).toBe('"a,b"');
  });

  it('escapes double quotes', () => {
    expect(escapeCsvField('say "hi"')).toBe('"say ""hi"""');
  });

  it('wraps values with newlines', () => {
    expect(escapeCsvField('line1\nline2')).toBe('"line1\nline2"');
  });

  it('wraps values with carriage returns', () => {
    expect(escapeCsvField('a\rb')).toBe('"a\rb"');
  });

  it('handles empty string', () => {
    expect(escapeCsvField('')).toBe('');
  });
});

describe('ensureDir', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'csv-helpers-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('creates nested directories', () => {
    const nested = path.join(tmpDir, 'a', 'b', 'c');
    ensureDir(nested);
    expect(fs.existsSync(nested)).toBe(true);
  });

  it('is a no-op for existing directories', () => {
    ensureDir(tmpDir);
    expect(fs.existsSync(tmpDir)).toBe(true);
  });
});

describe('atomicWriteCsv', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'csv-helpers-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('writes content to the target file', () => {
    const target = path.join(tmpDir, 'test.csv');
    atomicWriteCsv(target, 'a,b\n1,2\n');
    expect(fs.readFileSync(target, 'utf8')).toBe('a,b\n1,2\n');
  });

  it('creates parent directories if needed', () => {
    const target = path.join(tmpDir, 'sub', 'dir', 'test.csv');
    atomicWriteCsv(target, 'header\n');
    expect(fs.existsSync(target)).toBe(true);
  });

  it('does not leave a .tmp file on success', () => {
    const target = path.join(tmpDir, 'test.csv');
    atomicWriteCsv(target, 'data\n');
    expect(fs.existsSync(`${target}.tmp`)).toBe(false);
  });

  it('overwrites existing file', () => {
    const target = path.join(tmpDir, 'test.csv');
    fs.writeFileSync(target, 'old', 'utf8');
    atomicWriteCsv(target, 'new\n');
    expect(fs.readFileSync(target, 'utf8')).toBe('new\n');
  });
});
