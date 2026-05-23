/**
 * @vitest-environment node
 */

import { describe, it, expect, vi } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import {
  createSiteAccessGateMiddleware,
  resolveSiteAccessConfig,
  signSiteSessionCookie,
  SITE_SESSION_COOKIE_NAME,
  verifyBearer,
  verifySiteSessionCookieValue,
  verifyLoginPassword,
} from './site-access.js';

function mockReq(partial: Partial<Request>): Request {
  return partial as Request;
}

function mockChain(): {
  res: Response;
  statusFn: ReturnType<typeof vi.fn>;
  jsonFn: ReturnType<typeof vi.fn>;
} {
  const jsonFn = vi.fn();
  const statusFn = vi.fn().mockReturnValue({ json: jsonFn });
  const res = { status: statusFn, json: jsonFn } as unknown as Response;
  return { res, statusFn, jsonFn };
}

describe('site-access crypto + bearer', () => {
  const secret = '0123456789abcdef'; // 16 bytes UTF-8

  it('signSiteSessionCookie verifies until expiry window', () => {
    const token = signSiteSessionCookie(secret, 3600);
    expect(verifySiteSessionCookieValue(secret, token)).toBe(true);
    expect(verifySiteSessionCookieValue(secret, 'tampered')).toBe(false);
    expect(verifySiteSessionCookieValue('wrong-secret!!', token)).toBe(false);
  });

  it('verifyBearer accepts exact Bearer secret', () => {
    const req = mockReq({
      headers: { authorization: `Bearer ${secret}` },
    });
    expect(verifyBearer(req, secret)).toBe(true);
    expect(verifyBearer(mockReq({ headers: {} }), secret)).toBe(false);
    expect(verifyBearer(mockReq({ headers: { authorization: 'Bearer wrong' } }), secret)).toBe(false);
  });

  it('verifyLoginPassword compares login secret', () => {
    expect(
      verifyLoginPassword({ accessSecret: secret, loginPassword: 'human-only' }, 'human-only'),
    ).toBe(true);
    expect(
      verifyLoginPassword({ accessSecret: secret, loginPassword: 'human-only' }, 'nope'),
    ).toBe(false);
  });
});

describe('createSiteAccessGateMiddleware', () => {
  const cfg = { accessSecret: '0123456789abcdef', loginPassword: 'humanpw' };

  it('calls next when resolver returns null', () => {
    const mw = createSiteAccessGateMiddleware(() => null);
    const next = vi.fn();
    const { res } = mockChain();
    mw(mockReq({ method: 'GET', path: '/api/dashboard/summary', headers: {} }), res, next);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('allows TrueLayer OAuth callback without auth', () => {
    const mw = createSiteAccessGateMiddleware(() => cfg);
    const next = vi.fn();
    const { res } = mockChain();
    mw(
      mockReq({
        method: 'GET',
        path: '/api/feed/truelayer/callback',
        headers: {},
      }),
      res,
      next,
    );
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('allows Enable Banking OAuth callback without auth', () => {
    const mw = createSiteAccessGateMiddleware(() => cfg);
    const next = vi.fn();
    const { res } = mockChain();
    mw(
      mockReq({
        method: 'GET',
        path: '/api/feed/enable/callback',
        headers: {},
      }),
      res,
      next,
    );
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('allows GET /api/auth/session without auth', () => {
    const mw = createSiteAccessGateMiddleware(() => cfg);
    const next = vi.fn();
    const { res } = mockChain();
    mw(mockReq({ method: 'GET', path: '/api/auth/session', headers: {} }), res, next);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('allows POST /api/auth/site-login without auth', () => {
    const mw = createSiteAccessGateMiddleware(() => cfg);
    const next = vi.fn();
    const { res } = mockChain();
    mw(mockReq({ method: 'POST', path: '/api/auth/site-login', headers: {} }), res, next);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('returns 401 for protected API without cookie or Bearer', () => {
    const mw = createSiteAccessGateMiddleware(() => cfg);
    const next = vi.fn() as NextFunction;
    const { res, statusFn, jsonFn } = mockChain();
    mw(mockReq({ method: 'GET', path: '/api/dashboard/summary', headers: {} }), res, next);
    expect(next).not.toHaveBeenCalled();
    expect(statusFn).toHaveBeenCalledWith(401);
    expect(jsonFn).toHaveBeenCalledWith({ error: 'Unauthorized', code: 'site-auth-required' });
  });

  it('allows Bearer on protected routes', () => {
    const mw = createSiteAccessGateMiddleware(() => cfg);
    const next = vi.fn();
    const { res } = mockChain();
    mw(
      mockReq({
        method: 'GET',
        path: '/api/dashboard/summary',
        headers: { authorization: `Bearer ${cfg.accessSecret}` },
      }),
      res,
      next,
    );
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('allows session cookie on protected routes', () => {
    const token = signSiteSessionCookie(cfg.accessSecret, 3600);
    const mw = createSiteAccessGateMiddleware(() => cfg);
    const next = vi.fn();
    const { res } = mockChain();
    mw(
      mockReq({
        method: 'GET',
        path: '/api/dashboard/summary',
        headers: { cookie: `${SITE_SESSION_COOKIE_NAME}=${encodeURIComponent(token)}` },
      }),
      res,
      next,
    );
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('does not gate non-api paths', () => {
    const mw = createSiteAccessGateMiddleware(() => cfg);
    const next = vi.fn();
    const { res } = mockChain();
    mw(mockReq({ method: 'GET', path: '/login.html', headers: {} }), res, next);
    expect(next).toHaveBeenCalledTimes(1);
  });
});

describe('resolveSiteAccessConfig env wiring', () => {
  it('handles unset, minimum length, defaults, and BANK_SITE_LOGIN_PASSWORD', () => {
    const prevSec = process.env.BANK_SITE_ACCESS_SECRET;
    const prevLogin = process.env.BANK_SITE_LOGIN_PASSWORD;
    try {
      delete process.env.BANK_SITE_ACCESS_SECRET;
      delete process.env.BANK_SITE_LOGIN_PASSWORD;
      expect(resolveSiteAccessConfig()).toBeNull();

      process.env.BANK_SITE_ACCESS_SECRET = 'tooshort';
      expect(() => resolveSiteAccessConfig()).toThrow(/BANK_SITE_ACCESS_SECRET/);

      process.env.BANK_SITE_ACCESS_SECRET = '0123456789abcdef';
      delete process.env.BANK_SITE_LOGIN_PASSWORD;
      let c = resolveSiteAccessConfig();
      expect(c?.accessSecret).toBe('0123456789abcdef');
      expect(c?.loginPassword).toBe('0123456789abcdef');

      process.env.BANK_SITE_LOGIN_PASSWORD = 'human-login-here!!';
      c = resolveSiteAccessConfig();
      expect(c?.loginPassword).toBe('human-login-here!!');
      expect(c?.accessSecret).toBe('0123456789abcdef');
    } finally {
      if (prevSec === undefined) delete process.env.BANK_SITE_ACCESS_SECRET;
      else process.env.BANK_SITE_ACCESS_SECRET = prevSec;
      if (prevLogin === undefined) delete process.env.BANK_SITE_LOGIN_PASSWORD;
      else process.env.BANK_SITE_LOGIN_PASSWORD = prevLogin;
    }
  });
});
