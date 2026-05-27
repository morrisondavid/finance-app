/**
 * Signed contract PDF on disk (`clients/contracts/<id>.pdf`) — GET + MCP base64 parity.
 */

import fs from 'fs';
import path from 'path';
import { findContractById } from '../../domain/contracts/index.js';
import { parseContractId } from '../read/contracts.js';

const CONTRACTS_DOCS_DIR = path.resolve(process.cwd(), 'clients', 'contracts');

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

  const docPath = path.join(CONTRACTS_DOCS_DIR, `${contract.id}.pdf`);
  if (!fs.existsSync(docPath)) {
    return {
      kind: 'json',
      status: 404,
      body: {
        error: 'ContractDocumentNotFound',
        detail: `No signed PDF found for ${contract.id}. Expected at clients/contracts/${contract.id}.pdf.`,
      },
    };
  }

  const buffer = fs.readFileSync(docPath);
  return { kind: 'pdf', filename: `${contract.id}.pdf`, buffer };
}
