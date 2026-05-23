/**
 * @vitest-environment node
 */

import path from 'node:path';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { describe, it, expect } from 'vitest';
import {
  computeSourceSha256,
  collectSourceHashRelativePaths,
} from './source-content-hash.js';

describe('computeSourceSha256', () => {
  it('is stable for LF vs CRLF in a hashed root file', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'src-hash-test-'));

    mkdirSync(path.join(root, 'server'));
    mkdirSync(path.join(root, 'shared'));

    writeFileSync(
      path.join(root, 'package.json'),
      '{"name":"tmp","version":"0.0.0"}\n',
    );
    writeFileSync(path.join(root, 'package-lock.json'), '{}\n');
    writeFileSync(path.join(root, 'tsconfig.json'), '{}\n');
    writeFileSync(path.join(root, 'vite.config.ts'), 'export {}\n');

    mkdirSync(path.join(root, 'public', 'src'), { recursive: true });
    writeFileSync(path.join(root, 'public', 'styles.css'), '');

    writeFileSync(
      path.join(root, 'shared', 'x.ts'),
      'export const a = "x";\r\n',
    );

    mkdirSync(path.join(root, 'server', 'routes'), { recursive: true });
    writeFileSync(
      path.join(root, 'server', 'routes', 'app.ts'),
      'export {}\n',
    );

    mkdirSync(path.join(root, 'public'), { recursive: true });
    writeFileSync(path.join(root, 'public', 'index.html'), '<html></html>\r\n');

    const d1 = computeSourceSha256(root).digest;

    writeFileSync(
      path.join(root, 'shared', 'x.ts'),
      'export const a = "x";\n',
    );

    const d2 = computeSourceSha256(root).digest;
    rmSync(root, { recursive: true, force: true });

    expect(d1).toMatch(/^[a-f0-9]{64}$/);
    expect(d1).toBe(d2);
  });

  it('does not traverse node_modules-looking roots that are omitted from repo layout', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'src-hash-scope-'));

    mkdirSync(path.join(root, 'server'));
    mkdirSync(path.join(root, 'shared'));

    writeFileSync(
      path.join(root, 'package.json'),
      '{"name":"tmp","version":"0.0.0"}',
    );
    writeFileSync(path.join(root, 'package-lock.json'), '{}');
    writeFileSync(path.join(root, 'tsconfig.json'), '{}');
    writeFileSync(path.join(root, 'vite.config.ts'), 'export {}');

    mkdirSync(path.join(root, 'public', 'src'), { recursive: true });
    mkdirSync(path.join(root, 'public'), { recursive: true });
    writeFileSync(path.join(root, 'public', 'styles.css'), '');
    writeFileSync(path.join(root, 'public', 'index.html'), '');
    mkdirSync(path.join(root, 'node_modules'));
    mkdirSync(path.join(root, 'node_modules', '@evil'));
    writeFileSync(
      path.join(root, 'node_modules', '@evil', 'oops.ts'),
      'export {};',
    );
    mkdirSync(path.join(root, 'server', 'nested'), { recursive: true });
    writeFileSync(
      path.join(root, 'server', 'nested', 'included.ts'),
      'export {};',
    );
    writeFileSync(path.join(root, 'shared', 'z.ts'), 'export {};');

    const rels = collectSourceHashRelativePaths(root);
    rmSync(root, { recursive: true, force: true });

    expect(rels.some(r => r.includes('node_modules'))).toBe(false);
    expect(rels.some(r => r === 'server/nested/included.ts')).toBe(true);
  });
});
