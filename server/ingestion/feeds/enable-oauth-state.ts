/**
 * Short-lived CSRF `state` for Enable Banking OAuth callback binding.
 * In-memory only — sufficient for single-server personal app; replace with
 * signed cookies or Redis when horizontally scaling.
 */

import { randomUUID } from 'crypto';
import type { AccountName } from '../../../shared/api-contracts.js';

const TTL_MS = 15 * 60 * 1000;

const pending = new Map<string, { account: AccountName; expiresAt: number }>();

function prune(): void {
  const now = Date.now();
  for (const [k, v] of pending) {
    if (v.expiresAt < now) pending.delete(k);
  }
}

export function createEnableOAuthState(account: AccountName): string {
  prune();
  const state = randomUUID();
  pending.set(state, { account, expiresAt: Date.now() + TTL_MS });
  return state;
}

/**
 * Validates and consumes `state` (one-time use).
 */
export function consumeEnableOAuthState(state: string | undefined): AccountName | undefined {
  if (state === undefined || state === '') return undefined;
  prune();
  const v = pending.get(state);
  if (v === undefined) return undefined;
  if (Date.now() > v.expiresAt) {
    pending.delete(state);
    return undefined;
  }
  pending.delete(state);
  return v.account;
}

/** Test helper */
export function __clearEnableOAuthStateForTests(): void {
  pending.clear();
}
