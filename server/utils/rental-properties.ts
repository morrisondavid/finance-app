export interface RentalProperty {
  name: string;
  merchant: string;
  grossRent: number;
  account: string;
}

export const RENTAL_PROPERTIES: RentalProperty[] = [
  { name: '78 Hunters Square', merchant: 'Stoneshaw Estates', grossRent: 1292.72, account: 'monzo-joint' },
  { name: '56 Thorney House', merchant: 'Prospect Holdings', grossRent: 979.2, account: 'monzo-joint' },
];

export function matchRentalProperty(
  merchant: string,
  account: string,
  amount: number,
): RentalProperty | null {
  const candidates = RENTAL_PROPERTIES.filter(
    p => p.merchant === merchant && p.account === account,
  );
  if (candidates.length === 0) return null;
  let best = candidates[0];
  let bestDiff = Math.abs(amount - best.grossRent);
  for (let i = 1; i < candidates.length; i++) {
    const diff = Math.abs(amount - candidates[i].grossRent);
    if (diff < bestDiff) {
      best = candidates[i];
      bestDiff = diff;
    }
  }
  return best;
}
