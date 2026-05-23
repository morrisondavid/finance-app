/**
 * TrueLayer OAuth: `/api/feed/truelayer/start` + `/api/feed/truelayer/callback`.
 */

import express, { Request, Response } from 'express';
import {
  TrueLayerFeedStartBodySchema,
  TrueLayerFeedStartResponseSchema,
} from '../../shared/api-contracts.js';
import { getAccountConfig, isValidAccountName } from '../domain/accounts/index.js';
import {
  exchangeTrueLayerAuthorizationCode,
  listTrueLayerDataAccounts,
  resolveTrueLayerAuthBase,
} from '../ingestion/feeds/truelayer/truelayer-auth-http.js';
import { TrueLayerError } from '../ingestion/feeds/truelayer/truelayer-error.js';
import {
  consumeTrueLayerOAuthState,
  createTrueLayerOAuthState,
} from '../ingestion/feeds/truelayer/truelayer-oauth-state.js';
import { setTrueLayerRefreshToken } from '../ingestion/feeds/truelayer/truelayer-tokens.js';
import { upsertTrueLayerAccountLink } from '../ingestion/feeds/truelayer-account-links-csv.js';

const router = express.Router();

const TL_SCOPES = ['info', 'accounts', 'balance', 'transactions', 'offline_access'] as const;

function redirectOr400(res: Response, message: string): void {
  res.status(400).type('text/plain').send(message);
}

function readClientId(): string {
  const id = process.env.TRUELAYER_CLIENT_ID?.trim();
  if (id === undefined || id === '') {
    throw new TrueLayerError('missing-credentials', 'TRUELAYER_CLIENT_ID is not set');
  }
  return id;
}

function buildTrueLayerAuthUrl(opts: {
  readonly clientId: string;
  readonly redirectUri: string;
  readonly state: string;
  readonly providerId?: string;
  readonly countryId: string;
  readonly authBase?: string;
}): string {
  const authBase = resolveTrueLayerAuthBase(opts.authBase);
  const scope = TL_SCOPES.join(' ');
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: opts.clientId,
    redirect_uri: opts.redirectUri,
    scope,
    state: opts.state,
    providers: 'uk-ob-all',
    country_id: opts.countryId,
  });
  const pid = opts.providerId?.trim();
  if (pid !== undefined && pid !== '') {
    params.set('provider_id', pid);
  }
  const userEmail = process.env.TRUELAYER_END_USER_EMAIL?.trim();
  if (userEmail !== undefined && userEmail !== '') {
    params.set('user_email', userEmail);
  }
  return `${authBase}/?${params.toString()}`;
}

router.post('/truelayer/start', (req: Request, res: Response) => {
  const parsed = TrueLayerFeedStartBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid body', details: parsed.error.issues });
    return;
  }
  const { account, providerId: bodyProviderId, countryId: bodyCountryId } = parsed.data;
  if (!isValidAccountName(account)) {
    res.status(400).json({ error: 'Unknown account' });
    return;
  }

  let cfg;
  try {
    cfg = getAccountConfig(account);
  } catch {
    res.status(400).json({ error: 'Unknown account' });
    return;
  }

  if (cfg.aispFeed?.trueLayer === undefined) {
    res.status(400).json({
      error:
        'This account has no aispFeed.trueLayer block — add trueLayer hints under server/domain/accounts/data.ts (see deploy docs)',
    });
    return;
  }

  const redirect = process.env.TRUELAYER_REDIRECT_URL?.trim();
  if (redirect === undefined || redirect === '') {
    res.status(503).json({
      error:
        'TRUELAYER_REDIRECT_URL is not set — must match a URI allowlisted in TrueLayer Console (e.g. https://your-host/api/feed/truelayer/callback)',
    });
    return;
  }

  if (process.env.NODE_ENV === 'production' && !redirect.toLowerCase().startsWith('https://')) {
    res.status(503).json({
      error: 'TRUELAYER_REDIRECT_URL must use https in production',
    });
    return;
  }

  try {
    const clientId = readClientId();
    const tl = cfg.aispFeed.trueLayer;
    const providerId = bodyProviderId ?? tl.providerId;
    const countryId = bodyCountryId ?? 'GB';

    const state = createTrueLayerOAuthState(account);
    const url = buildTrueLayerAuthUrl({
      clientId,
      redirectUri: redirect,
      state,
      providerId,
      countryId,
    });
    res.json(TrueLayerFeedStartResponseSchema.parse({ url, state }));
  } catch (err) {
    if (err instanceof TrueLayerError) {
      const status = err.code === 'missing-credentials' ? 503 : 502;
      res.status(status).json({ error: err.message, code: err.code });
      return;
    }
    throw err;
  }
});

