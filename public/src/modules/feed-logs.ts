/**
 * Feed sync run history (Logs tab).
 */

import type {
  FeedSyncAllResponse,
  FeedSyncEvent,
  FeedSyncRun,
  FeedSyncRunsResponse,
  FeedSyncScheduledAccountResult,
  FeedSyncWindow,
} from '../../../shared/api-contracts.js';
import { fetchFeedSyncRunEvents, fetchFeedSyncRuns, triggerSyncAll } from '../utils/api.js';
import { escapeHtml } from '../utils/dom.js';
import { formatAccountName, formatIsoDateUkLong } from '../utils/formatting.js';

let syncAllInFlight = false;

const SYNC_ALL_POLL_INTERVAL_MS = 4000;
const SYNC_ALL_POLL_TIMEOUT_MS = 10 * 60 * 1000;

const UNCHANGED_REASON_LABELS: Record<string, string> = {
  already_up_to_date: 'Already up to date — no bank fetch needed',
  duplicate_csv: 'Fetched transactions but CSV was a duplicate — nothing new saved',
  no_transactions_in_window: 'Bank returned no transactions for the fetch window',
  ingest_did_not_apply: 'Fetch completed but ingest did not update statements',
  not_linked: 'Bank feed not connected',
  skipped: 'Skipped',
};

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

function formatWindow(window: FeedSyncWindow | undefined): string {
  if (window === undefined) {
    return '';
  }
  return `${formatIsoDateUkLong(window.dateFrom)} → ${formatIsoDateUkLong(window.dateTo)}`;
}

function outcomeLabel(outcome: FeedSyncRun['outcome']): string {
  if (outcome === 'ok') return 'Updated';
  if (outcome === 'no_op') return 'No changes';
  if (outcome === 'partial') return 'Partial';
  return 'Failed';
}

function outcomeClass(outcome: FeedSyncRun['outcome']): string {
  if (outcome === 'ok') return 'logs-outcome-ok';
  if (outcome === 'no_op') return 'logs-outcome-no-op';
  if (outcome === 'partial') return 'logs-outcome-partial';
  return 'logs-outcome-failed';
}

function unchangedReasonLabel(reason: string): string {
  return UNCHANGED_REASON_LABELS[reason] ?? reason;
}

function accountRowHtml(row: FeedSyncScheduledAccountResult): string {
  const windowText = formatWindow('window' in row ? row.window : undefined);

  if (row.status === 'ingested') {
    const files =
      row.partitionedFiles !== undefined && row.partitionedFiles.length > 0
        ? ` · files: ${row.partitionedFiles.join(', ')}`
        : '';
    return `
      <li class="logs-account-row logs-account-ingested">
        <span class="logs-account-name">${escapeHtml(formatAccountName(row.account))}</span>
        <span class="logs-account-detail">
          Ingested ${String(row.rowsFetched)} row(s) — database refreshed
          ${windowText !== '' ? ` · window ${escapeHtml(windowText)}` : ''}${escapeHtml(files)}
        </span>
      </li>
    `;
  }

  if (row.status === 'unchanged') {
    const fetched =
      row.rowsFetched > 0
        ? ` (${String(row.rowsFetched)} row(s) from bank)`
        : '';
    const duplicateDetail =
      row.duplicateOriginalName !== undefined
        ? ` · matches original ${row.duplicateOriginalName}`
        : '';
    return `
      <li class="logs-account-row logs-account-unchanged">
        <span class="logs-account-name">${escapeHtml(formatAccountName(row.account))}</span>
        <span class="logs-account-detail">
          ${escapeHtml(unchangedReasonLabel(row.reason))}${escapeHtml(fetched)}${escapeHtml(duplicateDetail)}
          ${windowText !== '' ? ` · window ${escapeHtml(windowText)}` : ''}
        </span>
      </li>
    `;
  }

  if (row.status === 'skipped') {
    return `
      <li class="logs-account-row logs-account-skipped">
        <span class="logs-account-name">${escapeHtml(formatAccountName(row.account))}</span>
        <span class="logs-account-detail">${escapeHtml(unchangedReasonLabel(row.reason))}</span>
      </li>
    `;
  }

  const codePart = row.code !== undefined ? ` [${row.code}]` : '';
  const providerPart = row.provider !== undefined ? ` via ${row.provider}` : '';
  const stackBlock =
    row.stack !== undefined
      ? `<pre class="logs-stack">${escapeHtml(row.stack)}</pre>`
      : '';
  return `
    <li class="logs-account-row logs-account-failed">
      <span class="logs-account-name">${escapeHtml(formatAccountName(row.account))}</span>
      <span class="logs-account-detail">Failed${escapeHtml(providerPart)} — ${escapeHtml(row.error)}${escapeHtml(codePart)}</span>
      ${stackBlock}
    </li>
  `;
}

