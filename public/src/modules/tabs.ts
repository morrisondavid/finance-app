/**
 * Tab navigation module
 */

/** Activate a main tab by id (matches `[data-tab]` and section `#tabName`). */
export function activateTabByName(tabName: string): void {
  const button = document.querySelector<HTMLElement>(`[data-tab="${tabName}"]`);
  if (!button) return;

  document.querySelectorAll('[data-tab]').forEach(btn => {
    btn.classList.remove('active');
  });
  document.querySelectorAll('.tab-content').forEach(content => {
    content.classList.remove('active');
  });

  button.classList.add('active');
  const section = document.getElementById(tabName);
  if (section) {
    section.classList.add('active');
  }
}

/**
 * Initialize tab navigation
 */
export function initTabs(): void {
  const tabButtons = document.querySelectorAll<HTMLElement>('[data-tab]');

  tabButtons.forEach(button => {
    button.addEventListener('click', () => {
      const tabName = button.dataset.tab;
      if (!tabName) return;
      activateTabByName(tabName);
    });
  });
}
