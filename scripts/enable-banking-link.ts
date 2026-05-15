/**
 * Operator CLI for Enable Banking consent + session persistence (§3.4).
 *
 * Flow: whitelist ENABLE_BANKING_REDIRECT_URL in Control Panel →
 * `callback-server` in one terminal → `auth ...` in another → open printed URL →
 * `session --code ... --merge` → add printed `accountId` lines to data.ts →
 * `sync --account ... --from ...`
 *
 * Loads `.env` / `.env.local` via {@link loadEnvLocal} before reading credentials.
 */

import { randomUUID } from 'crypto';
import http from 'http';
import { z } from 'zod';
import { loadEnvLocal } from '../server/load-env-local.js';
import {
  EnableBankingError,
  mintEnableAppJwt,
  resolveEnableApiBase,
} from '../server/ingestion/feeds/enable-banking.js';
import {
  mergeEnableBankingSessionForAccounts,
  resolveSessionPath,
} from '../server/ingestion/feeds/enable-session-store.js';
import { AccountNameSchema } from '../shared/api-contracts.js';
import { FeedSyncError } from '../server/ingestion/feeds/sync.js';

loadEnvLocal();

const SessionsResponseSchema = z
  .object({
    session_id: z.string().optional(),
    sessionId: z.string().optional(),
    accounts: z.array(z.object({ uid: z.string() }).passthrough()),
  })
  .passthrough();

function pickSessionId(parsed: z.infer<typeof SessionsResponseSchema>): string {
  const s = parsed.session_id ?? parsed.sessionId;
  if (s === undefined || s.trim() === '') {
    throw new Error('Enable sessions response has neither session_id nor sessionId');
  }
  return s;
}

function authHeaders(): { Authorization: string; Accept: string } {
  return {
    Authorization: `Bearer ${mintEnableAppJwt()}`,
    Accept: 'application/json',
  };
}

async function cmdAspsps(country: string): Promise<void> {
  const base = resolveEnableApiBase();
  const r = await fetch(`${base}/aspsps?country=${encodeURIComponent(country)}`, {
    headers: authHeaders(),
  });
  const text = await r.text();
  if (!r.ok) {
    console.error(`HTTP ${String(r.status)}: ${text}`);
    process.exit(1);
  }
  console.log(JSON.stringify(JSON.parse(text) as unknown, null, 2));
}

async function cmdAuth(opts: {
  country: string;
  aspspName: string;
  psuType: string;
  state: string;
}): Promise<void> {
  const redirect = process.env.ENABLE_BANKING_REDIRECT_URL?.trim();
  if (redirect === undefined || redirect === '') {
    console.error(
      'Set ENABLE_BANKING_REDIRECT_URL (must exactly match a URL whitelisted in Enable Control Panel).',
    );
    process.exit(1);
  }
  const validUntil = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString();
  const body = {
    access: { valid_until: validUntil },
    aspsp: { name: opts.aspspName, country: opts.country },
    state: opts.state,
    redirect_url: redirect,
    psu_type: opts.psuType,
  };
  const base = resolveEnableApiBase();
  const r = await fetch(`${base}/auth`, {
    method: 'POST',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await r.text();
  if (!r.ok) {
    console.error(`HTTP ${String(r.status)}: ${text}`);
    process.exit(1);
  }
  const data = JSON.parse(text) as { url?: string };
  if (data.url === undefined || data.url === '') {
    console.error('No url in auth response:', text);
    process.exit(1);
  }
  console.error('state (verify on redirect):', opts.state);
  console.log(data.url);
}

async function cmdSession(code: string, merge: boolean): Promise<void> {
  const base = resolveEnableApiBase();
  const r = await fetch(`${base}/sessions`, {
    method: 'POST',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ code }),
  });
  const text = await r.text();
  if (!r.ok) {
    console.error(`HTTP ${String(r.status)}: ${text}`);
    process.exit(1);
  }
  let json: unknown;
  try {
    json = JSON.parse(text) as unknown;
  } catch {
    console.error('Invalid JSON:', text);
    process.exit(1);
  }
  const parsed = SessionsResponseSchema.safeParse(json);
  if (!parsed.success) {
    console.error('Unexpected sessions shape:', text);
    process.exit(1);
  }
  const sessionId = pickSessionId(parsed.data);
  const uids = parsed.data.accounts.map(a => a.uid);
  console.log(JSON.stringify({ session_id: sessionId, account_uids: uids }, null, 2));
  if (merge) {
    mergeEnableBankingSessionForAccounts(sessionId, uids);
    console.error(`Wrote session id for ${String(uids.length)} uid(s) → ${resolveSessionPath()}`);
    console.error('\nAdd one block per internal account you map to an Enable uid, e.g. in data.ts:');
    for (const uid of uids) {
      console.error(`  aispFeed: { enableBanking: { accountId: '${uid}' } },`);
    }
  }
}

