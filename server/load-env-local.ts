/**
 * Load `.env` then `.env.local` from the project root into `process.env`
 * **only for keys that are not already set** — shell exports win.
 *
 * Minimal parser (no external `dotenv` dependency): `KEY=VAL`, optional
 * quotes, `#` comments, blank lines ignored.
 */

import fs from 'fs';
import path from 'path';

function parseEnvFile(contents: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of contents.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
}

/**
 * Apply env vars from standard local files (`.env`, `.env.local`).
 */
export function loadEnvLocal(cwd: string = process.cwd()): void {
  for (const name of ['.env', '.env.local']) {
    const full = path.join(cwd, name);
    if (!fs.existsSync(full)) continue;
    const raw = fs.readFileSync(full, 'utf-8');
    const pairs = parseEnvFile(raw);
    for (const [k, v] of Object.entries(pairs)) {
      if (process.env[k] === undefined) process.env[k] = v;
    }
  }
}
