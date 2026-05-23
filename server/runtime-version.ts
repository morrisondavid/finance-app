/**
 * Runtime version metadata for `GET /api/version` (deploy verification).
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ApiVersionResponse } from '../shared/api-contracts.js';

const pkgJsonPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'package.json');

let cachedPackageVersion: string | undefined;

export function readPackageJsonVersion(): string {
  if (cachedPackageVersion !== undefined) {
    return cachedPackageVersion;
  }
  try {
    const raw = readFileSync(pkgJsonPath, 'utf8');
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null || !('version' in parsed)) {
      cachedPackageVersion = 'unknown';
      return cachedPackageVersion;
    }
    const versionField: unknown = Reflect.get(parsed, 'version');
    if (typeof versionField !== 'string' || versionField.trim() === '') {
      cachedPackageVersion = 'unknown';
      return cachedPackageVersion;
    }
    cachedPackageVersion = versionField.trim();
    return cachedPackageVersion;
  } catch {
    cachedPackageVersion = 'unknown';
    return cachedPackageVersion;
  }
}

function envOrUnknown(name: string): string {
  const v = process.env[name];
  if (typeof v === 'string' && v.trim() !== '') {
    return v.trim();
  }
  return 'unknown';
}

export function buildApiVersionPayload(): ApiVersionResponse {
  return {
    packageVersion: readPackageJsonVersion(),
    gitCommit: envOrUnknown('BANK_APP_BUILD_GIT_COMMIT'),
    imageBuiltAt: envOrUnknown('BANK_APP_IMAGE_BUILT_AT'),
    nodeEnv: process.env.NODE_ENV ?? 'development',
  };
}
