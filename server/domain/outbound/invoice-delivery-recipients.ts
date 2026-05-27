/**
 * Hard rollout recipient for transactional invoice notices (swap in deploy/env later).
 */

/** Default To — override with env `RESEND_NOTIFICATION_TO` in delivery module. */
export const INVOICE_ISSUED_NOTICE_TO_DEFAULT =
  'finance-notifications@example.invalid';
