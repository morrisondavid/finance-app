/**
 * S3 durable publish for invoice upload / self-bill ingest / supplier-issued generate.
 */

import path from 'path';
import { INGESTED_PDF_SUBDIR } from '../domain/invoices/pdf/ingested.js';
import { getRelativePdfPath } from '../domain/invoices/pdf/write.js';
import { INVOICES_CSV_FILENAME } from '../domain/invoices/csv-io.js';
import type { Invoice } from '../../shared/api-contracts.js';
import type { InvoiceUploadIngestResult } from '../types.js';
import { REPO_ROOT } from '../repo-root.js';
import { recomputeAndPersistDataManifest } from '../data-manifest.js';
import { uploadDurableRelPathsToS3 } from '../storage/s3-durable-sync.js';

export interface InvoiceUploadDiskTouch {
  readonly outcome: InvoiceUploadIngestResult;
  /** Absolute path on disk for `archived-only` rows kept under `invoices/`. */
  readonly archivedAbsolutePath?: string;
}

function ingestedPdfRelPath(invoiceId: string): string {
  return `invoices/${INGESTED_PDF_SUBDIR}/${invoiceId}.pdf`;
}

function archivedInvoicesRelPath(absolutePath: string): string | null {
  const rel = path.relative(REPO_ROOT, absolutePath).split(path.sep).join('/');
  if (!rel.startsWith('invoices/')) {
    return null;
  }
  return rel;
}

/** Repo-relative POSIX paths touched by a successful invoice upload batch. */
export function collectInvoiceUploadDurableRelPaths(
  touches: readonly InvoiceUploadDiskTouch[],
): string[] {
  const paths = new Set<string>();
  let anyIngested = false;

  for (const touch of touches) {
    const { outcome } = touch;
    if (outcome.outcome === 'ingested' && outcome.invoiceId !== undefined) {
      anyIngested = true;
      paths.add(ingestedPdfRelPath(outcome.invoiceId));
      continue;
    }
    if (outcome.outcome === 'archived-only' && touch.archivedAbsolutePath !== undefined) {
      const rel = archivedInvoicesRelPath(touch.archivedAbsolutePath);
      if (rel !== null) {
        paths.add(rel);
      }
    }
  }

  if (anyIngested) {
    paths.add(`invoices/${INVOICES_CSV_FILENAME}`);
  }

  return [...paths];
}

async function publishInvoiceDurableRelPaths(relPaths: string[], reason: string): Promise<void> {
  if (relPaths.length === 0) {
    return;
  }

  recomputeAndPersistDataManifest();
  try {
    await uploadDurableRelPathsToS3([...relPaths, 'data/manifest.json'], reason);
  } catch (err) {
    console.error(`[${reason}] S3 durable upload failed:`, err);
  }
}

/** Repo-relative paths a successful supplier-issued generate touches. */
export function collectGeneratedInvoiceDurableRelPaths(invoice: Invoice): string[] {
  return [getRelativePdfPath(invoice), `invoices/${INVOICES_CSV_FILENAME}`];
}

export async function publishGeneratedInvoiceArtifacts(invoice: Invoice): Promise<void> {
  await publishInvoiceDurableRelPaths(
    collectGeneratedInvoiceDurableRelPaths(invoice),
    'invoice-generate',
  );
}

export async function publishInvoiceUploadArtifacts(
  touches: readonly InvoiceUploadDiskTouch[],
): Promise<void> {
  const relPaths = collectInvoiceUploadDurableRelPaths(touches);
  await publishInvoiceDurableRelPaths(relPaths, 'invoice-upload');
}
