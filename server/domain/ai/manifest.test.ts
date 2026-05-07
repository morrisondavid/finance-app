import { describe, it, expect } from 'vitest';
import * as Api from '../../../shared/api-contracts.js';
import { aiManifestDriftFingerprint, buildAiManifest } from './manifest.js';

describe('buildAiManifest', () => {
  it('lists only exports that exist on shared/api-contracts', () => {
    const m = buildAiManifest();
    for (const name of m.contractSchemaExports) {
      expect(Object.prototype.hasOwnProperty.call(Api, name), `missing export: ${name}`).toBe(
        true,
      );
    }
  });

  it('matches drift fingerprint snapshot', () => {
    expect(aiManifestDriftFingerprint()).toMatchSnapshot();
  });
});
