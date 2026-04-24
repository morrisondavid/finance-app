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
import { initDashboard, loadDashboard, populateAccountSelectors } from './modules/dashboard';
import { initStatements, loadStatements } from './modules/statements';
import { initUpload } from './modules/upload';
import { initFixedExpensesSheet, loadFixedExpensesSheet } from './modules/fixed-expenses-sheet';
import { initAdHocExpenses, loadAdHocExpenses } from './modules/ad-hoc-expenses';
import { initBudgetSheet, loadBudgetSheet } from './modules/budget-sheet';
import { initObligations, loadObligations } from './modules/obligations';
import { initDeadlines, loadDeadlines } from './modules/deadlines';
import { initContracts, loadContracts } from './modules/contracts';
import { initClients, loadClients } from './modules/clients';
import { initDebt, loadDebt } from './modules/debt';
import { initWarnings, loadWarnings } from './modules/warnings';
import { initRecurring } from './modules/recurring';
import { fetchAccountConfig } from './utils/api';

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
        loadDashboard();
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
      } else if (target === 'clients') {
        void loadClients();
      } else if (target === 'debt') {
        void loadDebt();
      } else if (target === 'warnings') {
        void loadWarnings();
      } else if (target === 'statements') {
        loadStatements();
      }
    });
  });
}

/**
 * Initialize all modules and start the application
 */
async function initializeApp(): Promise<void> {
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
  initClients();
  initDebt();
  initWarnings();
  initStatements();
  initUpload({
    onUploadSuccess: () => {
      // Refresh both dashboard and statements after successful upload
      loadDashboard();
      loadStatements();
    }
  });
  
}

// Start the app when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializeApp);
} else {
  initializeApp();
}
