/**
 * Shared registry factory.
 *
 * Every domain registry (accounts, people, merchants, payroll, company,
 * transaction-overrides, ...) is built on top of this factory so the
 * memoisation / invalidation / test-reset plumbing is written exactly
 * once. A registry's module supplies `build()` (its full loader —
 * schema validation, index derivation, etc.) and gets back a handle
 * with `get`, `invalidate`, and `__resetForTests`.
 *
 * Registries that depend on mutable build inputs (e.g. a CSV directory
 * that the POST classify endpoint redirects for tests) close over a
 * module-level variable inside their own `build`. The `createRegistry`
 * call stays unchanged; the registry module wraps `__resetForTests`
 * with its own reset that also resets the closed-over variable.
 *
 * Contract:
 *   - `get()` memoises. Two consecutive calls without an intervening
 *     `invalidate()` / `__resetForTests()` return the same reference.
 *   - `invalidate()` drops the cache. The next `get()` calls `build()`
 *     again. Callers use this after mutating the backing data (e.g. a
 *     CSV write).
 *   - `__resetForTests(override?)`:
 *       - no arg → drop cache; next `get()` rebuilds.
 *       - with arg → install `override` as the cached value; subsequent
 *         `get()` returns `override` without calling `build()`. Used by
 *         consumer tests that want to swap in a fixture without touching
 *         disk.
 */

export interface RegistryHandle<TRegistry> {
  /** Return the memoised registry, building it on first access. */
  get(): TRegistry;
  /** Drop the cache so the next {@link get} rebuilds. */
  invalidate(): void;
  /**
   * Tests only. With no argument, drops the cache. With an argument,
   * installs `override` as the cached value so the registry module's
   * `build()` is not called by subsequent `get()` calls.
   */
  __resetForTests(override?: TRegistry): void;
}

export interface CreateRegistryOpts<TRegistry> {
  /** Human-readable name; surfaced in error messages for debuggability. */
  readonly name: string;
  /** Full registry loader — schema parse, index derivation, everything. */
  readonly build: () => TRegistry;
}

export function createRegistry<TRegistry>(
  opts: CreateRegistryOpts<TRegistry>,
): RegistryHandle<TRegistry> {
  let cached: TRegistry | null = null;

  return {
    get(): TRegistry {
      if (cached === null) {
        const built = opts.build();
        if (built === null) {
          throw new Error(
            `createRegistry(${opts.name}): build() returned null — registries must never be null.`,
          );
        }
        cached = built;
      }
      return cached;
    },
    invalidate(): void {
      cached = null;
    },
    __resetForTests(override?: TRegistry): void {
      cached = override ?? null;
    },
  };
}
