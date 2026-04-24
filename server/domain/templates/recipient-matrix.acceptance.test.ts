/**
 * Acceptance-lock tests for the recipient matrix.
 *
 * Each `it()` below tracks one named acceptance criterion from
 * ROADMAP §1.2.E (Contracts Tab). The test titles cite the exact
 * clause they regression-lock, so if the matrix ever drifts from
 * the product spec, the failing test name points at the clause it
 * broke.
 *
 * These tests deliberately use the canonical fixture helpers from
 * `test-helpers.ts` so the fixtures themselves stay aligned with
 * production data. They do NOT render any `.hbs` body — that is
 * already covered in `render.test.ts`; the product-facing matrix
 * is the subject here.
 */

import { describe, it, expect } from 'vitest';
import { resolveRecipients } from './resolve-recipients.js';
import { DirectClientHasNoAgencyRenewalFlow } from './errors.js';
import {
  makeDeltaCapitaFixtureClient,
  makeLaFosseFixtureClient,
} from './test-helpers.js';

describe('ROADMAP §1.2.E — recipient matrix acceptance', () => {
  it('[§1.2.E-A] direct-client (DC) leave routes To: lily + cc includes the documented contacts', () => {
    const dc = makeDeltaCapitaFixtureClient();
    const result = resolveRecipients('leave', dc);
    expect(result.to).toEqual(['lily.lovegrove@deltacapita.com']);
    expect(result.cc).toEqual([
      'philip.coleman@deltacapita.com',
      'william.swift@deltacapita.com',
      'hrandrecruitment@deltacapita.com',
      'dan.hedley@deltacapita.com',
    ]);
  });

  it('[§1.2.E-B] direct-client (DC) sickness routes identically to leave', () => {
    const dc = makeDeltaCapitaFixtureClient();
    const leave = resolveRecipients('leave', dc);
    const sickness = resolveRecipients('sickness', dc);
    expect(sickness.to).toEqual(leave.to);
    expect(sickness.cc).toEqual(leave.cc);
  });

  it('[§1.2.E-C] direct-client (DC) invoice-cover swaps HR for accounts (none configured → just cc_emails + secondary)', () => {
    const dc = makeDeltaCapitaFixtureClient();
    const invoice = resolveRecipients('invoice-cover', dc);
    expect(invoice.to).toEqual(['lily.lovegrove@deltacapita.com']);
    expect(invoice.cc).not.toContain('william.swift@deltacapita.com');
    expect(invoice.cc).toContain('philip.coleman@deltacapita.com');
    expect(invoice.cc).toContain('hrandrecruitment@deltacapita.com');
    expect(invoice.cc).toContain('dan.hedley@deltacapita.com');
  });

  it('[§1.2.E-D] agency-client (La Fosse) leave routes To: end-client contact, agency silent', () => {
    const lf = makeLaFosseFixtureClient();
    const result = resolveRecipients('leave', lf);
    expect(result.to).toEqual(['aidan.gray@edwingroup.com']);
    expect(result.to).not.toContain('accounts@lafosse.com');
    expect(result.cc).not.toContain('accounts@lafosse.com');
  });

  it('[§1.2.E-E] agency-client (La Fosse) sickness routes identically to leave', () => {
    const lf = makeLaFosseFixtureClient();
    const leave = resolveRecipients('leave', lf);
    const sickness = resolveRecipients('sickness', lf);
    expect(sickness.to).toEqual(leave.to);
    expect(sickness.cc).toEqual(leave.cc);
  });

  it('[§1.2.E-F] agency-client (La Fosse) invoice-cover also routes through the end-client contact only', () => {
    const lf = makeLaFosseFixtureClient();
    const result = resolveRecipients('invoice-cover', lf);
    expect(result.to).toEqual(['aidan.gray@edwingroup.com']);
    expect(result.cc).not.toContain('accounts@lafosse.com');
  });

  it('[§1.2.E-G] renewal against a direct client raises DirectClientHasNoAgencyRenewalFlow (never sends)', () => {
    const dc = makeDeltaCapitaFixtureClient();
    expect(() => resolveRecipients('renewal', dc)).toThrow(
      DirectClientHasNoAgencyRenewalFlow,
    );
  });

  it('[§1.2.E-H] renewal against an agency client routes To: agency primary contact (not the end-client)', () => {
    const lf = makeLaFosseFixtureClient();
    const result = resolveRecipients('renewal', lf);
    expect(result.to).toEqual(['accounts@lafosse.com']);
    expect(result.to).not.toContain('aidan.gray@edwingroup.com');
  });
});
