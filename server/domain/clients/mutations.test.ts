/**
 * `updateClient` covers the merge / validate / write / invalidate chain
 * that `PUT /api/clients/:id` leans on. Every branch of
 * `UpdateClientResult` has a regression test here so the route layer
 * can stay a dumb translator from result → HTTP status.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { updateClient } from './mutations.js';
import {
  __resetClientRegistryForTests,
  buildClientRegistry,
  getClientRegistry,
} from './registry.js';
import {
  getClientsCsvPath,
  readClientsCsvFile,
  writeClientsCsvFile,
} from './csv-io.js';
import { parseClientRow } from './csv-io.js';
import { directRow, agencyRow } from './test-helpers.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'clients-mutations-'));
  const seeded = [parseClientRow(directRow), parseClientRow(agencyRow)];
  writeClientsCsvFile(getClientsCsvPath(tmpDir), seeded);
  __resetClientRegistryForTests(buildClientRegistry(tmpDir));
});

afterEach(() => {
  __resetClientRegistryForTests();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

const FIXED_NOW = new Date('2026-05-01T09:00:00Z');

describe('updateClient — happy paths', () => {
  it('patches a direct client field, rewrites the CSV, and stamps updated_at', () => {
    const result = updateClient({
      clientId: 'delta-capita',
      patch: { kind: 'direct', vat_number: 'GB 123 4567 89' },
      clientsDir: tmpDir,
      now: FIXED_NOW,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.client.vat_number).toBe('GB 123 4567 89');
    expect(result.client.updated_at).toBe('2026-05-01');
    // Registry cache was invalidated — re-building from the tmp CSV
    // reflects the new state.
    __resetClientRegistryForTests(buildClientRegistry(tmpDir));
    expect(getClientRegistry().indexes.byId.get('delta-capita')?.vat_number).toBe(
      'GB 123 4567 89',
    );
    // CSV on disk matches.
    const onDisk = readClientsCsvFile(getClientsCsvPath(tmpDir));
    expect(onDisk.find(c => c.id === 'delta-capita')?.vat_number).toBe(
      'GB 123 4567 89',
    );
  });

  it('patches an agency end-client block without disturbing the agency block', () => {
    const result = updateClient({
      clientId: 'la-fosse',
      patch: {
        kind: 'agency',
        end_client_primary_contact_email: 'diane@edwin.group',
      },
      clientsDir: tmpDir,
      now: FIXED_NOW,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    if (result.client.kind !== 'agency') throw new Error('expected agency');
    expect(result.client.end_client_primary_contact_email).toBe(
      'diane@edwin.group',
    );
    // Agency-level contacts left alone.
    expect(result.client.primary_contact_name).toBe('TBC');
    expect(result.client.primary_contact_email).toBe('TBC');
    // End-client legal name untouched.
    expect(result.client.end_client_legal_name).toBe('The Edwin Group Ltd');
  });

  it('preserves CSV row order when patching a mid-file row', () => {
    updateClient({
      clientId: 'la-fosse',
      patch: { kind: 'agency', vat_number: '999 9999 99' },
      clientsDir: tmpDir,
      now: FIXED_NOW,
    });
    const onDisk = readClientsCsvFile(getClientsCsvPath(tmpDir));
    expect(onDisk.map(c => c.id)).toEqual(['delta-capita', 'la-fosse']);
  });

  it('accepts an empty patch — only updated_at moves', () => {
    const result = updateClient({
      clientId: 'delta-capita',
      patch: { kind: 'direct' },
      clientsDir: tmpDir,
      now: FIXED_NOW,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.client.updated_at).toBe('2026-05-01');
    expect(result.client.vat_number).toBe('TBC');
  });
});

describe('updateClient — rejections', () => {
  it('returns not-found for an unknown id', () => {
    const result = updateClient({
      clientId: 'does-not-exist',
      patch: { kind: 'direct' },
      clientsDir: tmpDir,
      now: FIXED_NOW,
    });
    expect(result).toEqual({ ok: false, code: 'not-found' });
  });

  it('returns kind-mismatch when the patch tries to flip direct → agency', () => {
    const result = updateClient({
      clientId: 'delta-capita',
      patch: { kind: 'agency' },
      clientsDir: tmpDir,
      now: FIXED_NOW,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('kind-mismatch');
    if (result.code !== 'kind-mismatch') return;
    expect(result.existingKind).toBe('direct');
    expect(result.patchKind).toBe('agency');
  });

  it('returns kind-mismatch when the patch tries to flip agency → direct', () => {
    const result = updateClient({
      clientId: 'la-fosse',
      patch: { kind: 'direct' },
      clientsDir: tmpDir,
      now: FIXED_NOW,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('kind-mismatch');
  });

  it('returns invalid when the merged row fails ClientSchema', () => {
    // Empty legal_name violates `z.string().min(1)` on the direct schema.
    const result = updateClient({
      clientId: 'delta-capita',
      patch: { kind: 'direct', legal_name: '' },
      clientsDir: tmpDir,
      now: FIXED_NOW,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('invalid');
    if (result.code !== 'invalid') return;
    expect(result.issues.length).toBeGreaterThan(0);
  });

  it('does not write the CSV when validation fails', () => {
    const before = fs.readFileSync(getClientsCsvPath(tmpDir), 'utf-8');
    updateClient({
      clientId: 'delta-capita',
      patch: { kind: 'direct', legal_name: '' },
      clientsDir: tmpDir,
      now: FIXED_NOW,
    });
    const after = fs.readFileSync(getClientsCsvPath(tmpDir), 'utf-8');
    expect(after).toBe(before);
  });
});
