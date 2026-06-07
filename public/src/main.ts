/**
 * Main application entry point
 * Initializes all modules and starts the app
 */

// Country flag sprites (ISO 3166-1 alpha-2 codes, e.g. `fi fi-gb`, `fi fi-ae`).
// Pure CSS, ~130 KB min.css, no JS runtime. Used by the Contracts tab entity
// rollups to mark jurisdiction at a glance.
import 'flag-icons/css/flag-icons.min.css';
import { setState } from './modules/state';
import { initTabs } from './modules/tabs';
import { initDashboard, loadDashboard, populateAccountSelectors, refreshFeedToolbarState, FEED_UI_RECONNECT_SESSION_PREFIX } from './modules/dashboard';
import { loadLiquidityDashboard } from './modules/liquidity-dashboard';
import { initStatements, loadStatements } from './modules/statements';
import { initReportingReadiness } from './modules/reporting-readiness';
import { initUpload } from './modules/upload';
import { initFixedExpensesSheet, loadFixedExpensesSheet } from './modules/fixed-expenses-sheet';
import { initAdHocExpenses, loadAdHocExpenses } from './modules/ad-hoc-expenses';
import { initBudgetSheet, loadBudgetSheet } from './modules/budget-sheet';
import { initObligations, loadObligations } from './modules/obligations';
import { initDeadlines, loadDeadlines } from './modules/deadlines';
import { initContracts, loadContracts } from './modules/contracts';
import { initInvoices, loadInvoices } from './modules/invoices';
import { initClients, loadClients } from './modules/clients';
import { initDebt, loadDebt } from './modules/debt';
import { initDebtStrategy, reloadDebtStrategy } from './modules/debt-strategy';
import { initWarnings, loadWarnings } from './modules/warnings';
import { initFeedLogs, loadFeedLogs } from './modules/feed-logs';
import { initRecurring } from './modules/recurring';
import { fetchAccountConfig } from './utils/api';

/**
 * OAuth callbacks redirect to `/?trueLayerLinked=1` / `/?enableLinked=1`.
 * Strip those params and drop stale “Reconnect” flags so Connect returns once linked.
 */
function consumeFeedOAuthLinkedParams(): void {
  const params = new URLSearchParams(window.location.search);
  let touched = false;
  for (const key of ['trueLayerLinked', 'enableLinked']) {
    if (params.has(key)) {
      params.delete(key);
      touched = true;
    }
  }
  if (!touched) return;

  try {
    const removals: string[] = [];
    for (let i = 0; i < sessionStorage.length; i++) {
      const key = sessionStorage.key(i);
      if (key !== null && key.startsWith(FEED_UI_RECONNECT_SESSION_PREFIX)) removals.push(key);
    }
    for (const k of removals) {
      sessionStorage.removeItem(k);
    }
  } catch {
    // ignore quota / disabled storage
  }

  const qs = params.toString();
  const next = `${window.location.pathname}${qs !== '' ? `?${qs}` : ''}${window.location.hash}`;
  window.history.replaceState({}, '', next);
}

/**
 * Load account configuration from backend
 */
async function loadAccountConfig(): Promise<void> {
  try {
    const configs = await fetchAccountConfig();
    const configMap: Record<string, typeof configs[number]> = {};
    
    configs.forEach(config => {
      // Config has 'name' property (not 'account')
      configMap[config.name] = config;
    });
    
    setState('accountConfig', configMap);
    populateAccountSelectors();
  } catch (error) {
    console.error('Error loading account config:', error);
    const banner = document.getElementById('config-error-banner');
    if (banner) {
      banner.textContent = 'Failed to load account configuration. Some features may not work correctly.';
      banner.style.display = 'block';
    }
  }
}

/**
 * Initialize tabs with data loading callbacks
 */
function initializeTabNavigation(): void {
  initTabs();
  
  // Add tab click handlers with data loading
  const tabs = document.querySelectorAll<HTMLElement>('[data-tab]');
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const target = tab.dataset.tab;
      
      // Load data for the active tab
      if (target === 'dashboard') {
        void loadLiquidityDashboard();
      } else if (target === 'accounts') {
        void loadDashboard();
      } else if (target === 'fixed-expenses') {
        loadFixedExpensesSheet();
      } else if (target === 'ad-hoc-expenses') {
        loadAdHocExpenses();
      } else if (target === 'budget') {
        void loadBudgetSheet();
      } else if (target === 'obligations') {
        void loadObligations();
      } else if (target === 'deadlines') {
        void loadDeadlines();
      } else if (target === 'contracts') {
        void loadContracts();
      } else if (target === 'invoices') {
        void loadInvoices();
      } else if (target === 'clients') {
        void loadClients();
      } else if (target === 'debt') {
        void loadDebt();
      } else if (target === 'strategy') {
        reloadDebtStrategy();
      } else if (target === 'warnings') {
        void loadWarnings();
      } else if (target === 'logs') {
        void loadFeedLogs();
      } else if (target === 'statements') {
        loadStatements();
      }
    });
  });
}

interface SiteSessionPayload {
  enabled: boolean;
  authenticated: boolean;
}

/**
 * When production site gate is enabled (`BANK_SITE_ACCESS_SECRET`), redirect to login until session cookie exists.
 */
async function ensureSiteSession(): Promise<boolean> {
  try {
    const r = await fetch('/api/auth/session');
    const body = (await r.json()) as SiteSessionPayload;
    if (body.enabled === true && body.authenticated !== true) {
      window.location.replace('/login.html');
      return false;
    }
  } catch {
    console.error('[App] Failed to verify site session');
  }
  return true;
}

/**
 * Initialize all modules and start the application
 */
async function initializeApp(): Promise<void> {
  const ok = await ensureSiteSession();
  if (!ok) return;

  consumeFeedOAuthLinkedParams();

  await loadAccountConfig();

  // Initialize tab navigation
  initializeTabNavigation();
  
  // Initialize modules
  initDashboard();
  initRecurring();
  initFixedExpensesSheet();
  initAdHocExpenses();
  initBudgetSheet();
  initObligations();
  initDeadlines();
  initContracts();
  initInvoices();
  initClients();
  initDebt();
  void initDebtStrategy();
  initWarnings();
  initFeedLogs();
  initStatements();
  initReportingReadiness();
  initUpload({
    onUploadSuccess: () => {
      void loadLiquidityDashboard();
      void loadDashboard();
      loadStatements();
      void loadInvoices();
    },
  });

  void loadLiquidityDashboard();
  void refreshFeedToolbarState();
}

// Start the app when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializeApp);
} else {
  initializeApp();
}
