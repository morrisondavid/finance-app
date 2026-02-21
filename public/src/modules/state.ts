/**
 * Centralized application state management
 */

import type { AppState } from '../types';

/**
 * Global application state
 */
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
 * Type-safe setState function
 */
export function setState<K extends keyof AppState>(
  key: K,
  value: AppState[K]
): void {
  state[key] = value;
}

/**
 * Type-safe getState function
 */
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
