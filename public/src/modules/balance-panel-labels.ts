/**
 * Config-driven copy for the dashboard balance block + opening/credit limit modal
 * (credit card vs other account types).
 */

import type { AccountConfig } from '../types';

export function applyBalancePanelLabelsForAccountType(cfg: AccountConfig | undefined): void {
  const isCard = cfg?.type === 'credit-card';

  const openLabel = document.getElementById('balance-open-label');
  const currentLabel = document.getElementById('balance-current-label');
  const editBtn = document.getElementById('edit-balance-btn');
  const modalHeading = document.getElementById('balance-modal-heading');
  const modalDescription = document.getElementById('balance-modal-description');
  const modalAmountLabel = document.getElementById('balance-modal-amount-label');

  if (openLabel) {
    openLabel.textContent = isCard ? 'Credit limit' : 'Opening balance';
  }
  if (currentLabel) {
    currentLabel.textContent = isCard ? 'Available credit' : '= Current balance';
  }
  if (editBtn) {
    editBtn.textContent = isCard ? 'Set credit limit' : 'Set opening balance';
  }
  if (modalHeading) {
    modalHeading.textContent = isCard ? 'Set credit limit' : 'Set opening balance';
  }
  if (modalDescription) {
    modalDescription.textContent = isCard
      ? 'Enter your total credit line for this card. When the issuer changes the limit, update this value; remaining spend is derived from your transactions.'
      : 'Enter the account balance from your bank statement. This should be the balance at the start of your earliest transaction.';
  }
  if (modalAmountLabel) {
    modalAmountLabel.textContent = isCard ? 'Credit limit:' : 'Opening balance:';
  }
}
