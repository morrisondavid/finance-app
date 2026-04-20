/**
 * Compile-time exhaustiveness helper for discriminated-union switches.
 *
 * Used at the `default` branch of every view-level filter that switches on
 * `DeclaredCommitment.category` (and any other discriminator). When a new
 * variant is added to the union, TypeScript widens `x` beyond `never` at
 * every call site, producing a compile error that points the developer at
 * each place the new case must be handled.
 *
 * See docs/adr/0001-declared-commitments.md §5.
 *
 * @example
 * switch (c.category) {
 *   case 'fixed-bill':   return true;
 *   case 'subscription': return true;
 *   case 'payroll':      return true;
 *   case 'insurance':    return false;
 *   case 'tax-manual':   return false;
 *   default:             return assertNever(c);
 * }
 */
export function assertNever(x: never): never {
  throw new Error(`Unexpected value (exhaustiveness violation): ${JSON.stringify(x)}`);
}
