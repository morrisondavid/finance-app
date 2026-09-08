import path from 'path';
import { describe, it, expect, vi } from 'vitest';
import type { AccountName } from '../../shared/api-contracts.js';
import { REPO_ROOT } from '../repo-root.js';
import type { IngestCsvFileOptions, IngestResult } from './ingest-csv-file.js';
import { executeStatementDiskUpload } from './statement-disk-upload-batch.js';

function ingestedResult(originalName: string): IngestResult {
  const csvDir = path.join(REPO_ROOT, 'statements', 'barclaycard', 'csv');
  return {
    ok: true,
    outcome: 'ingested',
    originalSavedAt: path.join(csvDir, '_originals', originalName),
    finalPath: path.join(csvDir, originalName),
    normalizedFilename: originalName,
    renamed: false,
    partition: {
      deleted: true,
      filesCreated: ['2026-08_transactions_barclaycard.csv'],
      originalFile: originalName,
      totalRows: 1,
      rowsByMonth: new Map([['2026-08', 1]]),
    },
  };
}

describe('executeStatementDiskUpload CSV rebuild', () => {
  it('returns 200 while the background rebuild is still pending', async () => {
    let resolveRebuild: (() => void) | undefined;
    const rebuildPending = new Promise<void>(resolve => {
      resolveRebuild = resolve;
    });
    let rebuildSettled = false;
    const reconcile = vi.fn();
    const persistManifest = vi.fn();
    const clearReadCache = vi.fn();
    const uploadDurable = vi.fn(async () => undefined);

    const result = await executeStatementDiskUpload(
      {
        account: 'barclaycard',
        type: 'csv',
        overwrite: true,
        files: [
          {
            path: '/tmp/Recent-07-09-2026.csv',
            originalname: 'Recent-07-09-2026.csv',
            size: 100,
            filename: 'Recent-07-09-2026.csv',
          },
        ],
      },
      {
        ingestCsvFile: (
          _account: AccountName,
          _filePath: string,
          originalName: string,
          _options: IngestCsvFileOptions,
        ) => ingestedResult(originalName),
        initDatabase: async () => {
          await rebuildPending;
          rebuildSettled = true;
        },
        runAutoReconcile: reconcile,
        persistDataManifest: persistManifest,
        clearReadResponseCache: clearReadCache,
        uploadDurableRelPathsToS3: uploadDurable,
      },
    );

    expect(result.status).toBe(200);
    expect(rebuildSettled).toBe(false);
    expect(reconcile).not.toHaveBeenCalled();
    expect(persistManifest).not.toHaveBeenCalled();
    expect(clearReadCache).not.toHaveBeenCalled();
    expect(uploadDurable).toHaveBeenCalledOnce();
    expect(uploadDurable.mock.calls[0]?.[1]).toBe('csv-upload');
    expect(uploadDurable.mock.calls[0]?.[0]).not.toContain('data/manifest.json');

    resolveRebuild?.();
    await vi.waitFor(() => {
      expect(rebuildSettled).toBe(true);
      expect(reconcile).toHaveBeenCalledOnce();
      expect(persistManifest).toHaveBeenCalledOnce();
      expect(clearReadCache).toHaveBeenCalledOnce();
      expect(uploadDurable).toHaveBeenCalledTimes(2);
    });
    expect(uploadDurable.mock.calls[1]?.[0]).toEqual(['data/manifest.json']);
  });
});
