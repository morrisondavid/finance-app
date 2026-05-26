/**
 * Normalize Express `req.query`: drop empty scalars and take first array element.
 * Keeps flattened params suitable for shared Zod `safeParse`.
 */
export function flattenExpressQuery(q: Record<string, unknown>): Record<string, unknown> {
  const flat: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(q)) {
    if (val === undefined) continue;
    const first = Array.isArray(val) ? val[0] : val;
    if (first === undefined || first === '') continue;
    flat[key] = first;
  }
  return flat;
}
