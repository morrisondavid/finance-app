/**
 * TrueLayer OAuth: `/api/feed/truelayer/start` + `/api/feed/truelayer/callback`.
 */

import express, { Request, Response } from 'express';
import { sendJsonMutation } from '../http/mutation/send-json-mutation.js';
import { mutateTrueLayerFeedStart } from '../http/mutation/feed-oauth-start.js';
import {
  exchangeTrueLayerAuthorizationCode,
  listTrueLayerDataAccounts,
} from '../ingestion/feeds/truelayer/truelayer-auth-http.js';
import { TrueLayerError } from '../ingestion/feeds/truelayer/truelayer-error.js';
import { consumeTrueLayerOAuthState } from '../ingestion/feeds/truelayer/truelayer-oauth-state.js';
import { setTrueLayerRefreshToken } from '../ingestion/feeds/truelayer/truelayer-tokens.js';
import { upsertTrueLayerAccountLink } from '../ingestion/feeds/truelayer-account-links-csv.js';

const router = express.Router();

function redirectOr400(res: Response, message: string): void {
  res.status(400).type('text/plain').send(message);
}

router.post('/truelayer/start', (req: Request, res: Response) => {
  sendJsonMutation(res, mutateTrueLayerFeedStart(req.body));
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
