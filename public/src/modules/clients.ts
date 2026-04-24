/**
 * Clients tab — end-client-first view over `clients/clients.csv`.
 *
 * `partitionClientsForUi` handles the projection (direct/agency rows
 * onto End-client and Agency panels); this module is just the DOM
 * binding layer. Responsibilities:
 *
 *   - `initClients()`     — one-time DOM binding (modal close, form submit).
 *   - `loadClients()`     — parallel fetch of `/api/clients` +
 *                            `/api/warnings/entity-foundation`, partition,
 *                            render.
 *   - Edit modal          — kind-aware form. Three launch points:
 *                             * Delta Capita tile → patches direct row.
 *                             * Edwin Group tile  → patches the end-client
 *                                                    block of the `la-fosse`
 *                                                    agency row.
 *                             * La Fosse tile     → patches the agency-level
 *                                                    fields of the agency row.
 *
 * The TBC warning surfaces on each end-client tile whose underlying row
 * emits `client-tbc-fields` — one glance tells the user which tiles
 * have unresolved contact fields before they open the form.
 */

import { escapeHtml, openModal, closeModal } from '../utils/dom';
import {
  partitionClientsForUi,
  type EndClientTile,
  type AgencyTile,
  type TbcString,
} from './clients-partition';
import type {
  Client,
  ClientId,
  ClientUpdate,
  DirectClientUpdate,
  AgencyClientUpdate,
  EntityFoundationWarning,
  EntityFoundationWarningsResponse,
  ClientsListResponse,
  ClientUpdateResponse,
} from '../../../shared/api-contracts.js';

// ---------------------------------------------------------------------------
// DOM ids
// ---------------------------------------------------------------------------

const END_CLIENTS_LIST_ID = 'clients-end-list';
const AGENCIES_LIST_ID = 'clients-agencies-list';
const EDIT_MODAL_ID = 'clients-edit-modal';
const EDIT_MODAL_TITLE_ID = 'clients-edit-modal-title';
const EDIT_MODAL_CLOSE_ID = 'clients-edit-modal-close';
const EDIT_MODAL_CANCEL_ID = 'clients-edit-modal-cancel';
const EDIT_FORM_ID = 'clients-edit-form';
const EDIT_FORM_FIELDS_ID = 'clients-edit-form-fields';
const EDIT_ERROR_ID = 'clients-edit-error';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let clientsById: Map<ClientId, Client> = new Map();
let warningsForClient: Map<ClientId, EntityFoundationWarning[]> = new Map();

interface EditContext {
  readonly clientId: ClientId;
  readonly editTarget: 'client' | 'end_client';
  /** Mirrors the underlying row's kind; the patch we send carries the
   *  same value so the discriminated union lines up server-side. */
  readonly kind: Client['kind'];
}
let editContext: EditContext | null = null;

