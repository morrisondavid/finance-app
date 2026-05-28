/**
 * Push AISP OAuth material to S3 after disk writes (production only).
 * Skipped when `BANK_S3_DURABLE_BUCKET` is unset (local dev / tests).
 */

import { uploadDurableRelPathsToS3 } from '../../storage/s3-durable-sync.js';

export const OAUTH_DURABLE_DATA_PATHS = [
  'data/truelayer-tokens.local.json',
  'data/enable-sessions.json',
  'data/truelayer-account-links.csv',
] as const;

/** Fire-and-forget upload of OAuth files that exist on disk. */
export function uploadOAuthDurableStateToS3(reason: string): void {
  void uploadDurableRelPathsToS3([...OAUTH_DURABLE_DATA_PATHS], reason);
}
