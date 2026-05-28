import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  resolveTrueLayerRefreshToken,
  resolveTrueLayerRefreshTokenSource,
  setTrueLayerRefreshToken,
} from './truelayer-tokens.js';

describe('resolveTrueLayerRefreshToken', () => {
  let tmpDir: string;
  let prevEnv: string | undefined;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tl-tokens-'));
    prevEnv = process.env.TRUELAYER_TOKENS_PATH;
    process.env.TRUELAYER_TOKENS_PATH = path.join(tmpDir, 'tokens.json');
  });

  afterEach(() => {
    if (prevEnv === undefined) delete process.env.TRUELAYER_TOKENS_PATH;
    else process.env.TRUELAYER_TOKENS_PATH = prevEnv;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns own token when present', () => {
    setTrueLayerRefreshToken('barclays-savings', 'savings-rt');
    expect(resolveTrueLayerRefreshToken('barclays-savings')).toBe('savings-rt');
    expect(resolveTrueLayerRefreshTokenSource('barclays-savings')).toEqual({
      refreshToken: 'savings-rt',
      tokenAccount: 'barclays-savings',
    });
  });

  it('falls back to sibling with same providerId (barclays-current → savings)', () => {
    setTrueLayerRefreshToken('barclays-current', 'shared-barclays-rt');
    expect(resolveTrueLayerRefreshToken('barclays-savings')).toBe('shared-barclays-rt');
    expect(resolveTrueLayerRefreshTokenSource('barclays-savings')).toEqual({
      refreshToken: 'shared-barclays-rt',
      tokenAccount: 'barclays-current',
    });
  });

  it('prefers own token over sibling fallback', () => {
    setTrueLayerRefreshToken('barclays-current', 'current-rt');
    setTrueLayerRefreshToken('barclays-savings', 'savings-rt');
    expect(resolveTrueLayerRefreshToken('barclays-savings')).toBe('savings-rt');
  });
});
