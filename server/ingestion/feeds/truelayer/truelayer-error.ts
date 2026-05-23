/**
 * Typed errors from TrueLayer OAuth + Data API calls.
 */

export class TrueLayerError extends Error {
  constructor(
    public readonly code:
      | 'missing-credentials'
      | 'not-linked'
      | 'expired-session'
      | 'http-error'
      | 'invalid-response',
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'TrueLayerError';
  }
}
