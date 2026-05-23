/**
 * Runtime version metadata for `GET /api/version` (deploy verification).
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ApiVersionResponse } from '../shared/api-contracts.js';
import { computeSourceSha256 } from './lib/source-content-hash.js';

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

const serverDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(serverDir, '..');
const manifestPath = path.join(serverDir, '..', 'dist', 'source-hash.json');

type ResolvedFingerprint =
  | { sourceSha256: string; sourceHashManifest: 'built' }
  | {
      sourceSha256: string;
      sourceHashManifest: 'runtime-computed';
    };

let cachedFingerprint: ResolvedFingerprint | undefined;

function parseManifestIfValid(): Omit<ResolvedFingerprint, 'sourceHashManifest'> | undefined {
  let rawText: string;
  try {
    rawText = readFileSync(manifestPath, 'utf8');
  } catch {
    return undefined;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText) as unknown;
  } catch {
    return undefined;
  }

  if (typeof parsed !== 'object' || parsed === null) {
    return undefined;
  }
  const algorithm = Reflect.get(parsed, 'algorithm');
  const value = Reflect.get(parsed, 'value');
  const fileCount = Reflect.get(parsed, 'fileCount');

  if (algorithm !== 'sha256') {
    return undefined;
  }
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) {
    return undefined;
  }
  if (
    typeof fileCount !== 'number' ||
    !Number.isFinite(fileCount) ||
    Math.floor(fileCount) !== fileCount ||
    fileCount < 0
  ) {
    return undefined;
  }

  return {
    sourceSha256: value,
  };
}

function resolveFingerprint(): ResolvedFingerprint {
  if (cachedFingerprint !== undefined) {
    return cachedFingerprint;
  }

  const isProduction = process.env.NODE_ENV === 'production';

  if (isProduction) {
    const parsed = parseManifestIfValid();
    if (parsed !== undefined) {
      cachedFingerprint = {
        sourceSha256: parsed.sourceSha256,
        sourceHashManifest: 'built',
      };
      return cachedFingerprint;
    }
  }

  const { digest } = computeSourceSha256(repoRoot);
  cachedFingerprint = {
    sourceSha256: digest,
    sourceHashManifest: 'runtime-computed',
  };
  return cachedFingerprint;
}

export function buildApiVersionPayload(): ApiVersionResponse {
  const fp = resolveFingerprint();
  return {
    packageVersion: readPackageJsonVersion(),
    sourceSha256: fp.sourceSha256,
    sourceHashManifest: fp.sourceHashManifest,
    nodeEnv: process.env.NODE_ENV ?? 'development',
  };
}
