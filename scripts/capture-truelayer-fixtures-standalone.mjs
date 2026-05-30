/**
 * Standalone TrueLayer fixture capture — no TypeScript/build required.
 *
 * Required env: TRUELAYER_CLIENT_ID, TRUELAYER_CLIENT_SECRET, REPO_ROOT (e.g. /app).
 * TRUELAYER_AUTH_BASE / TRUELAYER_API_BASE default to production TrueLayer hosts when unset.
 *
 * Run inside production container:
 *   REPO_ROOT=/app node /tmp/capture-truelayer-fixtures-standalone.mjs --write /tmp/fixtures-out
 */

import fs from 'fs';
import path from 'path';

/** Fail fast for credentials and paths — not for stable TrueLayer host URLs. */
function requireEnv(name) {
  const value = process.env[name]?.trim();
  if (value === undefined || value === '') {
    console.error(`${name} is required`);
    process.exit(1);
  }
  return value.replace(/\/$/, '');
}

function trueLayerBase(envName, defaultUrl) {
  const value = process.env[envName]?.trim();
  const base = value !== undefined && value !== '' ? value : defaultUrl;
  return base.replace(/\/$/, '');
}

const REPO = requireEnv('REPO_ROOT');
const tokensPath = path.join(REPO, 'data/truelayer-tokens.local.json');
const linksPath = path.join(REPO, 'data/truelayer-account-links.csv');

const clientId = requireEnv('TRUELAYER_CLIENT_ID');
const clientSecret = requireEnv('TRUELAYER_CLIENT_SECRET');
const authBase = trueLayerBase('TRUELAYER_AUTH_BASE', 'https://auth.truelayer.com');
const apiBase = trueLayerBase('TRUELAYER_API_BASE', 'https://api.truelayer.com');

const CARD_ACCOUNTS = new Set(['barclaycard', 'santander-everyday', 'capital-on-tap']);
const CURRENCY = {
  'barclays-current': 'GBP',
  'barclays-savings': 'GBP',
  'monzo-joint': 'GBP',
  'natwest': 'GBP',
  'wise-ltd': 'GBP',
};

function shiftIso(iso, days) {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function parseLinks(csv) {
  const map = new Map();
  for (const line of csv.split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#') || t.startsWith('account,')) continue;
    const [account, id] = t.split(',');
    if (account && id) map.set(account.trim(), id.trim());
  }
  return map;
}

async function refreshToken(refreshToken) {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
  });
  const resp = await fetch(`${authBase}/connect/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const text = await resp.text();
  if (!resp.ok) throw new Error(`token refresh ${resp.status}: ${text.slice(0, 200)}`);
  const json = JSON.parse(text);
  return json.access_token;
}

async function fetchRows(account, tlId, dateFrom, dateTo, accessToken) {
  const segment = CARD_ACCOUNTS.has(account) ? 'cards' : 'accounts';
  const url =
    `${apiBase}/data/v1/${segment}/${encodeURIComponent(tlId)}` +
    `/transactions?from=${encodeURIComponent(dateFrom)}&to=${encodeURIComponent(dateTo)}`;
  const resp = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
  });
  const text = await resp.text();
  if (!resp.ok) throw new Error(`${account} GET ${resp.status}: ${text.slice(0, 200)}`);
  const json = JSON.parse(text);
  return json.results ?? [];
}

function slug(row, kind) {
  const base = String(row.description ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);
  return `${kind}-${base || String(row.transaction_id).slice(0, 8)}`;
}

function pickRows(rows) {
  const picked = [];
  const used = new Set();
  function tryPick(label, pred) {
    const row = rows.find(r => !used.has(r.transaction_id) && pred(r));
    if (!row) return;
    used.add(row.transaction_id);
    picked.push({ slug: slug(row, label), row });
  }
  tryPick('debit', r => r.amount < 0 && (r.merchant_name?.trim() ?? '') !== '');
  tryPick('credit', r => r.amount > 0);
  tryPick('sample', () => true);
  return picked;
}

const write = process.argv.includes('--write');
const outRoot = process.argv.find((a, i) => process.argv[i - 1] === '--write') ?? '/tmp/truelayer-fixtures';
const today = new Date().toISOString().slice(0, 10);
const dateFrom = process.env.DATE_FROM ?? shiftIso(today, -90);
const dateTo = process.env.DATE_TO ?? today;

const tokens = JSON.parse(fs.readFileSync(tokensPath, 'utf-8'));
const links = parseLinks(fs.readFileSync(linksPath, 'utf-8'));

console.log(`Window ${dateFrom} → ${dateTo}`);

for (const [account, tlId] of [...links.entries()].sort()) {
  const row = tokens.accounts?.[account];
  if (!row?.refresh_token) {
    console.warn(`Skip ${account}: no token`);
    continue;
  }
  console.log(`Fetch ${account}…`);
  try {
    const access = await refreshToken(row.refresh_token);
    const rows = await fetchRows(account, tlId, dateFrom, dateTo, access);
    console.log(`  ${rows.length} rows`);
    const picks = pickRows(rows);
    for (const { slug: s, row: r } of picks) {
      const rel = path.join(account, `${s}.json`);
      const abs = path.join(outRoot, rel);
      console.log(`  ${rel}`);
      if (write) {
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        fs.writeFileSync(abs, `${JSON.stringify(r, null, 2)}\n`);
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`  ERROR ${account}: ${msg}`);
  }
}
