import { describe, it, expect, vi } from 'vitest';
import { createRegistry } from './create-registry.js';

interface Reg {
  readonly value: number;
  readonly nested: { readonly inner: string };
}

describe('createRegistry.get', () => {
  it('calls build() lazily on first access', () => {
    const build = vi.fn((): Reg => ({ value: 1, nested: { inner: 'a' } }));
    const h = createRegistry<Reg>({ name: 'test', build });
    expect(build).not.toHaveBeenCalled();
    h.get();
    expect(build).toHaveBeenCalledTimes(1);
  });

  it('memoises — repeated calls return the same reference', () => {
    let i = 0;
    const h = createRegistry<Reg>({
      name: 'test',
      build: () => ({ value: ++i, nested: { inner: 'a' } }),
    });
    const a = h.get();
    const b = h.get();
    const c = h.get();
    expect(a).toBe(b);
    expect(b).toBe(c);
    expect(a.value).toBe(1);
  });

  it('throws a named error when build() returns null', () => {
    const h = createRegistry<Reg | null>({
      name: 'broken',
      // eslint-disable-next-line @typescript-eslint/no-unsafe-return
      build: () => null,
    });
    expect(() => h.get()).toThrow(/createRegistry\(broken\)/);
  });
});

describe('createRegistry.invalidate', () => {
  it('busts the cache so the next get() rebuilds', () => {
    const build = vi.fn((): Reg => ({ value: 1, nested: { inner: 'a' } }));
    const h = createRegistry<Reg>({ name: 'test', build });
    h.get();
    h.get();
    expect(build).toHaveBeenCalledTimes(1);
    h.invalidate();
    h.get();
    expect(build).toHaveBeenCalledTimes(2);
  });

  it('invalidate without a prior get is a no-op and build is still deferred', () => {
    const build = vi.fn((): Reg => ({ value: 1, nested: { inner: 'a' } }));
    const h = createRegistry<Reg>({ name: 'test', build });
    h.invalidate();
    expect(build).not.toHaveBeenCalled();
    h.get();
    expect(build).toHaveBeenCalledTimes(1);
  });
});

describe('createRegistry.__resetForTests', () => {
  it('no-arg form drops the cache so the next get rebuilds', () => {
    let i = 0;
    const h = createRegistry<Reg>({
      name: 'test',
      build: () => ({ value: ++i, nested: { inner: 'a' } }),
    });
    expect(h.get().value).toBe(1);
    h.__resetForTests();
    expect(h.get().value).toBe(2);
  });

  it('override form installs a fixture without calling build()', () => {
    const build = vi.fn((): Reg => ({ value: 1, nested: { inner: 'a' } }));
    const h = createRegistry<Reg>({ name: 'test', build });
    const fixture: Reg = { value: 999, nested: { inner: 'fixture' } };
    h.__resetForTests(fixture);
    expect(h.get()).toBe(fixture);
    expect(h.get()).toBe(fixture);
    expect(build).not.toHaveBeenCalled();
  });

  it('after an override reset, a plain reset + get rebuilds from scratch', () => {
    let i = 0;
    const h = createRegistry<Reg>({
      name: 'test',
      build: () => ({ value: ++i, nested: { inner: 'a' } }),
    });
    h.__resetForTests({ value: 42, nested: { inner: 'fixture' } });
    expect(h.get().value).toBe(42);
    h.__resetForTests();
    expect(h.get().value).toBe(1);
  });
});

describe('cross-registry isolation', () => {
  it('two registries never share cache state', () => {
    const buildA = vi.fn((): Reg => ({ value: 1, nested: { inner: 'a' } }));
    const buildB = vi.fn((): Reg => ({ value: 2, nested: { inner: 'b' } }));
    const a = createRegistry<Reg>({ name: 'a', build: buildA });
    const b = createRegistry<Reg>({ name: 'b', build: buildB });
    a.get();
    expect(buildA).toHaveBeenCalledTimes(1);
    expect(buildB).not.toHaveBeenCalled();
    b.get();
    expect(buildA).toHaveBeenCalledTimes(1);
    expect(buildB).toHaveBeenCalledTimes(1);
    a.invalidate();
    b.get();
    expect(buildA).toHaveBeenCalledTimes(1);
    expect(buildB).toHaveBeenCalledTimes(1);
  });

  it('resetting one registry leaves the other cached', () => {
    const buildA = vi.fn((): Reg => ({ value: 1, nested: { inner: 'a' } }));
    const buildB = vi.fn((): Reg => ({ value: 2, nested: { inner: 'b' } }));
    const a = createRegistry<Reg>({ name: 'a', build: buildA });
    const b = createRegistry<Reg>({ name: 'b', build: buildB });
    a.get();
    b.get();
    b.__resetForTests();
    a.get();
    expect(buildA).toHaveBeenCalledTimes(1);
    b.get();
    expect(buildB).toHaveBeenCalledTimes(2);
  });
});
