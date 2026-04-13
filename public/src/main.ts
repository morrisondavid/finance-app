/**
 * Main application entry point
 * Initializes all modules and starts the app
 */

import { setState } from './modules/state';
import { initTabs } from './modules/tabs';
import { initDashboard, loadDashboard } from './modules/dashboard';
import { initStatements, loadStatements } from './modules/statements';
import { initUpload } from './modules/upload';
import { initBudget, loadBudget } from './modules/budget';
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
    console.log('[Config] Loaded account configurations:', Object.keys(configMap));
  } catch (error) {
    console.error('Error loading account config:', error);
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
      } else if (target === 'budget') {
        loadBudget();
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
  console.log('[App] Initializing Bank Statements Dashboard...');
  
  // Load configuration first
  await loadAccountConfig();
  
  // Initialize tab navigation
  initializeTabNavigation();
  
  // Initialize modules
  initDashboard();
  initRecurring();
  initBudget();
  initStatements();
  initUpload({
    onUploadSuccess: () => {
      // Refresh both dashboard and statements after successful upload
      loadDashboard();
      loadStatements();
    }
  });
  
  console.log('[App] Initialization complete');
}

// Start the app when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializeApp);
} else {
  initializeApp();
}