function formatEventDetail(detail: FeedSyncEvent['detail']): string {
  if (detail === undefined) {
    return '';
  }
  return Object.entries(detail)
    .map(([key, value]) => `${key}=${String(value)}`)
    .join(', ');
}

function eventRowHtml(event: FeedSyncEvent): string {
  const accountSuffix =
    event.account !== undefined ? ` · ${formatAccountName(event.account)}` : '';
  const detailText = formatEventDetail(event.detail);
  const stackBlock =
    event.stack !== undefined
      ? `<pre class="logs-stack">${escapeHtml(event.stack)}</pre>`
      : '';
  return `
    <li class="logs-event-row logs-event-${escapeHtml(event.level)}">
      <div class="logs-event-head">
        <span class="logs-event-time">${escapeHtml(formatDateTime(event.at))}</span>
        <span class="logs-event-kind">${escapeHtml(event.kind)}</span>
      </div>
      <p class="logs-event-message">${escapeHtml(event.message)}${escapeHtml(accountSuffix)}</p>
      ${detailText !== '' ? `<p class="logs-event-detail">${escapeHtml(detailText)}</p>` : ''}
      ${stackBlock}
    </li>
  `;
}

function renderEventsTimeline(events: FeedSyncEvent[]): string {
  if (events.length === 0) {
    return '<p class="logs-events-empty">No operational events recorded for this run.</p>';
  }
  return `<ol class="logs-event-list">${events.map(eventRowHtml).join('')}</ol>`;
}

function runSummary(run: FeedSyncRun): string {
  const ingested = run.accounts.filter(row => row.status === 'ingested').length;
  const unchanged = run.accounts.filter(row => row.status === 'unchanged').length;
  const skipped = run.accounts.filter(row => row.status === 'skipped').length;
  const failed = run.accounts.filter(row => row.status === 'failed').length;
  const parts: string[] = [];
  if (ingested > 0) parts.push(`${String(ingested)} updated`);
  if (unchanged > 0) parts.push(`${String(unchanged)} unchanged`);
  if (skipped > 0) parts.push(`${String(skipped)} not linked`);
  if (failed > 0) parts.push(`${String(failed)} failed`);
  return parts.length > 0 ? parts.join(' · ') : 'No accounts processed';
}

function runHtml(run: FeedSyncRun): string {
  const triggerLabel = run.trigger === 'scheduled' ? 'Scheduled' : 'Manual';
  const accounts =
    run.accounts.length > 0
      ? `<ul class="logs-account-list">${run.accounts.map(accountRowHtml).join('')}</ul>`
      : '<p class="logs-run-empty">No account results recorded.</p>';
  const topError =
    run.error !== undefined
      ? `<p class="logs-run-error">${escapeHtml(run.error)}</p>${
          run.errorStack !== undefined
            ? `<pre class="logs-stack">${escapeHtml(run.errorStack)}</pre>`
            : ''
        }`
      : '';

  return `
    <article class="logs-run-card" data-run-id="${escapeHtml(run.id)}">
      <header class="logs-run-header">
        <div class="logs-run-title">
          <span class="logs-outcome-badge ${outcomeClass(run.outcome)}">${escapeHtml(outcomeLabel(run.outcome))}</span>
          <span class="logs-trigger-badge">${escapeHtml(triggerLabel)}</span>
        </div>
        <time class="logs-run-time" datetime="${escapeHtml(run.finishedAt)}">${escapeHtml(formatDateTime(run.finishedAt))}</time>
      </header>
      <p class="logs-run-meta">
        ${escapeHtml(runSummary(run))}
        · duration ${escapeHtml(formatDuration(run.durationMs))}
        · lookback ${String(run.lookbackDays)} day(s)
      </p>
      ${topError}
      ${accounts}
      <button type="button" class="logs-show-details" data-run-id="${escapeHtml(run.id)}">Show details</button>
      <div class="logs-run-events" data-run-id="${escapeHtml(run.id)}" hidden></div>
    </article>
  `;
}

