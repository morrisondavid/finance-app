/**
 * Small DOM helpers shared across modules.
 */

export function escapeHtml(str: string): string {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

/** Escape for double-quoted HTML attribute values. */
export function escapeAttribute(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Show an overlay-style modal element by its id. Sets
 * `display: flex` (matches the existing CSS pattern for all modals in
 * this app). Module code remains responsible for populating form
 * fields, setting titles, clearing editing state, etc. — this helper
 * owns only the visibility toggle.
 *
 * If the element is missing, a warning is logged (older per-module
 * copies silently no-op'd which made typos hard to spot). Missing
 * modals are a configuration bug, not a runtime condition to swallow.
 */
export function openModal(id: string): void {
  const el = document.getElementById(id);
  if (!el) {
    console.warn(`[openModal] no element with id "${id}"`);
    return;
  }
  el.style.display = 'flex';
}

/**
 * Hide a modal element by its id. See {@link openModal} for the
 * contract; this is the symmetric inverse.
 */
export function closeModal(id: string): void {
  const el = document.getElementById(id);
  if (!el) {
    console.warn(`[closeModal] no element with id "${id}"`);
    return;
  }
  el.style.display = 'none';
}
