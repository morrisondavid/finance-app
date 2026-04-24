/**
 * Unit tests for the {@link openModal} / {@link closeModal} helpers.
 *
 * The project does not ship a JSDOM dev-dep (the frontend modules are
 * integration-tested against the running dashboard, not unit-tested
 * against a DOM). So these tests stub a minimal `document` global
 * locally — just enough surface for the helpers to exercise.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { openModal, closeModal } from './dom.js';

interface FakeElement {
  style: { display: string };
}

function makeFakeElement(): FakeElement {
  return { style: { display: '' } };
}

function installFakeDocument(elementsById: Record<string, FakeElement | null>): void {
  const fakeDoc = {
    getElementById(id: string): FakeElement | null {
      return elementsById[id] ?? null;
    },
  };
  vi.stubGlobal('document', fakeDoc);
}

describe('openModal / closeModal', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  describe('openModal', () => {
    it('sets display=flex on the resolved element', () => {
      const modal = makeFakeElement();
      installFakeDocument({ 'my-modal': modal });
      openModal('my-modal');
      expect(modal.style.display).toBe('flex');
    });

    it('overwrites a prior "none" display', () => {
      const modal = makeFakeElement();
      modal.style.display = 'none';
      installFakeDocument({ 'my-modal': modal });
      openModal('my-modal');
      expect(modal.style.display).toBe('flex');
    });

    it('warns and no-ops when the element is missing (surfaces typos)', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      installFakeDocument({});
      openModal('missing-modal');
      expect(warn).toHaveBeenCalledOnce();
      expect(warn.mock.calls[0][0]).toContain('missing-modal');
    });
  });

  describe('closeModal', () => {
    it('sets display=none on the resolved element', () => {
      const modal = makeFakeElement();
      modal.style.display = 'flex';
      installFakeDocument({ 'my-modal': modal });
      closeModal('my-modal');
      expect(modal.style.display).toBe('none');
    });

    it('is idempotent when already hidden', () => {
      const modal = makeFakeElement();
      modal.style.display = 'none';
      installFakeDocument({ 'my-modal': modal });
      closeModal('my-modal');
      expect(modal.style.display).toBe('none');
    });

    it('warns and no-ops when the element is missing', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      installFakeDocument({});
      closeModal('missing-modal');
      expect(warn).toHaveBeenCalledOnce();
      expect(warn.mock.calls[0][0]).toContain('missing-modal');
    });
  });

  describe('open / close round-trip', () => {
    it('toggles display through open -> close -> open', () => {
      const modal = makeFakeElement();
      installFakeDocument({ 'my-modal': modal });
      openModal('my-modal');
      expect(modal.style.display).toBe('flex');
      closeModal('my-modal');
      expect(modal.style.display).toBe('none');
      openModal('my-modal');
      expect(modal.style.display).toBe('flex');
    });
  });
});
