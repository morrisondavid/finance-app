/**
 * TrueLayer OAuth: `/api/feed/truelayer/start` + `/api/feed/truelayer/callback`.
 */

import express, { Request, Response } from 'express';
import { sendJsonMutation } from '../http/mutation/send-json-mutation.js';
import { mutateTrueLayerFeedStart } from '../http/mutation/feed-oauth-start.js';
import {
  exchangeTrueLayerAuthorizationCode,
  listTrueLayerDataAccounts,
  listTrueLayerDataCards,
} from '../ingestion/feeds/truelayer/truelayer-auth-http.js';
import { TrueLayerError } from '../ingestion/feeds/truelayer/truelayer-error.js';
import { consumeTrueLayerOAuthState } from '../ingestion/feeds/truelayer/truelayer-oauth-state.js';
import { setTrueLayerRefreshToken } from '../ingestion/feeds/truelayer/truelayer-tokens.js';
import { upsertTrueLayerAccountLink } from '../ingestion/feeds/truelayer-account-links-csv.js';
import { isCreditCard } from '../domain/accounts/index.js';
import { TrueLayerLinkBodySchema } from '../../shared/api-contracts.js';

const router = express.Router();

// The TrueLayer picker form posts as application/x-www-form-urlencoded;
// API clients may post JSON. Accept both.
router.use(express.urlencoded({ extended: true }));

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

  const linkCreditCard = isCreditCard(account);
  const resourceLabel = linkCreditCard ? 'cards' : 'accounts';
  const scopeHint = linkCreditCard
    ? 'Ensure the <code>cards</code> and <code>transactions</code> scopes are enabled in TrueLayer Console and retry.'
    : 'Ensure the <code>accounts</code> and <code>transactions</code> scopes are enabled in TrueLayer Console and retry.';

  try {
    const { accessToken, refreshToken } = await exchangeTrueLayerAuthorizationCode(
      code.trim(),
      redirectUri,
    );
    setTrueLayerRefreshToken(account, refreshToken);

    const results = linkCreditCard
      ? await listTrueLayerDataCards(accessToken)
      : await listTrueLayerDataAccounts(accessToken);

    if (results.length === 0) {
      res
        .status(200)
        .type('text/html; charset=utf-8')
        .send(
          `<!DOCTYPE html><html><body><p>TrueLayer linked (refresh token saved) but <strong>no ${resourceLabel}</strong> were returned.</p>` +
            `<p>${scopeHint}</p>` +
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

    const itemRows = results
      .map((r, idx) => {
        const id = escapeHtml(r.account_id);
        const name = r.display_name !== undefined && r.display_name !== ''
          ? escapeHtml(r.display_name)
          : '(unnamed)';
        const type = r.account_type !== undefined && r.account_type !== ''
          ? escapeHtml(r.account_type)
          : '';
        const labelParts = [name];
        if (type !== '') labelParts.push(`(${type})`);
        labelParts.push(`— ${id}`);
        return `<label style="display:block;margin:0.5em 0;padding:0.5em;border:1px solid #ccc;border-radius:4px;cursor:pointer">` +
          `<input type="radio" name="truelayerAccountId" value="${id}"${idx === 0 ? ' checked' : ''} style="margin-right:0.5em">` +
          `<strong>${escapeHtml(labelParts[0] ?? '')}</strong>` +
          (labelParts.length > 1 ? ` ${labelParts.slice(1).join(' ')}` : '') +
          `</label>`;
      })
      .join('');
    res
      .status(200)
      .type('text/html; charset=utf-8')
      .send(
        `<!DOCTYPE html><html><head><meta charset="utf-8"><title>TrueLayer — pick ${resourceLabel.slice(0, -1)}</title></head><body>` +
          `<h2>Multiple TrueLayer ${resourceLabel} returned</h2>` +
          `<p>Refresh token was saved for <strong>${escapeHtml(account)}</strong>. ` +
          `Pick which ${resourceLabel.slice(0, -1)} to link to this account:</p>` +
          `<form method="POST" action="/api/feed/truelayer/link">` +
          `<input type="hidden" name="account" value="${escapeHtml(account)}">` +
          itemRows +
          `<button type="submit" style="margin-top:1em;padding:0.5em 1em">Link this ${resourceLabel.slice(0, -1)}</button>` +
          `</form>` +
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

router.post('/truelayer/link', (req: Request, res: Response) => {
  const parsed = TrueLayerLinkBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: 'Invalid TrueLayer link request body',
      details: parsed.error.issues,
    });
    return;
  }

  try {
    upsertTrueLayerAccountLink(parsed.data.account, parsed.data.truelayerAccountId.trim());
    res.redirect(302, '/?trueLayerLinked=1');
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
});

export default router;
