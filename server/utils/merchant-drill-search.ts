/**
 * Dashboard merchant modal passes `search` = display merchant label; SQL uses
 * `LIKE '%' || needle || '%'`. Bank descriptions often omit that literal phrase
 * (e.g. "Uber Eats" vs "UBER *EATS"). Keep this in sync with
 * {@link ../db/repositories/transactions.js} `getTransactions` search handling.
 */
export function transactionDescriptionMatchesDrillSearch(
  description: string,
  search: string,
): boolean {
  const needle = search.trim();
  if (needle.length === 0) return false;
  if (needle.toLowerCase() === 'uber eats') {
    const d = description.toLowerCase();
    const uberAt = d.indexOf('uber');
    if (uberAt === -1) return false;
    return d.includes('eats', uberAt);
  }
  return description.toLowerCase().includes(needle.toLowerCase());
}
