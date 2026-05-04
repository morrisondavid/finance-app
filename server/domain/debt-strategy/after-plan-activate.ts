/**
 * Non-blocking hooks after a plan is persisted (phase 2 integrations).
 * Must never throw to the HTTP layer — callers wrap in try/catch if needed.
 */

export function afterPlanActivateSideEffects(_input: { readonly planId: string }): void {
  // Reserved for optional Fixed Expenses / cache invalidation — no blocking I/O in v1.
}
