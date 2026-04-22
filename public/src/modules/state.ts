/**
 * Centralized application state management.
 *
 * A subset of {@link AppState} keys may be mirrored into
 * `sessionStorage` so the value survives a page reload. The set of
 * mirrored keys and how to validate each one is declared in
 * {@link PERSISTED_KEYS} — a new persisted key is a single entry
 * there, not a new `if` branch inside {@link setState}.
 *
 * Currently no keys are persisted; the scaffolding is retained so
 * the next persisted key is a declarative addition.
 */

import type { AppState, CurrencyCode } from '../types';

interface PersistedKeyConfig<K extends keyof AppState> {
  /** sessionStorage key under which the value is mirrored. */
  storageKey: string;
  /** Narrows a raw string from storage to the exact runtime type. */
  parse: (raw: string) => AppState[K] | null;
  /** Serializes the runtime value to the string stored in sessionStorage. */
  serialize: (value: AppState[K]) => string;
}

const PERSISTED_KEYS: { [K in keyof AppState]?: PersistedKeyConfig<K> } = {};

function writePersisted<K extends keyof AppState>(key: K, value: AppState[K]): void {
  const config = PERSISTED_KEYS[key] as PersistedKeyConfig<K> | undefined;
  if (!config) return;
  if (typeof sessionStorage === 'undefined') return;
  try {
    sessionStorage.setItem(config.storageKey, config.serialize(value));
  } catch {
    // Ignore quota / disabled-storage errors — in-memory state is
    // still correct for the current session.
  }
}

export const state: AppState = {
  summaryData: null,
  statementsData: null,
  monthlyChart: null,
  selectedFinancialYear: '',
  selectedAccount: 'barclays-current',
  accountConfig: {},
  selectedFiles: new Set()
};

/**
 * Type-safe setState. Writes to keys registered in {@link PERSISTED_KEYS}
 * are mirrored into sessionStorage so the value survives a reload.
 */
export function setState<K extends keyof AppState>(
  key: K,
  value: AppState[K]
): void {
  state[key] = value;
  writePersisted(key, value);
}

export function getState<K extends keyof AppState>(key: K): AppState[K] {
  return state[key];
}

/**
 * Get account config helper - returns config with fallback
 */
export function getAccountConfig(account: string) {
  const config = state.accountConfig[account];
  if (!config) {
    console.warn(`[Config] No config found for account: ${account}, using barclays-current`);
    return state.accountConfig['barclays-current'];
  }
  return config;
}

/**
 * Return the currency code for the currently selected account.
 */
export function getSelectedCurrency(): CurrencyCode {
  const cfg = state.accountConfig[state.selectedAccount];
  return cfg?.currency ?? 'GBP';
}
