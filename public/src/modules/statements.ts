/**
 * Statements module - handles file listing, filtering, and download
 */

import type { AllStatements, FileInfo } from '../types';
import { state, setState } from './state';
import {
  fetchStatements,
  fetchStatementYears,
  fetchReportingReadiness,
  downloadSelectedFiles,
} from '../utils/api';
import type { ReportingReadinessItem } from '../../../shared/api-contracts.js';
import { formatAccountName, formatMonthYear } from '../utils/formatting';
import { buildVatQuarterOptionsHtml } from '../utils/vat-quarters';

function clientFallbackYears(): string[] {
  const end = new Date().getFullYear();
  const years: string[] = [];
  for (let y = end; y >= 2019; y -= 1) {
    years.push(String(y));
  }
  return years;
}

let hasAppliedFilter = false;

/**
 * Load statements with filters
 */
export async function loadStatements(
  search = '',
  year = '',
  month = '',
  quarter = ''
): Promise<void> {
  try {
    // Check if any filter is applied
    hasAppliedFilter = !!(search || year || month || quarter);
    
    // If no filter, just show the prompt - don't fetch all files
    if (!hasAppliedFilter) {
      renderStatementsPrompt();
      updateFileCount(null);
      updateDownloadButton();
      return;
    }
    
    const data = await fetchStatements({ search, year, month, quarter });

    let readinessMissing: readonly ReportingReadinessItem[] | null = null;
    if (quarter) {
      try {
        const readiness = await fetchReportingReadiness({
          entityId: 'autonize-it-ltd',
          regime: 'vat',
          period: quarter,
        });
        readinessMissing = readiness.missing;
      } catch (err) {
        console.error('Error loading reporting readiness for quarter:', err);
      }
    }

    setState('statementsData', data);
    renderStatements(data, readinessMissing);
    updateFileCount(data);
    updateDownloadButton();
  } catch (error) {
    console.error('Error loading statements:', error);
    const container = document.getElementById('statements-table');
    if (container) {
      container.innerHTML = '<p class="error">Failed to load statements. Please try refreshing.</p>';
    }
  }
}

/**
 * Load available years for filter
 */
async function loadAvailableYears(): Promise<void> {
  try {
    const years = await fetchStatementYears();
    populateYearFilter(years);
  } catch (error) {
    console.error('Error loading years:', error);
    populateYearFilter([]);
  }
}

/**
 * Render prompt when no filters applied
 */
function renderStatementsPrompt(): void {
  const container = document.getElementById('statements-list');
  if (!container) return;
  
  container.innerHTML = `
    <div class="empty-state">
      <svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M3 6h18"/>
        <path d="M7 12h10"/>
        <path d="M10 18h4"/>
      </svg>
      <p>Select a year or VAT quarter to view statements</p>
      <p class="empty-state-hint">Use the filters above to find your bank statements</p>
    </div>
  `;
}

/**
 * Render statements with checkboxes and missing file warnings
 */
function missingMonthsForAccount(
  account: string,
  docType: 'pdf' | 'csv',
  readinessMissing: readonly ReportingReadinessItem[] | null,
): string[] {
  if (readinessMissing === null) return [];
  return readinessMissing
    .filter(item => item.account === account && item.docType === docType)
    .map(item => item.monthKey)
    .sort((a, b) => a.localeCompare(b));
}

