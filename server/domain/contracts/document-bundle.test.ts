import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { resolveContractDocumentBundle } from './document-bundle.js';

describe('resolveContractDocumentBundle', () => {
  let tmpRoot: string;

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'contract-docs-'));
  });

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('resolves a single pdf file', () => {
    const filePath = path.join(tmpRoot, 'dc-sow-2026.pdf');
    fs.writeFileSync(filePath, '%PDF-test');
    const bundle = resolveContractDocumentBundle('dc-sow-2026', tmpRoot);
    expect(bundle?.kind).toBe('single');
    if (bundle?.kind === 'single') {
      expect(bundle.filename).toBe('dc-sow-2026.pdf');
      expect(bundle.filePath).toBe(filePath);
    }
  });

  it('resolves a directory of pdfs as a zip bundle', () => {
    const dir = path.join(tmpRoot, 'dc-sow-2025-jun');
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, 'b-second.pdf'), '%PDF-b');
    fs.writeFileSync(path.join(dir, 'a-first.pdf'), '%PDF-a');
    const bundle = resolveContractDocumentBundle('dc-sow-2025-jun', tmpRoot);
    expect(bundle?.kind).toBe('directory');
    if (bundle?.kind === 'directory') {
      expect(bundle.zipFilename).toBe('dc-sow-2025-jun-documents.zip');
      expect(bundle.entries.map(e => e.archiveName)).toEqual(['a-first.pdf', 'b-second.pdf']);
    }
  });

  it('returns null when nothing is on disk', () => {
    expect(resolveContractDocumentBundle('missing', tmpRoot)).toBeNull();
  });
});