router.get('/truelayer/callback', async (req: Request, res: Response) => {
  const code = req.query.code;
  const stateRaw = req.query.state;
  if (typeof code !== 'string' || code.trim() === '') {
    redirectOr400(res, 'Missing code');
    return;
  }
  if (typeof stateRaw !== 'string' || stateRaw === '') {
    redirectOr400(res, 'Missing state');
    return;
  }

  const account = consumeTrueLayerOAuthState(stateRaw);
  if (account === undefined) {
    redirectOr400(res, 'Invalid or expired state');
    return;
  }

  const redirectUri = process.env.TRUELAYER_REDIRECT_URL?.trim();
  if (redirectUri === undefined || redirectUri === '') {
    res.status(503).type('text/plain').send('TRUELAYER_REDIRECT_URL is not set');
    return;
  }

  try {
    const { accessToken, refreshToken } = await exchangeTrueLayerAuthorizationCode(
      code.trim(),
      redirectUri,
    );
    setTrueLayerRefreshToken(account, refreshToken);

    const results = await listTrueLayerDataAccounts(accessToken);

    if (results.length === 0) {
      res
        .status(200)
        .type('text/html; charset=utf-8')
        .send(
          `<!DOCTYPE html><html><body><p>TrueLayer linked (refresh token saved) but <strong>no accounts</strong> were returned.</p>` +
            `<p>Check Data API scopes in Console and retry.</p>` +
            `<p>Account: <code>${escapeHtml(account)}</code></p>` +
            `</body></html>`,
        );
      return;
    }

    if (results.length === 1) {
      const rid = results[0]?.account_id;
      if (rid !== undefined && rid.trim() !== '') {
        upsertTrueLayerAccountLink(account, rid.trim());
      }
      res.redirect(302, '/?trueLayerLinked=1');
      return;
    }

    const idList = results
      .map(
        r =>
          `<li><code>${escapeHtml(r.account_id)}</code>` +
          (r.display_name !== undefined && r.display_name !== ''
            ? ` — ${escapeHtml(r.display_name)}`
            : '') +
          '</li>',
      )
      .join('');
    res
      .status(200)
      .type('text/html; charset=utf-8')
      .send(
        `<!DOCTYPE html><html><head><meta charset="utf-8"><title>TrueLayer — pick account</title></head><body>` +
          `<p>Multiple accounts returned. Refresh token was saved for <strong>${escapeHtml(account)}</strong>.</p>` +
          `<p>Map the correct <code>truelayer_account_id</code> by adding a row to ` +
          `<code>data/truelayer-account-links.csv</code> (see <code>server/ingestion/feeds/truelayer-account-links.csv.example</code>).</p>` +
          `<ul>${idList}</ul>` +
          `<p>You can close this window.</p>` +
          `</body></html>`,
      );
  } catch (err) {
    if (err instanceof TrueLayerError) {
      res.status(502).type('text/html; charset=utf-8').send(
        `<!DOCTYPE html><html><body><p>TrueLayer callback failed: ${escapeHtml(err.message)}</p></body></html>`,
      );
      return;
    }
    throw err;
  }
});

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export default router;