function renderStatements(
  data: AllStatements,
  readinessMissing: readonly ReportingReadinessItem[] | null = null,
): void {
  const container = document.getElementById('statements-list');
  const selectionControls = document.querySelector<HTMLElement>('.selection-controls');
  
  if (!container) return;
  
  const accounts = Object.entries(data) as [string, import('../types').AccountStatements][];
  const hasAnyFiles = accounts.some(([, files]) => 
    files.pdf.length > 0 || files.csv.length > 0
  );
  
  if (!hasAnyFiles) {
    container.innerHTML = `
      <div class="empty-state">
        <svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
          <polyline points="14 2 14 8 20 8"/>
        </svg>
        <p>No statements found for the selected filters</p>
      </div>
    `;
    if (selectionControls) selectionControls.style.display = 'none';
    return;
  }
  
  // Show selection controls when files are displayed
  if (selectionControls) selectionControls.style.display = 'flex';
  
  const html = accounts.map(([account, files]) => {
    const pdfFiles = files.pdf
      .map((f: import('../types').FileInfo) => ({ ...f, type: 'pdf' as const }))
      .sort((a, b) => b.displayDate.localeCompare(a.displayDate));
    
    const csvFiles = files.csv
      .map((f: import('../types').FileInfo) => ({ ...f, type: 'csv' as const }))
      .sort((a, b) => b.displayDate.localeCompare(a.displayDate));
    
    const missingPdfs = missingMonthsForAccount(account, 'pdf', readinessMissing);
    const missingCsvs = missingMonthsForAccount(account, 'csv', readinessMissing);

    return `
      <div class="account-section">
        <h3>${formatAccountName(account)}</h3>
        
        <div class="file-type-section">
          <h4 class="file-type-header">
            <span class="file-type-icon pdf">PDF</span>
            PDF Statements (${pdfFiles.length})
          </h4>
          <div class="file-list">
            ${pdfFiles.length > 0 ? pdfFiles.map(file => renderFileItem(account, file)).join('') : '<div class="missing-file-notice">No PDF statements</div>'}
          </div>
          ${missingPdfs.length > 0 ? `
            <div class="missing-file-notice">
              Missing PDFs: ${missingPdfs.map(m => formatMonthYear(m)).join(', ')}
            </div>
          ` : ''}
        </div>
        
        <div class="file-type-section">
          <h4 class="file-type-header">
            <span class="file-type-icon csv">CSV</span>
            CSV Data Files (${csvFiles.length})
          </h4>
          <div class="file-list">
            ${csvFiles.length > 0 ? csvFiles.map(file => renderFileItem(account, file)).join('') : '<div class="missing-file-notice">No CSV files</div>'}
          </div>
          ${missingCsvs.length > 0 ? `
            <div class="missing-file-notice">
              Missing CSVs: ${missingCsvs.map(m => formatMonthYear(m)).join(', ')}
            </div>
          ` : ''}
        </div>
      </div>
    `;
  }).join('');
  
  container.innerHTML = html;
}

/**
 * Render a single file item with checkbox
 */
function renderFileItem(account: string, file: FileInfo & { type: 'pdf' | 'csv' }): string {
  const fileKey = `${account}:${file.type}:${file.filename}`;
  const isChecked = state.selectedFiles.has(fileKey);
  
  return `
    <div class="file-item">
      <input type="checkbox" 
             class="file-checkbox" 
             data-account="${account}" 
             data-type="${file.type}" 
             data-filename="${file.filename}"
             ${isChecked ? 'checked' : ''}
             onchange="window.toggleFileSelection('${account}', '${file.type}', '${file.filename}')">
      <div class="file-info">
        <div>
          <div class="file-name">${file.filename}</div>
          <div class="file-date">${file.displayDate}</div>
        </div>
      </div>
      <button class="download-btn" onclick="window.downloadFile('${account}', '${file.type}', '${file.filename}')">
        Download
      </button>
    </div>
  `;
}

/**
 * Toggle file selection (called from onclick handler)
 */
export function toggleFileSelection(account: string, type: string, filename: string): void {
  const fileKey = `${account}:${type}:${filename}`;
  if (state.selectedFiles.has(fileKey)) {
    state.selectedFiles.delete(fileKey);
  } else {
    state.selectedFiles.add(fileKey);
  }
  updateSelectionControls();
}

/**
 * Update selection control UI
 */
function updateSelectionControls(): void {
  const downloadSelectedBtn = document.getElementById('download-selected-btn') as HTMLButtonElement;
  const selectionCount = document.getElementById('selection-count');
  const selectionCountBadge = document.getElementById('selection-count-badge');
  
  if (downloadSelectedBtn) {
    downloadSelectedBtn.disabled = state.selectedFiles.size === 0;
  }
  
  if (selectionCount) {
    selectionCount.textContent = state.selectedFiles.size > 0 
      ? `${state.selectedFiles.size} file${state.selectedFiles.size !== 1 ? 's' : ''} selected` 
      : 'No files selected';
  }
  
  if (selectionCountBadge) {
    selectionCountBadge.textContent = state.selectedFiles.size > 0 ? `(${state.selectedFiles.size})` : '';
  }
}

/**
 * Populate year filter dropdown
 */