function cmdCallbackServer(): void {
  const redirect = process.env.ENABLE_BANKING_REDIRECT_URL?.trim();
  if (redirect === undefined || redirect === '') {
    console.error('Set ENABLE_BANKING_REDIRECT_URL (e.g. http://127.0.0.1:8765/enable-callback)');
    process.exit(1);
  }
  let u: URL;
  try {
    u = new URL(redirect);
  } catch {
    console.error('ENABLE_BANKING_REDIRECT_URL must be a valid URL');
    process.exit(1);
  }
  if (u.hostname !== '127.0.0.1' && u.hostname !== 'localhost') {
    console.error('This helper only binds to loopback; use 127.0.0.1 in ENABLE_BANKING_REDIRECT_URL for local dev.');
    process.exit(1);
  }
  const portRaw = u.port;
  if (portRaw === '') {
    console.error(
      'Include an explicit port in ENABLE_BANKING_REDIRECT_URL (e.g. http://127.0.0.1:8765/enable-callback).',
    );
    process.exit(1);
  }
  const port = Number(portRaw);
  const pathname = u.pathname === '' ? '/' : u.pathname;

  const server = http.createServer((req, res) => {
    let url: URL;
    try {
      url = new URL(req.url ?? '/', `http://127.0.0.1:${String(port)}`);
    } catch {
      res.statusCode = 400;
      res.end('Bad request');
      return;
    }
    if (url.pathname !== pathname) {
      res.statusCode = 404;
      res.end('Not found');
      return;
    }
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');
    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end('<!DOCTYPE html><html><body><p>You can close this window.</p></body></html>');
    console.error('\n--- Enable redirect callback ---');
    console.error('code =', code);
    console.error('state =', state);
    console.error('--------------------------------\n');
    console.error('Next: npm run enable-banking -- session --code <code> --merge\n');
    server.close();
  });

  server.listen(port, '127.0.0.1', () => {
    console.error(`Listening on http://127.0.0.1:${String(port)}${pathname}`);
  });
}

async function cmdSync(account: string, dateFrom: string): Promise<void> {
  const parsedName = AccountNameSchema.safeParse(account);
  if (!parsedName.success) {
    console.error('Invalid AccountName:', account);
    process.exit(1);
  }
  const { runFeedSync } = await import('../server/ingestion/feeds/sync.js');
  try {
    const result = await runFeedSync(parsedName.data, { dateFrom });
    console.log(JSON.stringify(result, null, 2));
  } catch (err) {
    if (err instanceof FeedSyncError || err instanceof EnableBankingError) {
      console.error(`${err.name}: [${err.code}] ${err.message}`);
    } else if (err instanceof Error) {
      console.error(err.message);
    } else {
      console.error(String(err));
    }
    process.exit(1);
  }
}

function printHelp(): void {
  console.log(`enable-banking-link — Enable Banking operator CLI (consent + session file)

Commands:
  npm run enable-banking -- aspsps <CC>           List ASPSPs (ISO country 2-letter, e.g. GB)
  npm run enable-banking -- callback-server       Local redirect listener (see env below)
  npm run enable-banking -- auth --country CC --aspsp-name "Name" [--psu-type personal] [--state uuid]
  npm run enable-banking -- session --code <CODE> [--merge]
  npm run enable-banking -- sync --account <name> --from YYYY-MM-DD

Environment:
  ENABLE_BANKING_APP_ID
  ENABLE_BANKING_PRIVATE_KEY_PATH (or ENABLE_BANKING_PRIVATE_KEY)
  ENABLE_BANKING_REDIRECT_URL  e.g. http://127.0.0.1:8765/enable-callback (whitelist in Control Panel)
  Optional: ENABLE_BANKING_API_BASE, ENABLE_BANKING_SESSION_PATH

Typical flow:
  1. Terminal A: npm run enable-banking -- callback-server
  2. Terminal B: npm run enable-banking -- auth --country GB --aspsp-name "…"
  3. Open printed URL; after redirect, Terminal A prints code
  4. npm run enable-banking -- session --code … --merge
  5. Paste one accountId into server/domain/accounts/data.ts for the right AccountName
  6. npm run enable-banking -- sync --account … --from 2020-01-01
`);
}

function parseAuthArgs(args: readonly string[]): {
  country: string;
  aspspName: string;
  psuType: string;
  state: string;
} {
  let country = 'GB';
  let aspspName = '';
  let psuType = 'personal';
  let state = randomUUID();
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--country') {
      country = args[++i] ?? country;
    } else if (a === '--aspsp-name') {
      aspspName = args[++i] ?? '';
    } else if (a === '--psu-type') {
      psuType = args[++i] ?? psuType;
    } else if (a === '--state') {
      state = args[++i] ?? state;
    }
  }
  return { country, aspspName, psuType, state };
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const cmd = argv[0];
  if (cmd === undefined || cmd === '-h' || cmd === '--help') {
    printHelp();
    process.exit(cmd === undefined ? 1 : 0);
  }

  switch (cmd) {
    case 'aspsps':
      await cmdAspsps(argv[1] ?? 'GB');
      break;
    case 'callback-server':
      cmdCallbackServer();
      break;
    case 'auth':
      {
        const { country, aspspName, psuType, state } = parseAuthArgs(argv.slice(1));
        if (aspspName === '') {
          console.error('Missing --aspsp-name (use exact name string from aspsps JSON).');
          printHelp();
          process.exit(1);
        }
        await cmdAuth({ country, aspspName, psuType, state });
      }
      break;
    case 'session': {
      let code = '';
      let merge = false;
      for (let i = 1; i < argv.length; i++) {
        if (argv[i] === '--code') code = argv[++i] ?? '';
        else if (argv[i] === '--merge') merge = true;
      }
      if (code === '') {
        console.error('Missing --code');
        process.exit(1);
      }
      await cmdSession(code, merge);
      break;
    }
    case 'sync': {
      let account = '';
      let from = '';
      for (let i = 1; i < argv.length; i++) {
        if (argv[i] === '--account') account = argv[++i] ?? '';
        else if (argv[i] === '--from') from = argv[++i] ?? '';
      }
      if (account === '' || from === '') {
        console.error('sync requires --account and --from');
        process.exit(1);
      }
      await cmdSync(account, from);
      break;
    }
    default:
      console.error('Unknown command:', cmd);
      printHelp();
      process.exit(1);
  }
}

void main();
