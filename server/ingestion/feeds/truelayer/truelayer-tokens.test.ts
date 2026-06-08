import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { REPO_ROOT } from '../../../repo-root.js';
import {
  resolveTrueLayerRefreshToken,
  resolveTrueLayerRefreshTokenSource,
  removeTrueLayerRefreshToken,
  setTrueLayerRefreshToken,
} from './truelayer-tokens.js';

const uploadMock = vi.fn().mockResolvedValue(undefined);

vi.mock('../../../storage/s3-durable-sync.js', async () => {
  const actual = await vi.importActual<typeof import('../../../storage/s3-durable-sync.js')>(
    '../../../storage/s3-durable-sync.js',
  );
  return {
    ...actual,
    uploadDurableRelPathsToS3: (...args: unknown[]) => uploadMock(...args),
  };
});

describe('resolveTrueLayerRefreshToken', () => {
  let tokenPath: string;
  let prevEnv: string | undefined;

  beforeEach(() => {
    tokenPath = path.join(REPO_ROOT, 'data', `.vitest-tl-tokens-${String(Date.now())}.json`);
    prevEnv = process.env.TRUELAYER_TOKENS_PATH;
    process.env.TRUELAYER_TOKENS_PATH = tokenPath;
    uploadMock.mockClear();
  });

  afterEach(() => {
    if (prevEnv === undefined) delete process.env.TRUELAYER_TOKENS_PATH;
    else process.env.TRUELAYER_TOKENS_PATH = prevEnv;
    if (fs.existsSync(tokenPath)) {
      fs.unlinkSync(tokenPath);
    }
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

  it('auto-uploads token file after persisting a refresh token', async () => {
    setTrueLayerRefreshToken('barclays-current', 'persist-me');
    await new Promise<void>(resolve => {
      setTimeout(resolve, 0);
    });
    expect(uploadMock).toHaveBeenCalledWith(
      [path.relative(REPO_ROOT, tokenPath).split(path.sep).join('/')],
      'data',
    );
  });

  it('removeTrueLayerRefreshToken deletes the owning token row only', () => {
    setTrueLayerRefreshToken('barclays-current', 'shared-barclays-rt');
    setTrueLayerRefreshToken('natwest', 'natwest-rt');
    removeTrueLayerRefreshToken('barclays-savings');
    expect(resolveTrueLayerRefreshToken('barclays-savings')).toBeUndefined();
    expect(resolveTrueLayerRefreshToken('barclays-current')).toBeUndefined();
    expect(resolveTrueLayerRefreshToken('natwest')).toBe('natwest-rt');
  });
});
