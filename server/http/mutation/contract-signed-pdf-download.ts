/**
 * Signed contract documents on disk — GET + MCP base64 parity.
 *
 * Single file: `clients/contracts/<id>.pdf`
 * Multi file:  `clients/contracts/<id>/*.pdf` (MCP returns first PDF; HTTP streams zip)
 */

import fs from 'fs';
import { findContractById } from '../../domain/contracts/index.js';
import {
  contractDocumentNotFoundDetail,
  resolveContractDocumentBundle,
} from '../../domain/contracts/document-bundle.js';
import { parseContractId } from '../read/contracts.js';

export type ContractSignedPdfDownloadResult =
  | { readonly kind: 'pdf'; readonly filename: string; readonly buffer: Buffer }
  | { readonly kind: 'json'; readonly status: number; readonly body: Record<string, unknown> };

export function mutateContractSignedPdfDownload(rawContractId: string): ContractSignedPdfDownloadResult {
  const id = parseContractId(rawContractId);
  if (id === null) {
    return { kind: 'json', status: 404, body: { error: 'Contract not found' } };
  }
  const contract = findContractById(id);
  if (!contract) {
    return { kind: 'json', status: 404, body: { error: 'Contract not found' } };
  }

  const bundle = resolveContractDocumentBundle(contract.id);
  if (bundle === null) {
    return {
      kind: 'json',
      status: 404,
      body: {
        error: 'ContractDocumentNotFound',
        detail: contractDocumentNotFoundDetail(contract.id),
      },
    };
  }

  if (bundle.kind === 'single') {
    const buffer = fs.readFileSync(bundle.filePath);
    return { kind: 'pdf', filename: bundle.filename, buffer };
  }

  const buffer = fs.readFileSync(bundle.entries[0].filePath);
  return {
    kind: 'pdf',
    filename: bundle.entries[0].archiveName,
    buffer,
  };
}
