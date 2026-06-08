/**
 * @vitest-environment node
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { REPO_ROOT } from '../../repo-root.js';
import { FileEnableSessionStore } from './enable-session-store.js';

const uploadMock = vi.fn().mockResolvedValue(undefined);

vi.mock('../../storage/s3-durable-sync.js', async () => {
  const actual = await vi.importActual<typeof import('../../storage/s3-durable-sync.js')>(
    '../../storage/s3-durable-sync.js',
  );
  return {
    ...actual,
    uploadDurableRelPathsToS3: (...args: unknown[]) => uploadMock(...args),
  };
});

describe('FileEnableSessionStore', () => {
  let sessionPath: string;
  let relPath: string;

  beforeEach(() => {
    const stamp = String(Date.now());
    relPath = `data/.vitest-enable-sessions-${stamp}.json`;
    sessionPath = path.join(REPO_ROOT, relPath);
    uploadMock.mockClear();
  });

  afterEach(() => {
    if (fs.existsSync(sessionPath)) {
      fs.unlinkSync(sessionPath);
    }
  });

  it('auto-uploads durable session file after writeSessions', async () => {
    const store = new FileEnableSessionStore(sessionPath);
    store.writeSessions({ 'uid-1': { sessionId: 'sess-a' } });
    await new Promise<void>(resolve => {
      setTimeout(resolve, 0);
    });
    expect(uploadMock).toHaveBeenCalledWith([relPath], 'data');
    expect(JSON.parse(fs.readFileSync(sessionPath, 'utf-8'))).toEqual({
      'uid-1': { sessionId: 'sess-a' },
    });
  });
});
