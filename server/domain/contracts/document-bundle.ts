/**
 * Resolve signed contract documents on disk.
 *
 * Convention (backward compatible):
 *   - `clients/contracts/<id>.pdf` — single PDF download
 *   - `clients/contracts/<id>/*.pdf` — multi-document zip download
 */

import fs from 'fs';
import path from 'path';

export const CONTRACTS_DOCS_DIR = path.resolve(process.cwd(), 'clients', 'contracts');

export type ContractDocumentBundle =
  | { readonly kind: 'single'; readonly filePath: string; readonly filename: string }
  | {
      readonly kind: 'directory';
      readonly dirPath: string;
      readonly entries: readonly { readonly filePath: string; readonly archiveName: string }[];
      readonly zipFilename: string;
    };

function listPdfFilesInDir(dirPath: string): string[] {
  return fs.readdirSync(dirPath)
    .filter(name => name.toLowerCase().endsWith('.pdf'))
    .sort((a, b) => a.localeCompare(b));
}

export function resolveContractDocumentBundle(
  contractId: string,
  docsDir: string = CONTRACTS_DOCS_DIR,
): ContractDocumentBundle | null {
  const singlePath = path.join(docsDir, `${contractId}.pdf`);
  if (fs.existsSync(singlePath) && fs.statSync(singlePath).isFile()) {
    return { kind: 'single', filePath: singlePath, filename: `${contractId}.pdf` };
  }

  const dirPath = path.join(docsDir, contractId);
  if (fs.existsSync(dirPath) && fs.statSync(dirPath).isDirectory()) {
    const pdfNames = listPdfFilesInDir(dirPath);
    if (pdfNames.length === 0) return null;
    return {
      kind: 'directory',
      dirPath,
      entries: pdfNames.map(name => ({
        filePath: path.join(dirPath, name),
        archiveName: name,
      })),
      zipFilename: `${contractId}-documents.zip`,
    };
  }

  return null;
}

export function contractDocumentNotFoundDetail(contractId: string): string {
  return (
    `No signed documents found for ${contractId}. ` +
    `Expected clients/contracts/${contractId}.pdf or clients/contracts/${contractId}/*.pdf.`
  );
}
