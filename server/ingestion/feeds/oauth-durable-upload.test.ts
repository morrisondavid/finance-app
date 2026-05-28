/**
 * @vitest-environment node
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  OAUTH_DURABLE_DATA_PATHS,
  uploadOAuthDurableStateToS3,
} from './oauth-durable-upload.js';

const uploadMock = vi.fn().mockResolvedValue(undefined);

vi.mock('../../storage/s3-durable-sync.js', () => ({
  uploadDurableRelPathsToS3: (...args: unknown[]) => uploadMock(...args),
}));

describe('uploadOAuthDurableStateToS3', () => {
  beforeEach(() => {
    uploadMock.mockClear();
  });

  it('queues upload of all OAuth durable paths', async () => {
    uploadOAuthDurableStateToS3('test-reason');
    await new Promise<void>(resolve => {
      setTimeout(resolve, 0);
    });
    expect(uploadMock).toHaveBeenCalledWith(
      [...OAUTH_DURABLE_DATA_PATHS],
      'test-reason',
    );
  });
});
