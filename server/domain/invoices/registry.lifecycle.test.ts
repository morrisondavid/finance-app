/**
 * Lifecycle semantics of the memoised default invoices registry.
 */

import { describe, it, expect, afterEach } from 'vitest';
import {
  __resetInvoiceRegistryForTests,
  buildInvoiceRegistry,
  getInvoiceRegistry,
  invalidateInvoiceRegistry,
} from './registry.js';

describe('getInvoiceRegistry lifecycle', () => {
  afterEach(() => {
    __resetInvoiceRegistryForTests();
  });

  it('memoises — repeated calls return the same reference', () => {
    __resetInvoiceRegistryForTests();
    const first = getInvoiceRegistry();
    const second = getInvoiceRegistry();
    expect(first).toBe(second);
  });

  it('invalidateInvoiceRegistry busts the cache', () => {
    __resetInvoiceRegistryForTests();
    const first = getInvoiceRegistry();
    invalidateInvoiceRegistry();
    const second = getInvoiceRegistry();
    expect(first).not.toBe(second);
    expect(first.all.length).toBe(second.all.length);
  });

  it('__resetInvoiceRegistryForTests(no-arg) drops the cache', () => {
    const first = getInvoiceRegistry();
    __resetInvoiceRegistryForTests();
    const second = getInvoiceRegistry();
    expect(first).not.toBe(second);
  });

  it('__resetInvoiceRegistryForTests(override) swaps in a fixture', () => {
    const fixture = buildInvoiceRegistry();
    __resetInvoiceRegistryForTests(fixture);
    expect(getInvoiceRegistry()).toBe(fixture);
  });

  it('after an override reset, a plain reset restores the default build', () => {
    const fixture = buildInvoiceRegistry();
    __resetInvoiceRegistryForTests(fixture);
    expect(getInvoiceRegistry()).toBe(fixture);
    __resetInvoiceRegistryForTests();
    const rebuilt = getInvoiceRegistry();
    expect(rebuilt).not.toBe(fixture);
    expect(rebuilt.all.length).toBe(fixture.all.length);
  });
});
