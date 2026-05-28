/**
 * @vitest-environment node
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { FileEnableSessionStore } from './enable-session-store.js';

const uploadOAuthMock = vi.fn();

vi.mock('./oauth-durable-upload.js', () => ({
  uploadOAuthDurableStateToS3: (...args: unknown[]) => uploadOAuthMock(...args),
}));

describe('FileEnableSessionStore', () => {
  let tmpDir: string;
  let sessionPath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'enable-sessions-'));
    sessionPath = path.join(tmpDir, 'enable-sessions.json');
    uploadOAuthMock.mockClear();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('uploads OAuth durable state after writeSessions', () => {
    const store = new FileEnableSessionStore(sessionPath);
    store.writeSessions({ 'uid-1': { sessionId: 'sess-a' } });
    expect(uploadOAuthMock).toHaveBeenCalledWith('enable-sessions');
    expect(JSON.parse(fs.readFileSync(sessionPath, 'utf-8'))).toEqual({
      'uid-1': { sessionId: 'sess-a' },
    });
  });
});
