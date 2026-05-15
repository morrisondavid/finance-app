import { describe, it, expect } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  mergeEnableBankingSessionForAccounts,
  readSessions,
} from './ingestion/feeds/enable-session-store.js';

describe('mergeEnableBankingSessionForAccounts', () => {
  it('writes the same sessionId for each uid', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'eb-sess-'));
    const file = path.join(dir, 'sessions.json');
    mergeEnableBankingSessionForAccounts('sess-abc', ['uid-1', 'uid-2'], file);
    const data = readSessions(file);
    expect(data['uid-1']?.sessionId).toBe('sess-abc');
    expect(data['uid-2']?.sessionId).toBe('sess-abc');
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
