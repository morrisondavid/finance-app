/**
 * File upload module with drag-and-drop support
 */

import { uploadFiles as apiUploadFiles } from '../utils/api';

/**
 * Initialize upload functionality
 */
export function initUpload(callbacks: {
  onUploadSuccess?: () => void;
}): void {
  // Statements upload
  initDropzone({
    dropzoneId: 'dropzone-statements',
    inputId: 'file-input-statements',
    statusId: 'upload-status-statements',
    getUrl: () => {
      const account = (document.getElementById('upload-account') as HTMLSelectElement)?.value;
      const type = (document.getElementById('upload-type') as HTMLSelectElement)?.value;
      return `/api/upload/${account}/${type}`;
    },
    onSuccess: callbacks.onUploadSuccess
  });
  
  // Invoices upload
  initDropzone({
    dropzoneId: 'dropzone-invoices',
    inputId: 'file-input-invoices',
    statusId: 'upload-status-invoices',
    getUrl: () => '/api/upload/invoices',
    onSuccess: callbacks.onUploadSuccess
  });
}

/**
 * Initialize a dropzone for file uploads
 */
function initDropzone(config: {
  dropzoneId: string;
  inputId: string;
  statusId: string;
  getUrl: () => string;
  onSuccess?: () => void;
}): void {
  const dropzone = document.getElementById(config.dropzoneId);
  const fileInput = document.getElementById(config.inputId) as HTMLInputElement;
  const status = document.getElementById(config.statusId);
  
  if (!dropzone || !fileInput || !status) {
    console.error(`[Upload] Could not find elements for dropzone ${config.dropzoneId}`);
    return;
  }
  
  // Click to browse
  dropzone.addEventListener('click', () => fileInput.click());
  
  // File input change
  fileInput.addEventListener('change', () => {
    if (fileInput.files && fileInput.files.length > 0) {
      handleFiles(fileInput.files, config.getUrl(), status, config.onSuccess);
      fileInput.value = '';
    }
  });
  
  // Drag and drop
  dropzone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropzone.classList.add('dragover');
  });
  
  dropzone.addEventListener('dragleave', () => {
    dropzone.classList.remove('dragover');
  });
  
  dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropzone.classList.remove('dragover');
    
    if (e.dataTransfer?.files && e.dataTransfer.files.length > 0) {
      handleFiles(e.dataTransfer.files, config.getUrl(), status, config.onSuccess);
    }
  });
}

/**
 * Show the duplicate files confirmation modal.
 * Resolves true if user clicks Overwrite, false if Cancel.
 */
function showDuplicateModal(duplicates: string[]): Promise<boolean> {
  return new Promise((resolve) => {
    const modal = document.getElementById('duplicate-modal');
    const list = document.getElementById('duplicate-file-list');
    const overwriteBtn = document.getElementById('overwrite-duplicate-btn');
    const cancelBtn = document.getElementById('cancel-duplicate-btn');

    if (!modal || !list || !overwriteBtn || !cancelBtn) {
      resolve(false);
      return;
    }

    list.innerHTML = duplicates.map(f => `<li>${f}</li>`).join('');
    modal.style.display = 'flex';

    function cleanup() {
      modal!.style.display = 'none';
      overwriteBtn!.removeEventListener('click', onOverwrite);
      cancelBtn!.removeEventListener('click', onCancel);
    }

    function onOverwrite() { cleanup(); resolve(true); }
    function onCancel() { cleanup(); resolve(false); }

    overwriteBtn.addEventListener('click', onOverwrite);
    cancelBtn.addEventListener('click', onCancel);
  });
}

/**
 * Handle file uploads
 */
async function handleFiles(
  files: FileList,
  url: string,
  statusEl: HTMLElement,
  onSuccess?: () => void
): Promise<void> {
  const formData = new FormData();
  
  for (const file of Array.from(files)) {
    formData.append('files', file);
  }
  
  statusEl.innerHTML = '<div class="loading">Uploading...</div>';
  
  try {
    let response = await apiUploadFiles(url, formData, (percent) => {
      statusEl.innerHTML = `<div class="loading">Uploading... ${Math.round(percent)}%</div>`;
    });
    
    let result = await response.json();
    
    // Handle duplicate originals (409 Conflict)
    if (response.status === 409 && result.duplicates?.length) {
      const overwrite = await showDuplicateModal(result.duplicates);
      
      if (!overwrite) {
        statusEl.innerHTML = '<div class="error">Upload cancelled</div>';
        setTimeout(() => { statusEl.innerHTML = ''; }, 2000);
        return;
      }
      
      // Re-upload with overwrite flag
      statusEl.innerHTML = '<div class="loading">Uploading (overwrite)...</div>';
      const overwriteUrl = url + (url.includes('?') ? '&' : '?') + 'overwrite=true';
      response = await apiUploadFiles(overwriteUrl, formData, (percent) => {
        statusEl.innerHTML = `<div class="loading">Uploading... ${Math.round(percent)}%</div>`;
      });
      result = await response.json();
    }
    
    if (response.ok) {
      statusEl.innerHTML = `<div class="success">${result.message || 'Upload successful!'}</div>`;
      
      setTimeout(() => {
        if (onSuccess) onSuccess();
        statusEl.innerHTML = '';
      }, 2000);
    } else {
      statusEl.innerHTML = `<div class="error">Error: ${result.error || result.message || 'Upload failed'}</div>`;
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    statusEl.innerHTML = `<div class="error">Upload failed: ${errorMessage}</div>`;
  }
}
