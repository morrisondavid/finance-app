/**
 * Short-TTL in-memory cache for hot MCP/HTTP read tools.
 * Cleared on data mutations (feed sync, uploads, obligation writes).
 */

const DEFAULT_TTL_SECONDS = 60;

interface CacheEntry {
  readonly body: unknown;
  readonly expiresAt: number;
}

const store = new Map<string, CacheEntry>();

export function resolveReadCacheTtlMs(
  raw: string | undefined = process.env.BANK_READ_CACHE_TTL_SECONDS,
): number {
  if (raw === undefined || raw.trim() === '') {
    return DEFAULT_TTL_SECONDS * 1000;
  }
  const seconds = Number(raw.trim());
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return 0;
  }
  return Math.floor(seconds * 1000);
}

export function stableReadCacheKey(toolName: string, args: unknown): string {
  return `${toolName}:${JSON.stringify(args ?? {})}`;
}

export function clearReadResponseCache(): void {
  store.clear();
}

function getCachedBody(key: string): unknown | undefined {
  const ttlMs = resolveReadCacheTtlMs();
  if (ttlMs <= 0) {
    return undefined;
  }
  const entry = store.get(key);
  if (entry === undefined) {
    return undefined;
  }
  if (Date.now() >= entry.expiresAt) {
    store.delete(key);
    return undefined;
  }
  return entry.body;
}

function setCachedBody(key: string, body: unknown): void {
  const ttlMs = resolveReadCacheTtlMs();
  if (ttlMs <= 0) {
    return;
  }
  store.set(key, { body, expiresAt: Date.now() + ttlMs });
}

/** Return cached value or compute, store, and return. */
export function withReadResponseCache<T>(toolName: string, args: unknown, compute: () => T): T {
  const key = stableReadCacheKey(toolName, args);
  const hit = getCachedBody(key);
  if (hit !== undefined) {
    return hit as T;
  }
  const body = compute();
  setCachedBody(key, body);
  return body;
}
