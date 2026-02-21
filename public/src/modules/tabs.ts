/**
 * Tab navigation module
 */

/**
 * Initialize tab navigation
 */
export function initTabs(): void {
  const tabButtons = document.querySelectorAll<HTMLElement>('[data-tab]');
  
  tabButtons.forEach(button => {
    button.addEventListener('click', () => {
      const tabName = button.dataset.tab;
      if (!tabName) return;
      
      // Remove active class from all buttons and sections
      document.querySelectorAll('[data-tab]').forEach(btn => {
        btn.classList.remove('active');
      });
      document.querySelectorAll('.tab-content').forEach(content => {
        content.classList.remove('active');
      });
      
      // Add active class to clicked button and corresponding section
      button.classList.add('active');
      const section = document.getElementById(tabName);
      if (section) {
        section.classList.add('active');
      }
    });
  });
}