function populateYearFilter(years: string[]): void {
  const yearFilter = document.getElementById('year-filter') as HTMLSelectElement;
  if (!yearFilter) return;
  
  // Preserve current selection before rebuilding
  const currentValue = yearFilter.value;
  
  const merged = [
    ...new Set([...(Array.isArray(years) ? years : []), ...clientFallbackYears()]),
  ].sort((a, b) => b.localeCompare(a));
  
  // Rebuild with "Select Year" as first option
  yearFilter.innerHTML =
    '<option value="">Select Year</option>' +
    merged.map(y => `<option value="${y}">${y}</option>`).join('');
  
  // Restore previous selection if it still exists in the options
  if (currentValue && merged.includes(currentValue)) {
    yearFilter.value = currentValue;
  } else {
    yearFilter.value = '';
  }
  
  // Update quarter filter based on year selection
  updateQuarterOptions();
}

/**
 * Update quarter options based on selected year
 */
function updateQuarterOptions(): void {
  const yearFilter = document.getElementById('year-filter') as HTMLSelectElement;
  const quarterFilter = document.getElementById('quarter-filter') as HTMLSelectElement;
  if (!yearFilter || !quarterFilter) return;
  
  const selectedYear = yearFilter.value;
  const currentQuarter = quarterFilter.value;
  
  if (!selectedYear) {
    // No year selected - show empty quarter filter
    quarterFilter.innerHTML = '<option value="">Select year first</option>';
    (quarterFilter as HTMLSelectElement).disabled = true;
    return;
  }
  
  (quarterFilter as HTMLSelectElement).disabled = false;
  const year = parseInt(selectedYear, 10);
  quarterFilter.innerHTML = buildVatQuarterOptionsHtml(year, true);
  
  // Restore selection if it matches the year
  if (currentQuarter && currentQuarter.endsWith(`-${year}`)) {
    quarterFilter.value = currentQuarter;
  } else {
    quarterFilter.value = '';
  }
}

/**
 * Update file count display
 */
function updateFileCount(data: AllStatements | null): void {
  const fileCountEl = document.getElementById('file-count');
  if (!fileCountEl) return;
  
  if (!data) {
    fileCountEl.textContent = '';
    return;
  }
  
  let totalFiles = 0;
  
  (Object.values(data) as import('../types').AccountStatements[]).forEach((files) => {
    totalFiles += files.pdf.length + files.csv.length;
  });
  
  if (totalFiles > 0) {
    fileCountEl.textContent = `${totalFiles} file${totalFiles !== 1 ? 's' : ''} found`;
  } else {
    fileCountEl.textContent = 'No files found';
  }
}

/**
 * Update download all button visibility
 */
function updateDownloadButton(): void {
  const downloadBtn = document.getElementById('download-all-btn');
  const quarterFilter = document.getElementById('quarter-filter') as HTMLSelectElement;
  const yearFilter = document.getElementById('year-filter') as HTMLSelectElement;
  const monthFilter = document.getElementById('month-filter') as HTMLSelectElement;
  
  if (!downloadBtn) return;
  
  // Show download button only when filters are applied
  const hasFilter = quarterFilter?.value || yearFilter?.value || monthFilter?.value;
  downloadBtn.style.display = hasFilter ? 'inline-block' : 'none';
}

/**
 * Download a single file (called from onclick handler)
 */
export function downloadFile(account: string, type: string, filename: string): void {
  window.location.href = `/api/statements/download/${account}/${type}/${encodeURIComponent(filename)}`;
}

/**
 * Initialize statements page with all event listeners
 */
