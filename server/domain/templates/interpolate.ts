/**
 * Minimal Handlebars-style interpolation engine — zero dependencies.
 *
 * Supports three constructs, matching the subset used by the
 * committed `.hbs` templates:
 *
 *   - `{{path.to.field}}` — field substitution. Resolves `path` by
 *     dotted lookup against the context. Throws
 *     {@link TemplateContextInvalid} when a path is missing or
 *     resolves to `null` / `undefined`, unless the token is inside an
 *     `{{#if}}` test (see below).
 *   - `{{#each path.to.list}}...{{/each}}` — iterate over an array.
 *     Inside the block, `{{this}}` refers to the current element and
 *     bare `{{field}}` references resolve on the element (falling
 *     back to the outer context if unknown on the element).
 *   - `{{#if path.to.field}}...{{/if}}` — render the block only when
 *     the resolved value is truthy (any non-empty string, non-zero
 *     number, non-empty array, or `true`). Missing paths evaluate
 *     falsy without throwing — this is the only place a missing path
 *     is legal.
 *
 * Whitespace inside the tags is tolerated (`{{  client.legal_name }}`
 * works). No `else`, no nested `{{#if}}` inside `{{#each}}` for now
 * (YAGNI — add when a template genuinely needs it and there is a
 * covering test). Blocks must not overlap.
 */

import { TemplateContextInvalid } from './errors.js';

const TAG = /\{\{\s*([^{}]+?)\s*\}\}/g;
const BLOCK_EACH = /\{\{\s*#each\s+([^{}]+?)\s*\}\}([\s\S]*?)\{\{\s*\/each\s*\}\}/g;
const BLOCK_IF = /\{\{\s*#if\s+([^{}]+?)\s*\}\}([\s\S]*?)\{\{\s*\/if\s*\}\}/g;

type AnyContext = Record<string, unknown>;

/**
 * Resolve a dotted path against a context. Returns `undefined` when
 * any step of the path is missing. Does NOT throw — callers decide
 * whether a missing path is an error (field tag, throws) or a
 * falsy-evaluating condition (`{{#if}}`, silently falsy).
 */
function resolvePath(ctx: unknown, path: string): unknown {
  const segments = path.split('.');
  let cursor: unknown = ctx;
  for (const seg of segments) {
    if (cursor === null || cursor === undefined) return undefined;
    if (typeof cursor !== 'object') return undefined;
    cursor = (cursor as AnyContext)[seg];
  }
  return cursor;
}

function isTruthy(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') return value.length > 0;
  if (typeof value === 'number') return value !== 0 && !Number.isNaN(value);
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

/**
 * Replace leaf `{{path}}` tags in `text` against `ctx`. Missing paths
 * throw {@link TemplateContextInvalid}.
 */
function substituteFields(text: string, ctx: unknown): string {
  return text.replace(TAG, (_match, raw: string) => {
    const path = raw.trim();
    // Block helpers should have been stripped by their outer pass;
    // any leftover `#`-prefixed tag is a malformed template.
    if (path.startsWith('#') || path.startsWith('/')) {
      throw new TemplateContextInvalid(`unexpected block token "${path}"`, path);
    }
    const value = resolvePath(ctx, path);
    if (value === undefined || value === null) {
      throw new TemplateContextInvalid('path resolves to null/undefined', path);
    }
    return String(value);
  });
}

/**
 * Apply `{{#if}}` blocks first (skipping body when falsy, otherwise
 * processing its contents). Iterates to a fixpoint so adjacent blocks
 * are handled in one pass.
 */
function applyIfBlocks(text: string, ctx: unknown): string {
  let current = text;
  while (true) {
    BLOCK_IF.lastIndex = 0;
    const match = BLOCK_IF.exec(current);
    if (!match) return current;
    const [full, rawPath, body] = match;
    const path = rawPath.trim();
    const value = resolvePath(ctx, path);
    const replacement = isTruthy(value) ? body : '';
    current = current.slice(0, match.index) + replacement + current.slice(match.index + full.length);
  }
}

/**
 * Apply `{{#each}}` blocks — for each element of the array at `path`,
 * render the block with the element available as `{{this}}` and as
 * the innermost context (so bare `{{field}}` tags resolve against the
 * element first, then fall back to the outer context).
 */
function applyEachBlocks(text: string, ctx: unknown): string {
  let current = text;
  while (true) {
    BLOCK_EACH.lastIndex = 0;
    const match = BLOCK_EACH.exec(current);
    if (!match) return current;
    const [full, rawPath, body] = match;
    const path = rawPath.trim();
    const value = resolvePath(ctx, path);
    if (value === undefined || value === null) {
      throw new TemplateContextInvalid('each target resolves to null/undefined', path);
    }
    if (!Array.isArray(value)) {
      throw new TemplateContextInvalid('each target is not an array', path);
    }
    const rendered = value.map(element => {
      const elementCtx: AnyContext = {
        ...(typeof ctx === 'object' && ctx !== null ? (ctx as AnyContext) : {}),
        ...(typeof element === 'object' && element !== null ? (element as AnyContext) : {}),
        this: element,
      };
      return substituteFields(applyIfBlocks(body, elementCtx), elementCtx);
    }).join('');
    current = current.slice(0, match.index) + rendered + current.slice(match.index + full.length);
  }
}

/**
 * Main entry point. Processes `{{#if}}` blocks first (so a falsy if
 * never asks the renderer to resolve a leaf tag inside it), then
 * `{{#each}}` blocks, then any remaining leaf tags against `ctx`.
 */
export function interpolate(template: string, ctx: unknown): string {
  const afterIf = applyIfBlocks(template, ctx);
  const afterEach = applyEachBlocks(afterIf, ctx);
  return substituteFields(afterEach, ctx);
}