// ---------------------------------------------------------------------------
// Fetch helpers
// ---------------------------------------------------------------------------

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GET ${url} failed: ${res.status}`);
  return (await res.json()) as T;
}

async function putJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`PUT ${url} failed (${res.status}): ${text}`);
  }
  return (await res.json()) as T;
}

// ---------------------------------------------------------------------------
// Warning lookup
// ---------------------------------------------------------------------------

/**
 * A `client-tbc-fields` warning targets a specific client via its
 * `sources` list (`client:{id}`). Index by the id so tile rendering is
 * O(1).
 */
function indexWarningsByClient(
  warnings: readonly EntityFoundationWarning[],
): Map<ClientId, EntityFoundationWarning[]> {
  const out = new Map<ClientId, EntityFoundationWarning[]>();
  for (const w of warnings) {
    if (w.code !== 'client-tbc-fields') continue;
    for (const src of w.sources) {
      if (!src.startsWith('client:')) continue;
      const id = src.slice('client:'.length) as ClientId;
      const list = out.get(id) ?? [];
      list.push(w);
      out.set(id, list);
    }
  }
  return out;
}

function tbcWarningsFor(id: ClientId): readonly EntityFoundationWarning[] {
  return warningsForClient.get(id) ?? [];
}

// ---------------------------------------------------------------------------
// Rendering — shared helpers
// ---------------------------------------------------------------------------

/**
 * Render a contact line with a "TBC" pill when the value is unresolved.
 * Keeps the styling consistent across direct, end-client, and agency
 * tiles.
 */
function contactHtml(label: string, name: TbcString | null, email: TbcString | null): string {
  if (name === null && email === null) return '';
  const nameHtml = name === 'TBC'
    ? '<span class="clients-tbc-pill">TBC</span>'
    : name !== null
      ? escapeHtml(name)
      : '';
  const emailHtml = email === 'TBC'
    ? '<span class="clients-tbc-pill">TBC</span>'
    : email !== null
      ? `<a href="mailto:${escapeHtml(email)}">${escapeHtml(email)}</a>`
      : '';
  const joined = [nameHtml, emailHtml].filter(Boolean).join(' · ');
  return `<div class="clients-contact"><span class="clients-contact__label">${escapeHtml(label)}</span><span class="clients-contact__value">${joined}</span></div>`;
}

function warningBadgeHtml(warnings: readonly EntityFoundationWarning[]): string {
  if (warnings.length === 0) return '';
  const title = warnings.map(w => w.detail).join('\n\n');
  return `<span class="clients-warning-badge" role="img" aria-label="Unresolved contact fields" title="${escapeHtml(title)}">!</span>`;
}

// ---------------------------------------------------------------------------
// Rendering — End clients panel
// ---------------------------------------------------------------------------

function endClientTileHtml(tile: EndClientTile): string {
  const warnings = tbcWarningsFor(tile.id);
  const agencyBadge = tile.viaAgency
    ? `<span class="clients-tile__agency-badge">via ${escapeHtml(tile.viaAgency.tradingName)}</span>`
    : '';
  const inactiveBadge = tile.active
    ? ''
    : '<span class="clients-tile__inactive-badge">Inactive</span>';

  return `
    <div class="clients-tile clients-tile--end-client${tile.active ? '' : ' clients-tile--inactive'}" data-client-id="${escapeHtml(tile.id)}" data-edit-target="${tile.editTarget}">
      <div class="clients-tile__head">
        <div class="clients-tile__title">
          <h3 class="clients-tile__name">${escapeHtml(tile.tradingName)}</h3>
          ${warningBadgeHtml(warnings)}
        </div>
        <div class="clients-tile__meta">
          <span class="clients-tile__legal">${escapeHtml(tile.legalName)}</span>
          ${agencyBadge}
          ${inactiveBadge}
        </div>
      </div>
      ${tile.address !== null ? `<div class="clients-tile__address">${escapeHtml(tile.address)}</div>` : ''}
      <div class="clients-tile__contacts">
        ${contactHtml('Primary', tile.primaryContactName, tile.primaryContactEmail)}
        ${contactHtml('Secondary', tile.secondaryContactName, tile.secondaryContactEmail)}
      </div>
      <div class="clients-tile__actions">
        <button type="button" class="btn btn-secondary clients-edit-btn" data-client-id="${escapeHtml(tile.id)}" data-edit-target="${tile.editTarget}">Edit</button>
      </div>
    </div>
  `;
}

function renderEndClients(tiles: readonly EndClientTile[]): void {
  const container = document.getElementById(END_CLIENTS_LIST_ID);
  if (container === null) return;
  const visible = tiles.filter(t => t.active);
  if (visible.length === 0) {
    container.innerHTML = '<p class="clients-empty">No active end clients.</p>';
    return;
  }
  container.innerHTML = visible.map(endClientTileHtml).join('');
}

// ---------------------------------------------------------------------------
// Rendering — Agencies panel
// ---------------------------------------------------------------------------

function agencyTileHtml(tile: AgencyTile): string {
  const brokers = tile.brokersEndClients
    .map(e => escapeHtml(e.tradingName))
    .join(', ');
  const vat = tile.vatNumber === 'TBC'
    ? '<span class="clients-tbc-pill">TBC</span>'
    : tile.vatNumber !== null
      ? escapeHtml(tile.vatNumber)
      : '<span class="clients-tile__muted">—</span>';
  return `
    <div class="clients-tile clients-tile--agency${tile.active ? '' : ' clients-tile--inactive'}" data-client-id="${escapeHtml(tile.id)}" data-edit-target="client">
      <div class="clients-tile__head">
        <div class="clients-tile__title">
          <h3 class="clients-tile__name">${escapeHtml(tile.tradingName)}</h3>
        </div>
        <div class="clients-tile__meta">
          <span class="clients-tile__legal">${escapeHtml(tile.legalName)}</span>
          <span class="clients-tile__agency-label">Agency</span>
        </div>
      </div>
      <div class="clients-tile__address">${escapeHtml(tile.address)}</div>
      <div class="clients-tile__contacts">
        ${contactHtml('Primary', tile.primaryContactName, tile.primaryContactEmail)}
        ${contactHtml('Secondary', tile.secondaryContactName, tile.secondaryContactEmail)}
        <div class="clients-contact"><span class="clients-contact__label">VAT</span><span class="clients-contact__value">${vat}</span></div>
        <div class="clients-contact"><span class="clients-contact__label">Brokers</span><span class="clients-contact__value">${brokers}</span></div>
      </div>
      <div class="clients-tile__actions">
        <button type="button" class="btn btn-secondary clients-edit-btn" data-client-id="${escapeHtml(tile.id)}" data-edit-target="client">Edit</button>
      </div>
    </div>
  `;
}

function renderAgencies(tiles: readonly AgencyTile[]): void {
  const container = document.getElementById(AGENCIES_LIST_ID);
  if (container === null) return;
  const visible = tiles.filter(t => t.active);
  if (visible.length === 0) {
    container.innerHTML = '<p class="clients-empty">No active agencies.</p>';
    return;
  }
  container.innerHTML = visible.map(agencyTileHtml).join('');
}

// ---------------------------------------------------------------------------
// Edit modal — field descriptors
// ---------------------------------------------------------------------------

/**
 * Declarative form descriptor — one row per input. Keeps the three
 * form layouts (direct client, agency client, end-client block) in a
 * single table so adding a field is a one-line change rather than a
 * hunt across render + submit + validate.
 *
 * `tbcable: true` fields render as a text input that accepts the
 * literal string `TBC`. Empty inputs serialise to `null` for nullable
 * fields, or remain `TBC` if required.
 */
type FieldKey = keyof DirectClientUpdate | keyof AgencyClientUpdate;

interface FieldDescriptor {
  readonly key: FieldKey;
  readonly label: string;
  readonly type: 'text' | 'email' | 'textarea' | 'checkbox';
  readonly nullable: boolean;
  readonly tbcable?: boolean;
}

const COMMON_CLIENT_FIELDS: readonly FieldDescriptor[] = [
  { key: 'legal_name', label: 'Legal name', type: 'text', nullable: false },
  { key: 'trading_name', label: 'Trading name', type: 'text', nullable: false },
  { key: 'vat_number', label: 'VAT number', type: 'text', nullable: true, tbcable: true },
  { key: 'billing_address', label: 'Billing address', type: 'textarea', nullable: false },
  { key: 'primary_contact_name', label: 'Primary contact name', type: 'text', nullable: false, tbcable: true },
  { key: 'primary_contact_email', label: 'Primary contact email', type: 'email', nullable: false, tbcable: true },
  { key: 'secondary_contact_name', label: 'Secondary contact name', type: 'text', nullable: true, tbcable: true },
  { key: 'secondary_contact_email', label: 'Secondary contact email', type: 'email', nullable: true, tbcable: true },
  { key: 'hr_contact_name', label: 'HR contact name', type: 'text', nullable: true, tbcable: true },
  { key: 'hr_contact_email', label: 'HR contact email', type: 'email', nullable: true, tbcable: true },
  { key: 'accounts_contact_name', label: 'Accounts contact name', type: 'text', nullable: true, tbcable: true },
  { key: 'accounts_contact_email', label: 'Accounts contact email', type: 'email', nullable: true, tbcable: true },
  { key: 'cc_emails', label: 'CC emails (comma-separated)', type: 'text', nullable: true },
  { key: 'holiday_system_url', label: 'Holiday system URL', type: 'text', nullable: true, tbcable: true },
  { key: 'client_assigned_email', label: 'Client-assigned email (yours)', type: 'email', nullable: true, tbcable: true },
  { key: 'active', label: 'Active', type: 'checkbox', nullable: false },
];

const END_CLIENT_BLOCK_FIELDS: readonly FieldDescriptor[] = [
  { key: 'end_client_legal_name', label: 'End-client legal name', type: 'text', nullable: false },
  { key: 'end_client_address', label: 'End-client address', type: 'textarea', nullable: false },
  { key: 'end_client_primary_contact_name', label: 'End-client primary contact name', type: 'text', nullable: false, tbcable: true },
  { key: 'end_client_primary_contact_email', label: 'End-client primary contact email', type: 'email', nullable: false, tbcable: true },
  { key: 'end_client_secondary_contact_name', label: 'End-client secondary contact name', type: 'text', nullable: true, tbcable: true },
  { key: 'end_client_secondary_contact_email', label: 'End-client secondary contact email', type: 'email', nullable: true, tbcable: true },
];

function fieldsFor(context: EditContext): readonly FieldDescriptor[] {
  if (context.editTarget === 'end_client') {
    return END_CLIENT_BLOCK_FIELDS;
  }
  return COMMON_CLIENT_FIELDS;
}

// ---------------------------------------------------------------------------
// Edit modal — open / populate / submit
// ---------------------------------------------------------------------------

function currentValueFor(
  client: Client,
  field: FieldDescriptor,
): string | boolean | null {
  // The descriptor key is validated as a keyof the Update schema, which
  // itself overlaps with the Client object keys. Narrowing Client to
  // Record<string, unknown> for the lookup keeps the compiler happy
  // without reaching for `as unknown as ...` at every call-site.
  const bag = client as Record<string, unknown>;
  const value = bag[field.key];
  if (field.type === 'checkbox') return value === true;
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return value;
  return null;
}

function renderField(field: FieldDescriptor, value: string | boolean | null): string {
  const labelId = `clients-edit-${field.key}`;
  const required = !field.nullable && field.type !== 'checkbox' ? ' required' : '';
  if (field.type === 'checkbox') {
    const checked = value === true ? 'checked' : '';
    return `
      <label class="clients-form-checkbox">
        <input type="checkbox" name="${field.key}" id="${labelId}" ${checked} />
        ${escapeHtml(field.label)}
      </label>
    `;
  }
  if (field.type === 'textarea') {
    const v = typeof value === 'string' ? value : '';
    return `
      <label class="clients-form-field">
        <span class="clients-form-label">${escapeHtml(field.label)}${field.nullable ? '' : ' *'}</span>
        <textarea name="${field.key}" id="${labelId}" rows="2"${required}>${escapeHtml(v)}</textarea>
      </label>
    `;
  }
  // text / email share the same input shape — `type="email"` gets
  // browser-level format validation; we don't enforce it for `TBC`.
  const inputType = field.tbcable ? 'text' : field.type;
  const v = typeof value === 'string' ? value : '';
  return `
    <label class="clients-form-field">
      <span class="clients-form-label">${escapeHtml(field.label)}${field.nullable ? '' : ' *'}</span>
      <input type="${inputType}" name="${field.key}" id="${labelId}" value="${escapeHtml(v)}"${required} />
    </label>
  `;
}

function openEditModal(context: EditContext): void {
  const client = clientsById.get(context.clientId);
  if (client === undefined) return;
  editContext = context;
  const title = document.getElementById(EDIT_MODAL_TITLE_ID);
  if (title !== null) {
    if (context.editTarget === 'end_client' && client.kind === 'agency') {
      title.textContent = `Edit end client — ${client.end_client_legal_name}`;
    } else {
      title.textContent = `Edit ${client.kind === 'agency' ? 'agency' : 'client'} — ${client.trading_name}`;
    }
  }
  const fields = fieldsFor(context);
  const fieldsContainer = document.getElementById(EDIT_FORM_FIELDS_ID);
  if (fieldsContainer !== null) {
    fieldsContainer.innerHTML = fields
      .map(f => renderField(f, currentValueFor(client, f)))
      .join('');
  }
  clearError();
  openModal(EDIT_MODAL_ID);
}

function closeEditModal(): void {
  editContext = null;
  closeModal(EDIT_MODAL_ID);
}

function clearError(): void {
  const el = document.getElementById(EDIT_ERROR_ID);
  if (el !== null) {
    el.textContent = '';
    el.style.display = 'none';
  }
}

function showError(msg: string): void {
  const el = document.getElementById(EDIT_ERROR_ID);
  if (el !== null) {
    el.textContent = msg;
    el.style.display = 'block';
  }
}

/**
 * Build the patch payload from the form. Only fields that changed land
 * in the patch — sending the whole object back would work server-side
 * but make network traces / server logs much harder to read.
 */
function readPatchFromForm(
  form: HTMLFormElement,
  context: EditContext,
  original: Client,
): ClientUpdate {
  const fields = fieldsFor(context);
  const originalBag = original as Record<string, unknown>;
  const changes: Record<string, unknown> = {};

  for (const field of fields) {
    const input = form.elements.namedItem(field.key);
    if (input === null) continue;
    const current = originalBag[field.key];

    let next: string | boolean | null;
    if (field.type === 'checkbox' && input instanceof HTMLInputElement) {
      next = input.checked;
    } else if (
      input instanceof HTMLInputElement ||
      input instanceof HTMLTextAreaElement
    ) {
      const raw = input.value.trim();
      if (raw === '' && field.nullable) {
        next = null;
      } else {
        next = raw;
      }
    } else {
      continue;
    }

    if (next !== current) {
      changes[field.key] = next;
    }
  }

  // Every patch carries the discriminator so the discriminated union
  // routes correctly server-side.
  const patch = { ...changes, kind: context.kind };
  return patch as ClientUpdate;
}

async function submitEdit(event: SubmitEvent): Promise<void> {
  event.preventDefault();
  const form = event.currentTarget;
  if (!(form instanceof HTMLFormElement) || editContext === null) return;
  const original = clientsById.get(editContext.clientId);
  if (original === undefined) return;

  const patch = readPatchFromForm(form, editContext, original);
  try {
    await putJson<ClientUpdateResponse>(
      `/api/clients/${encodeURIComponent(editContext.clientId)}`,
      patch,
    );
    closeEditModal();
    await loadClients();
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    showError(msg);
  }
}

// ---------------------------------------------------------------------------
// Public API — init + load
// ---------------------------------------------------------------------------

/**
 * Bind every DOM event once. Uses event delegation for the per-tile
 * Edit buttons so newly rendered tiles don't need re-binding.
 */
export function initClients(): void {
  const closeBtn = document.getElementById(EDIT_MODAL_CLOSE_ID);
  if (closeBtn !== null) closeBtn.addEventListener('click', closeEditModal);

  const cancelBtn = document.getElementById(EDIT_MODAL_CANCEL_ID);
  if (cancelBtn !== null) cancelBtn.addEventListener('click', closeEditModal);

  const form = document.getElementById(EDIT_FORM_ID);
  if (form instanceof HTMLFormElement) {
    form.addEventListener('submit', (e: SubmitEvent) => {
      void submitEdit(e);
    });
  }

  // Delegate Edit clicks off the tab root so every tile binds implicitly.
  const root = document.getElementById('clients');
  if (root !== null) {
    root.addEventListener('click', (e: MouseEvent) => {
      const target = e.target;
      if (!(target instanceof Element)) return;
      const btn = target.closest('.clients-edit-btn');
      if (!(btn instanceof HTMLElement)) return;
      const clientId = btn.dataset.clientId;
      const editTarget = btn.dataset.editTarget;
      if (clientId === undefined || editTarget === undefined) return;
      if (editTarget !== 'client' && editTarget !== 'end_client') return;
      const client = clientsById.get(clientId);
      if (client === undefined) return;
      openEditModal({
        clientId,
        editTarget,
        kind: client.kind,
      });
    });
  }
}

export async function loadClients(): Promise<void> {
  const [clientsResp, warningsResp] = await Promise.all([
    getJson<ClientsListResponse>('/api/clients'),
    getJson<EntityFoundationWarningsResponse>('/api/warnings/entity-foundation'),
  ]);

  clientsById = new Map(clientsResp.clients.map(c => [c.id, c]));
  warningsForClient = indexWarningsByClient(warningsResp.warnings);

  const { endClients, agencies } = partitionClientsForUi(clientsResp.clients);
  renderEndClients(endClients);
  renderAgencies(agencies);
}
