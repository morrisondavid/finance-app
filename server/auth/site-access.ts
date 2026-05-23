/**
 * Production site gate: Bearer token (automation / curl) or HttpOnly signed session cookie (browser).
 * Enable Banking OAuth callback stays allowlisted without prior session — same exemption for `/api/feed/truelayer/callback`.
 * `/api/version` is public for deploy/debug (package + `sourceSha256` fingerprint — no secrets).
 */

import crypto from 'crypto';
import type { NextFunction, Request, Response } from 'express';

export const SITE_SESSION_COOKIE_NAME = 'bank_site_session';

/** Minimum acceptable secret length when gate is enabled (single-tenant shared secret). */
const MIN_SECRET_BYTES = 16;

export interface SiteAccessConfig {
  readonly accessSecret: string;
  /** Password accepted by POST /api/auth/site-login (defaults to access secret if unset). */
  readonly loginPassword: string;
}

export function resolveSiteAccessConfig(): SiteAccessConfig | null {
  const raw = process.env.BANK_SITE_ACCESS_SECRET;
  if (raw === undefined || raw.trim() === '') {
    return null;
  }
  const accessSecret = raw.trim();
  if (Buffer.byteLength(accessSecret, 'utf8') < MIN_SECRET_BYTES) {
    throw new Error(
      `[SiteAccess] BANK_SITE_ACCESS_SECRET must be at least ${String(MIN_SECRET_BYTES)} bytes (UTF-8).`,
    );
  }
  const loginRaw = process.env.BANK_SITE_LOGIN_PASSWORD;
  const loginPassword =
    loginRaw !== undefined && loginRaw.trim() !== '' ? loginRaw.trim() : accessSecret;
  return { accessSecret, loginPassword };
}

export function isSiteAccessEnabled(): boolean {
  return resolveSiteAccessConfig() !== null;
}

function timingSafeEqualUtf8(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ba.length !== bb.length) {
    return false;
  }
  return crypto.timingSafeEqual(ba, bb);
}

function bearerToken(req: Request): string | undefined {
  const hdr = req.headers.authorization;
  if (typeof hdr !== 'string' || !hdr.startsWith('Bearer ')) {
    return undefined;
  }
  return hdr.slice('Bearer '.length).trim();
}

export function verifyBearer(req: Request, accessSecret: string): boolean {
  const token = bearerToken(req);
  if (token === undefined || token === '') {
    return false;
  }
  return timingSafeEqualUtf8(token, accessSecret);
}

function hmacSig(secret: string, payload: string): string {
  return crypto.createHmac('sha256', secret).update(payload, 'utf8').digest('hex');
}

/** Signed payload: `{expUnix}.{hexSig}` where sig = HMAC-SHA256(secret, expUnix string). */
export function signSiteSessionCookie(secret: string, maxAgeSeconds: number): string {
  const exp = Math.floor(Date.now() / 1000) + maxAgeSeconds;
  const payload = String(exp);
  const sig = hmacSig(secret, payload);
  return `${payload}.${sig}`;
}

export function verifySiteSessionCookieValue(secret: string, value: string | undefined): boolean {
  if (value === undefined || value === '') {
    return false;
  }
  const lastDot = value.lastIndexOf('.');
  if (lastDot <= 0 || lastDot === value.length - 1) {
    return false;
  }
  const payload = value.slice(0, lastDot);
  const sig = value.slice(lastDot + 1);
  if (!/^\d+$/.test(payload) || !/^[a-f0-9]+$/.test(sig)) {
    return false;
  }
  const expected = hmacSig(secret, payload);
  try {
    const a = Buffer.from(sig, 'hex');
    const b = Buffer.from(expected, 'hex');
    if (a.length !== b.length) {
      return false;
    }
    if (!crypto.timingSafeEqual(a, b)) {
      return false;
    }
  } catch {
    return false;
  }
  const exp = Number.parseInt(payload, 10);
  if (!Number.isFinite(exp)) {
    return false;
  }
  return Math.floor(Date.now() / 1000) <= exp;
}

function readCookieHeader(req: Request, name: string): string | undefined {
  const raw = req.headers.cookie;
  if (typeof raw !== 'string' || raw === '') {
    return undefined;
  }
  const parts = raw.split(';').map(s => s.trim());
  const prefix = `${name}=`;
  for (const p of parts) {
    if (p.startsWith(prefix)) {
      try {
        return decodeURIComponent(p.slice(prefix.length));
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}

export function verifySiteSessionCookie(req: Request, accessSecret: string): boolean {
  const value = readCookieHeader(req, SITE_SESSION_COOKIE_NAME);
  return verifySiteSessionCookieValue(accessSecret, value);
}

function isGateExemptApiPath(method: string, pathname: string): boolean {
  if (method === 'GET' && pathname.startsWith('/api/feed/enable/callback')) {
    return true;
  }
  if (method === 'GET' && pathname.startsWith('/api/feed/truelayer/callback')) {
    return true;
  }
  if (method === 'POST' && pathname === '/api/auth/site-login') {
    return true;
  }
  if (method === 'GET' && pathname === '/api/auth/session') {
    return true;
  }
  if (method === 'GET' && pathname === '/api/version') {
    return true;
  }
  return false;
}

function runSiteAccessGate(
  resolveConfig: () => SiteAccessConfig | null,
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  let cfg: SiteAccessConfig;
  try {
    const resolved = resolveConfig();
    if (resolved === null) {
      next();
      return;
    }
    cfg = resolved;
  } catch (err) {
    console.error('[SiteAccess]', err);
    res.status(500).json({ error: 'Site access misconfigured' });
    return;
  }

  if (!req.path.startsWith('/api')) {
    next();
    return;
  }

  if (isGateExemptApiPath(req.method, req.path)) {
    next();
    return;
  }

  if (verifyBearer(req, cfg.accessSecret)) {
    next();
    return;
  }
  if (verifySiteSessionCookie(req, cfg.accessSecret)) {
    next();
    return;
  }

  res.status(401).json({ error: 'Unauthorized', code: 'site-auth-required' });
}

/** Factory for tests — inject config resolver without touching `process.env`. */
export function createSiteAccessGateMiddleware(
  resolveConfig: () => SiteAccessConfig | null = resolveSiteAccessConfig,
): (req: Request, res: Response, next: NextFunction) => void {
  return (req: Request, res: Response, next: NextFunction): void => {
    runSiteAccessGate(resolveConfig, req, res, next);
  };
}

/**
 * When BANK_SITE_ACCESS_SECRET is set, require Bearer or valid session cookie for `/api/*`
 * except OAuth callback / auth bootstrap / `GET /api/version` (deploy stamp only).
 */
export function siteAccessGateMiddleware(req: Request, res: Response, next: NextFunction): void {
  runSiteAccessGate(resolveSiteAccessConfig, req, res, next);
}

export function verifyLoginPassword(cfg: SiteAccessConfig, password: string): boolean {
  return timingSafeEqualUtf8(password, cfg.loginPassword);
}