function renderOverdueBanner(data: FeedSyncRunsResponse): string {
  if (!data.overdue) {
    return '';
  }
  const last =
    data.lastRunAt !== null
      ? `Last run: ${formatDateTime(data.lastRunAt)}.`
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

async function toggleRunDetails(runId: string, button: HTMLButtonElement): Promise<void> {
  const panel = document.querySelector(
    `.logs-run-events[data-run-id="${CSS.escape(runId)}"]`,
  );
  if (!(panel instanceof HTMLElement)) {
    return;
  }

  if (!panel.hidden && panel.dataset.loaded === 'true') {
    panel.hidden = true;
    button.textContent = 'Show details';
    return;
  }

  panel.hidden = false;
  button.textContent = 'Hide details';
  button.disabled = true;
  panel.innerHTML = '<p class="logs-events-loading">Loading operational log…</p>';

  try {
    const data = await fetchFeedSyncRunEvents(runId);
    panel.innerHTML = renderEventsTimeline(data.events);
    panel.dataset.loaded = 'true';
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    panel.innerHTML = `<p class="logs-events-error">Failed to load events: ${escapeHtml(message)}</p>`;
  } finally {
    button.disabled = false;
  }
}

function syncAllResultMessage(result: FeedSyncAllResponse): string {
  if (result.state === 'started') {
    return `Sync started (run ${result.runId.slice(0, 8)}…).`;
  }
  if (result.state === 'in-progress') {
    return `Sync already in progress (started ${formatDateTime(result.startedAt)}).`;
  }
  if (result.state === 'deduped') {
    return `Sync skipped — last run finished ${formatDateTime(result.run.finishedAt)} (cooldown active).`;
  }
  const summary = runSummary(result.run);
  if (result.run.outcome === 'no_op') {
    return `Sync finished with no account updates. ${summary}.`;
  }
  return `Sync finished (${outcomeLabel(result.run.outcome)}). ${summary}.`;
}

function syncAllResultMessageFromRun(run: FeedSyncRun): string {
  const wrapped: FeedSyncAllResponse = { state: 'completed', run };
  return syncAllResultMessage(wrapped);
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => {
    setTimeout(resolve, ms);
  });
}

async function pollUntilSyncRunComplete(
  runId: string | undefined,
  startedAfterIso: string | undefined,
): Promise<FeedSyncRun | null> {
  const deadline = Date.now() + SYNC_ALL_POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const data = await fetchFeedSyncRuns();
    renderFeedLogs(data);

    if (runId !== undefined) {
      const byId = data.runs.find(run => run.id === runId);
      if (byId !== undefined) {
        return byId;
      }
    } else if (startedAfterIso !== undefined) {
      const match = data.runs.find(
        run => run.startedAt >= startedAfterIso,
      );
      if (match !== undefined) {
        return match;
      }
    }

    await sleep(SYNC_ALL_POLL_INTERVAL_MS);
  }
  return null;
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

    if (result.state === 'deduped') {
      const kind = 'info';
      statusEl.innerHTML = renderStatusMessage(syncAllResultMessage(result), kind);
      const data = await fetchFeedSyncRuns();
      renderFeedLogs(data);
      return;
    }

    if (result.state === 'started' || result.state === 'in-progress') {
      const runId = result.state === 'started' ? result.runId : undefined;
      const startedAfterIso =
        result.state === 'in-progress' ? result.startedAt : result.startedAt;
      statusEl.innerHTML = renderStatusMessage(
        result.state === 'started'
          ? 'Sync running in background…'
          : syncAllResultMessage(result),
        'info',
      );

      const completedRun = await pollUntilSyncRunComplete(runId, startedAfterIso);
      if (completedRun === null) {
        statusEl.innerHTML = renderStatusMessage(
          'Sync is still running — refresh the Logs tab later for the result.',
          'info',
        );
        return;
      }

      const kind = completedRun.outcome === 'no_op' ? 'error' : 'info';
      statusEl.innerHTML = renderStatusMessage(
        syncAllResultMessageFromRun(completedRun),
        kind,
      );
      const data = await fetchFeedSyncRuns();
      renderFeedLogs(data);
      return;
    }

    const kind = result.run.outcome === 'no_op' ? 'error' : 'info';
    statusEl.innerHTML = renderStatusMessage(syncAllResultMessage(result), kind);
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

  const root = document.getElementById('feed-logs-root');
  root?.addEventListener('click', ev => {
    const target = ev.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }
    const detailsButton = target.closest('.logs-show-details');
    if (!(detailsButton instanceof HTMLButtonElement)) {
      return;
    }
    const runId = detailsButton.dataset.runId;
    if (runId === undefined || runId === '') {
      return;
    }
    void toggleRunDetails(runId, detailsButton);
  });
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
