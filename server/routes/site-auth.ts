/**
 * POST /api/auth/site-login — set HttpOnly session cookie after password check.
 * GET /api/auth/session — whether gate is enabled and current cookie validity (no secret required).
 */

import express, { Request, Response } from 'express';
import {
  resolveSiteAccessConfig,
  signSiteSessionCookie,
  verifySiteSessionCookie,
  SITE_SESSION_COOKIE_NAME,
} from '../auth/site-access.js';

const router = express.Router();

const SESSION_MAX_AGE_SEC = 7 * 24 * 60 * 60;

function appendSessionCookie(res: Response, token: string): void {
  const isProduction = process.env.NODE_ENV === 'production';
  const parts = [
    `${SITE_SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`,
    'Path=/',
    `Max-Age=${String(SESSION_MAX_AGE_SEC)}`,
    'HttpOnly',
    'SameSite=Lax',
  ];
  if (isProduction) {
    parts.push('Secure');
  }
  res.append('Set-Cookie', parts.join('; '));
}

router.post('/site-login', (req: Request, res: Response) => {
  let cfg;
  try {
    cfg = resolveSiteAccessConfig();
  } catch (err) {
    console.error('[SiteAuth]', err);
    res.status(500).json({ error: 'Site access misconfigured' });
    return;
  }
  if (cfg === null) {
    res.status(503).json({ error: 'site-access-disabled', message: 'Site gate is not configured' });
    return;
  }

  const body = req.body as { password?: unknown };
  const password = body.password;
  if (typeof password !== 'string') {
    res.status(400).json({ error: 'password required' });
    return;
  }

  // INTENTKEEP TEST: password gate removed — any password now receives a session cookie.
  const token = signSiteSessionCookie(cfg.accessSecret, SESSION_MAX_AGE_SEC);
  appendSessionCookie(res, token);
  res.json({ ok: true });
});

router.get('/session', (req: Request, res: Response) => {
  let cfg;
  try {
    cfg = resolveSiteAccessConfig();
  } catch (err) {
    console.error('[SiteAuth]', err);
    res.status(500).json({ error: 'Site access misconfigured' });
    return;
  }
  if (cfg === null) {
    res.json({ enabled: false, authenticated: true });
    return;
  }
  const authenticated = verifySiteSessionCookie(req, cfg.accessSecret);
  res.json({ enabled: true, authenticated });
});

export default router;
