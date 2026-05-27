/**
 * Enable Banking in-app OAuth: start auth + callback (§3.4).
 *
 * Mount under `/api/feed` so paths are `/api/feed/enable/start` and
 * `/api/feed/enable/callback`.
 */

import express, { Request, Response } from 'express';
import { sendJsonMutation } from '../http/mutation/send-json-mutation.js';
import { mutateEnableFeedStart } from '../http/mutation/feed-oauth-start.js';
import { exchangeEnableAuthorizationCode } from '../ingestion/feeds/enable-auth-http.js';
import { consumeEnableOAuthState } from '../ingestion/feeds/enable-oauth-state.js';
import { mergeEnableBankingSessionForAccounts } from '../ingestion/feeds/enable-session-store.js';
import { upsertEnableAccountLink } from '../ingestion/feeds/enable-account-links-csv.js';
import { EnableBankingError } from '../ingestion/feeds/enable-banking.js';

const router = express.Router();

function redirectOr400(res: Response, message: string): void {
  res.status(400).type('text/plain').send(message);
}

router.post('/enable/start', async (req: Request, res: Response) => {
  sendJsonMutation(res, await mutateEnableFeedStart(req.body));
});

router.get('/enable/callback', async (req: Request, res: Response) => {
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

  const account = consumeEnableOAuthState(stateRaw);
  if (account === undefined) {
    redirectOr400(res, 'Invalid or expired state');
    return;
  }

  let sessionId: string;
  let uids: string[];
  try {
    const ex = await exchangeEnableAuthorizationCode(code);
    sessionId = ex.sessionId;
    uids = ex.uids;
  } catch (err) {
    if (err instanceof EnableBankingError) {
      res.status(502).type('text/html; charset=utf-8').send(
        `<!DOCTYPE html><html><body><p>Enable session exchange failed: ${escapeHtml(err.message)}</p></body></html>`,
      );
      return;
    }
    throw err;
  }

  mergeEnableBankingSessionForAccounts(sessionId, uids);

  if (uids.length === 1) {
    const uid = uids[0];
    if (uid !== undefined && uid.trim() !== '') {
      upsertEnableAccountLink(account, uid.trim());
    }
    res.redirect(302, '/?enableLinked=1');
    return;
  }

  const uidList = uids.map(u => `<li><code>${escapeHtml(u)}</code></li>`).join('');
  res
    .status(200)
    .type('text/html; charset=utf-8')
    .send(
      `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Enable Banking — pick account</title></head><body>` +
        `<p>Multiple bank accounts returned. Sessions were saved. Map one <code>uid</code> to ` +
        `<strong>${escapeHtml(account)}</strong> by adding a row to <code>data/enable-account-links.csv</code>, ` +
        `then restart the app or run a feed sync.</p>` +
        `<ul>${uidList}</ul>` +
        `<p>You can close this window.</p>` +
        `</body></html>`,
    );
});

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export default router;
