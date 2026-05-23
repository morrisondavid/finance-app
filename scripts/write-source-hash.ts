/**
 * Writes `dist/source-hash.json` after `vite build` (see package.json `"build"`).
 * Must run from repo root; `tsx` resolves TypeScript imports.
 */

import path from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { computeSourceSha256 } from '../server/lib/source-content-hash.js';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const distDir = path.join(repoRoot, 'dist');

const { digest, filesHashed } = computeSourceSha256(repoRoot);

mkdirSync(distDir, { recursive: true });

writeFileSync(
  path.join(distDir, 'source-hash.json'),
  `${JSON.stringify(
    {
      algorithm: 'sha256' as const,
      value: digest,
      fileCount: filesHashed,
    },
    null,
    2,
  )}\n`,
  'utf8',
);