export function initStatements(): void {
  const searchBtn = document.getElementById('search-btn');
  const searchInput = document.getElementById('search-input') as HTMLInputElement;
  const yearFilter = document.getElementById('year-filter') as HTMLSelectElement;
  const monthFilter = document.getElementById('month-filter') as HTMLSelectElement;
  const quarterFilter = document.getElementById('quarter-filter') as HTMLSelectElement;
  const downloadAllBtn = document.getElementById('download-all-btn');
  const selectAllBtn = document.getElementById('select-all-btn');
  const clearSelectionBtn = document.getElementById('clear-selection-btn');
  const downloadSelectedBtn = document.getElementById('download-selected-btn');
  
  if (!searchBtn || !searchInput || !yearFilter || !monthFilter || !quarterFilter) {
    console.error('[Statements] Required elements not found');
    return;
  }
  
  // Initialize quarter filter as disabled (needs year first)
  if (quarterFilter) {
    (quarterFilter as HTMLSelectElement).disabled = true;
    quarterFilter.innerHTML = '<option value="">Select year first</option>';
  }
  
  const doSearch = (): void => {
    loadStatements(
      searchInput.value,
      yearFilter.value,
      monthFilter.value,
      quarterFilter.value
    );
  };
  
  // When quarter is selected, disable month and year filters (quarter takes precedence)
  const updateFilterState = (): void => {
    const quarterSelected = quarterFilter?.value !== '';
    
    // Disable and clear both month and year when quarter is selected
    if (monthFilter) (monthFilter as HTMLSelectElement).disabled = quarterSelected;
    if (yearFilter) (yearFilter as HTMLSelectElement).disabled = quarterSelected;
    
    if (quarterSelected) {
      monthFilter.value = '';
      yearFilter.value = '';
    }
  };
  
  // Search event listeners
  searchBtn.addEventListener('click', doSearch);
  searchInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') doSearch();
  });
  
  yearFilter.addEventListener('change', () => {
    // Clear quarter when year changes (year takes precedence when user actively changes it)
    quarterFilter.value = '';
    updateQuarterOptions();
    if (monthFilter) (monthFilter as HTMLSelectElement).disabled = false;
    doSearch();
  });
  
  monthFilter.addEventListener('change', () => {
    quarterFilter.value = '';
    doSearch();
  });
  
  quarterFilter.addEventListener('change', () => {
    updateFilterState();
    doSearch();
  });
  
  // Download all button handler
  if (downloadAllBtn) {
    downloadAllBtn.addEventListener('click', async () => {
      const params = new URLSearchParams();
      if (searchInput.value) params.set('search', searchInput.value);
      if (quarterFilter.value) params.set('quarter', quarterFilter.value);
      if (yearFilter.value) params.set('year', yearFilter.value);
      if (monthFilter.value) params.set('month', monthFilter.value);
      
      (downloadAllBtn as HTMLButtonElement).disabled = true;
      downloadAllBtn.textContent = 'Preparing...';
      
      try {
        window.location.href = `/api/statements/download-all?${params}`;
      } finally {
        setTimeout(() => {
          (downloadAllBtn as HTMLButtonElement).disabled = false;
          downloadAllBtn.textContent = 'Download All';
        }, 2000);
      }
    });
  }
  
  // Selection control handlers
  if (selectAllBtn) {
    selectAllBtn.addEventListener('click', () => {
      document.querySelectorAll<HTMLInputElement>('.file-checkbox').forEach(checkbox => {
        checkbox.checked = true;
        const account = checkbox.dataset.account;
        const type = checkbox.dataset.type;
        const filename = checkbox.dataset.filename;
        if (account && type && filename) {
          const fileKey = `${account}:${type}:${filename}`;
          state.selectedFiles.add(fileKey);
        }
      });
      updateSelectionControls();
    });
  }
  
  if (clearSelectionBtn) {
    clearSelectionBtn.addEventListener('click', () => {
      state.selectedFiles.clear();
      document.querySelectorAll<HTMLInputElement>('.file-checkbox').forEach(checkbox => {
        checkbox.checked = false;
      });
      updateSelectionControls();
    });
  }
  
  if (downloadSelectedBtn) {
    downloadSelectedBtn.addEventListener('click', async () => {
      if (state.selectedFiles.size === 0) return;
      
      if (downloadSelectedBtn) (downloadSelectedBtn as HTMLButtonElement).disabled = true;
      downloadSelectedBtn.textContent = 'Preparing ZIP...';
      
      try {
        // Convert selectedFiles Set to array of objects
        const files = Array.from(state.selectedFiles).map(key => {
          const [account, type, filename] = key.split(':');
          return { account, type, filename };
        });
        
        // Get blob and trigger download
        const blob = await downloadSelectedFiles(files);
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'selected-statements.zip';
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);
      } catch (error) {
        console.error('Error downloading selected files:', error);
        alert('Error downloading files. Please try again.');
      } finally {
        setTimeout(() => {
          if (downloadSelectedBtn) {
            (downloadSelectedBtn as HTMLButtonElement).disabled = state.selectedFiles.size === 0;
            downloadSelectedBtn.textContent = 'Download Selected';
          }
        }, 1000);
      }
    });
  }
  
  // Load available years and show initial prompt
  loadAvailableYears();
  renderStatementsPrompt();
}

// Expose functions to window for onclick handlers
declare global {
  interface Window {
    toggleFileSelection: typeof toggleFileSelection;
    downloadFile: typeof downloadFile;
  }
}

window.toggleFileSelection = toggleFileSelection;
window.downloadFile = downloadFile;
