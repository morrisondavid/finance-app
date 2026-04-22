/**
 * Fixture builders for registry consumer tests.
 *
 * Every registry that participates in the canonical pattern exports a
 * `makeTest<Name>Registry(overrides?)` helper. Consumer tests import
 * that helper, optionally pass structural overrides, and get a real
 * registry built through the production `build()` function. This keeps
 * fixtures from silently diverging from production index shapes: if
 * `buildAccountsRegistry` grows a new index, fixtures get it for free.
 *
 * This module provides the shared primitive the per-registry fixture
 * helpers are built on.
 */

/**
 * Merge `overrides` (shallow) onto `defaults`. Overriding a key replaces
 * the whole value at that key — callers that need to tweak a nested
 * field should spread the default themselves, e.g.
 *
 *   shallowMergeFixture(defaults, {
 *     accounts: [...defaults.accounts, extra],
 *   })
 *
 * The shallow merge is deliberate: deep-merge semantics over arbitrary
 * shapes hide bugs (silently merging into an array, for instance) and
 * make the override surface implicit instead of explicit.
 */
export function shallowMergeFixture<T extends object>(
  defaults: T,
  overrides?: Partial<T>,
): T {
  if (overrides === undefined) return defaults;
  return { ...defaults, ...overrides };
}

/**
 * Typed builder convention — `defineFixtureBuilder(build)` returns the
 * same `build` function; its purpose is to make the fixture-builder
 * declaration visually distinct at the call site and to ensure the
 * inferred signature matches `(overrides?: Partial<TData>) =>
 * TRegistry` exactly. Not strictly necessary, but makes
 * `grep -rn defineFixtureBuilder` a reliable way to find every
 * registry's fixture builder.
 */
export function defineFixtureBuilder<TData extends object, TRegistry>(
  build: (overrides?: Partial<TData>) => TRegistry,
): (overrides?: Partial<TData>) => TRegistry {
  return build;
}
