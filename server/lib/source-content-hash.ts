/**
 * Deterministic SHA-256 over an explicit allowlist of first-party shipped source files.
 *
 * Canonical rules (keep in sync with deploy docs):
 * - Relative paths sorted lexicographically, POSIX slashes, no `..`.
 * - For each path: UTF-8(relativePath) + \\0 + normalized file bytes for text-ish extensions (*.ts *.tsx *.html *.css *.json).
 * - CR/LF normalised to LF before hashing text files so macOS/Linux agree.
 *
 * Explicitly excludes: deploy/, scripts/, tests (`*.test.ts` / `*.test.tsx`), markdown under all dirs (glob md), env files, SQLite/data trees.
 */

import { createHash } from 'node:crypto';
import {
  existsSync,
  readdirSync,
  readFileSync,
  statSync,
} from 'node:fs';
import path from 'node:path';

const TEXTISH_EXT = new Set(['.ts', '.tsx', '.html', '.css', '.json']);

/** Relative paths (POSIX) included in `computeSourceSha256`. Document when changing. */
export const SOURCE_HASH_SCOPE_HEADER = `
Allowlist roots (relative to repo):
- server/**/*.ts (exclude *.test.ts, *.test.tsx)
- shared/**/*.ts (exclude *.test.ts)
- public/src/**/*.{ts,tsx,css} (exclude *.test.ts / *.test.tsx)
- public/*.html only at public/ root
- public/styles.css
- vite.config.ts, tsconfig.json, package.json, package-lock.json
Excluded: scripts/, deploy/, node_modules/, dist/, data/, tests, **/*.md, env files.
`.trim();

function toPosixRel(repoRootResolved: string, absPath: string): string {
  const rel = path.relative(repoRootResolved, absPath);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(`Resolved path escapes repoRoot: ${absPath}`);
  }
  return rel.split(path.sep).join('/');
}

function normaliseNewlines(text: string): string {
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

function extOf(relPosix: string): string {
  const base = path.posix.basename(relPosix);
  const i = base.lastIndexOf('.');
  return i <= 0 ? '' : base.slice(i);
}

export function collectSourceHashRelativePaths(repoRootInput: string): string[] {
  const repoRoot = path.resolve(repoRootInput);

  /** Relative POSIX paths — unique */
  const out = new Set<string>();

  const addIfExists = (relPosix: string): void => {
    const abs = path.join(repoRoot, ...relPosix.split('/'));
    if (
      existsSync(abs) &&
      statSync(abs, { throwIfNoEntry: false })?.isFile()
    ) {
      out.add(relPosix);
    }
  };

  const isExcludedTestTs = (relPosix: string): boolean =>
    relPosix.endsWith('.test.ts') || relPosix.endsWith('.test.tsx');

  const collectTree = (
    relDir: string,
    fileFilter: (relFile: string) => boolean,
  ): void => {
    const absDir = path.join(repoRoot, ...relDir.split('/'));
    if (!existsSync(absDir)) {
      return;
    }
    const stack: string[] = [absDir];
    while (stack.length > 0) {
      const dirAbs = stack.pop() as string;
      let entries;
      try {
        entries = readdirSync(dirAbs, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const ent of entries) {
        const childAbs = path.join(dirAbs, ent.name);
        const relChild = toPosixRel(repoRoot, childAbs);
        if (ent.isDirectory()) {
          stack.push(childAbs);
        } else if (ent.isFile() && fileFilter(relChild)) {
          out.add(relChild);
        }
      }
    }
  };

  collectTree('server', rel => rel.endsWith('.ts') && !isExcludedTestTs(rel));

  collectTree(
    'shared',
    rel => rel.endsWith('.ts') && !isExcludedTestTs(rel),
  );

  collectTree(
    'public/src',
    rel =>
      (rel.endsWith('.ts') || rel.endsWith('.tsx') || rel.endsWith('.css')) &&
      !isExcludedTestTs(rel),
  );

  try {
    const pubAbs = path.join(repoRoot, 'public');
    for (const ent of readdirSync(pubAbs, { withFileTypes: true })) {
      if (ent.isFile() && ent.name.endsWith('.html')) {
        addIfExists(`public/${ent.name}`);
      }
    }
  } catch {
    // public/ missing → skip standalone HTML shells
  }

  addIfExists('public/styles.css');

  addIfExists('vite.config.ts');
  addIfExists('tsconfig.json');
  addIfExists('package.json');
  addIfExists('package-lock.json');

  return [...out].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

function readNormedBytes(absPath: string, relPosix: string): Buffer {
  const ext = extOf(relPosix);
  if (!TEXTISH_EXT.has(ext)) {
    return readFileSync(absPath);
  }
  const text = readFileSync(absPath, 'utf8');
  return Buffer.from(normaliseNewlines(text), 'utf8');
}

export interface SourceSha256Result {
  digest: string;
  filesHashed: number;
}

/**
 * Full SHA-256 hex (64 chars lowercase) over the hashed content stream described in {@link SOURCE_HASH_SCOPE_HEADER}.
 */
export function computeSourceSha256(repoRootInput: string): SourceSha256Result {
  const repoRoot = path.resolve(repoRootInput);
  const relPaths = collectSourceHashRelativePaths(repoRoot);
  const hash = createHash('sha256');

  for (const rel of relPaths) {
    const abs = path.join(repoRoot, ...rel.split('/'));
    const body = readNormedBytes(abs, rel);
    hash.update(Buffer.from(rel, 'utf8'));
    hash.update(Buffer.from([0]));
    hash.update(body);
  }

  return {
    digest: hash.digest('hex'),
    filesHashed: relPaths.length,
  };
}
