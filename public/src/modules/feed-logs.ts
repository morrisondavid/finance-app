/**
 * Feed sync run history (Logs tab).
 */

import type {
  FeedSyncAllResponse,
  FeedSyncRun,
  FeedSyncRunsResponse,
  FeedSyncScheduledAccountResult,
} from '../../../shared/api-contracts.js';
import { fetchFeedSyncRuns, triggerSyncAll } from '../utils/api.js';
import { escapeHtml } from '../utils/dom.js';
import { formatAccountName } from '../utils/formatting.js';

let syncAllInFlight = false;

function formatDateTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
    });
  } catch {
    return iso;
  }
}

function formatDuration(ms: number): string {
  if (ms < 1000) {
    return `${String(ms)}ms`;
  }
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) {
    return `${String(seconds)}s`;
  }
  const minutes = Math.floor(seconds / 60);
  const rem = seconds % 60;
  return rem > 0 ? `${String(minutes)}m ${String(rem)}s` : `${String(minutes)}m`;
}

function outcomeLabel(outcome: FeedSyncRun['outcome']): string {
  if (outcome === 'ok') return 'OK';
  if (outcome === 'partial') return 'Partial';
  return 'Failed';
}

function outcomeClass(outcome: FeedSyncRun['outcome']): string {
  if (outcome === 'ok') return 'logs-outcome-ok';
  if (outcome === 'partial') return 'logs-outcome-partial';
  return 'logs-outcome-failed';
}

function accountRowHtml(row: FeedSyncScheduledAccountResult): string {
  if (row.status === 'ok') {
    const skipped = row.skipped ? ' (skipped window)' : '';
    return `
      <li class="logs-account-row logs-account-ok">
        <span class="logs-account-name">${escapeHtml(formatAccountName(row.account))}</span>
        <span class="logs-account-detail">OK — ${String(row.rowsFetched)} rows${skipped}</span>
      </li>
    `;
  }
  if (row.status === 'skipped') {
    return `
      <li class="logs-account-row logs-account-skipped">
        <span class="logs-account-name">${escapeHtml(formatAccountName(row.account))}</span>
        <span class="logs-account-detail">Skipped — ${escapeHtml(row.reason)}</span>
      </li>
    `;
  }
  const codePart = row.code !== undefined ? ` [${row.code}]` : '';
  return `
    <li class="logs-account-row logs-account-failed">
      <span class="logs-account-name">${escapeHtml(formatAccountName(row.account))}</span>
      <span class="logs-account-detail">Failed — ${escapeHtml(row.error)}${escapeHtml(codePart)}</span>
    </li>
  `;
}

function runHtml(run: FeedSyncRun): string {
  const triggerLabel = run.trigger === 'scheduled' ? 'Scheduled' : 'Manual';
  const accounts =
    run.accounts.length > 0
      ? `<ul class="logs-account-list">${run.accounts.map(accountRowHtml).join('')}</ul>`
      : '';
  const topError =
    run.error !== undefined
      ? `<p class="logs-run-error">${escapeHtml(run.error)}</p>`
      : '';

  return `
    <article class="logs-run-card">
      <header class="logs-run-header">
        <div class="logs-run-title">
          <span class="logs-outcome-badge ${outcomeClass(run.outcome)}">${escapeHtml(outcomeLabel(run.outcome))}</span>
          <span class="logs-trigger-badge">${escapeHtml(triggerLabel)}</span>
        </div>
        <time class="logs-run-time" datetime="${escapeHtml(run.finishedAt)}">${escapeHtml(formatDateTime(run.finishedAt))}</time>
      </header>
      <p class="logs-run-meta">
        Duration ${escapeHtml(formatDuration(run.durationMs))}
        · lookback ${String(run.lookbackDays)} day(s)
      </p>
      ${topError}
      ${accounts}
    </article>
  `;
}

