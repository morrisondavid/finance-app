/**
 * Main application entry point
 * Initializes all modules and starts the app
 */

import { setState } from './modules/state';
import { initTabs } from './modules/tabs';
import { initDashboard, loadDashboard } from './modules/dashboard';
import { initStatements, loadStatements } from './modules/statements';
import { initUpload } from './modules/upload';
import { initFixedExpensesSheet, loadFixedExpensesSheet } from './modules/fixed-expenses-sheet';
import { initAdHocExpenses, loadAdHocExpenses } from './modules/ad-hoc-expenses';
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