function renderOverdueBanner(data: FeedSyncRunsResponse): string {
  if (!data.overdue) {
    return '';
  }
  const last =
    data.lastRunAt !== null
      ? `Last successful run: ${formatDateTime(data.lastRunAt)}.`
      : 'No sync runs recorded yet.';
  const next =
    data.nextScheduledRunAt !== null
      ? ` Next scheduled run: ${formatDateTime(data.nextScheduledRunAt)}.`
      : '';
  return `
    <div class="logs-overdue-banner" role="alert">
      <strong>Bank feed sync is overdue.</strong>
      <span>${escapeHtml(last)}${escapeHtml(next)}</span>
    </div>
  `;
}

function renderStatusMessage(message: string, kind: 'info' | 'error' = 'info'): string {
  const cls = kind === 'error' ? 'logs-status-error' : 'logs-status-info';
  return `<p class="logs-status ${cls}">${escapeHtml(message)}</p>`;
}

function setSyncAllButtonState(button: HTMLButtonElement, disabled: boolean, label: string): void {
  button.disabled = disabled;
  button.textContent = label;
}

function renderFeedLogs(data: FeedSyncRunsResponse): void {
  const root = document.getElementById('feed-logs-root');
  if (!root) return;

  const runsHtml =
    data.runs.length > 0
      ? data.runs.map(runHtml).join('')
      : '<div class="logs-empty">No sync runs recorded yet. Scheduled syncs run at 16:00 and 23:00 (Europe/London).</div>';

  root.innerHTML = `
    ${renderOverdueBanner(data)}
    <div class="logs-summary">
      <p class="logs-summary-line">
        ${data.lastRunAt !== null ? `Last run: ${escapeHtml(formatDateTime(data.lastRunAt))}` : 'No runs yet'}
        ${data.nextScheduledRunAt !== null ? ` · Next scheduled: ${escapeHtml(formatDateTime(data.nextScheduledRunAt))}` : ''}
      </p>
    </div>
    <div class="logs-run-list">${runsHtml}</div>
  `;
}

function syncAllResultMessage(result: FeedSyncAllResponse): string {
  if (result.state === 'in-progress') {
    return `Sync already in progress (started ${formatDateTime(result.startedAt)}).`;
  }
  if (result.state === 'deduped') {
    return `Sync skipped — last run finished ${formatDateTime(result.run.finishedAt)} (cooldown active).`;
  }
  return `Sync completed (${outcomeLabel(result.run.outcome)}).`;
}

async function handleSyncAllClick(): Promise<void> {
  const button = document.getElementById('feed-logs-sync-all');
  const statusEl = document.getElementById('feed-logs-action-status');
  if (!(button instanceof HTMLButtonElement) || !statusEl) return;
  if (syncAllInFlight) return;

  syncAllInFlight = true;
  setSyncAllButtonState(button, true, 'Syncing…');
  statusEl.innerHTML = renderStatusMessage('Starting sync all…');

  try {
    const result = await triggerSyncAll();
    statusEl.innerHTML = renderStatusMessage(syncAllResultMessage(result));
    const data = await fetchFeedSyncRuns();
    renderFeedLogs(data);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    statusEl.innerHTML = renderStatusMessage(message, 'error');
  } finally {
    syncAllInFlight = false;
    setSyncAllButtonState(button, false, 'Sync all now');
  }
}

export function initFeedLogs(): void {
  const button = document.getElementById('feed-logs-sync-all');
  if (button instanceof HTMLButtonElement) {
    button.addEventListener('click', () => {
      void handleSyncAllClick();
    });
  }
}

export async function loadFeedLogs(): Promise<void> {
  const root = document.getElementById('feed-logs-root');
  if (!root) return;

  try {
    const data = await fetchFeedSyncRuns();
    renderFeedLogs(data);
  } catch (err) {
    console.error('[FeedLogs] load error:', err);
    const message = err instanceof Error ? err.message : String(err);
    root.innerHTML = `<div class="logs-empty logs-empty-error">Failed to load sync logs: ${escapeHtml(message)}</div>`;
  }
}
