/**
 * Renders an invoice PDF to an in-memory buffer.
 *
 * `renderInvoicePdf(invoice, company, client)` builds the pdfmake
 * document definition via `buildInvoiceDocDefinition` and hands it to
 * pdfmake's `createPdf().getBuffer()` pipeline. The font configuration
 * lives here (standard PDFKit Helvetica — no binary font files needed,
 * no network access, no "No URL access policy" warnings for external
 * images because we never reference any).
 *
 * Called by the route handler and by `writeInvoicePdf`.
 */

import pdfMake from 'pdfmake';
import type {
  Client,
  Company,
  Invoice,
} from '../../../../shared/api-contracts.js';
import { buildInvoiceDocDefinition } from './doc-definition.js';

let fontsConfigured = false;

function configureFonts(): void {
  if (fontsConfigured) return;
  // Standard 14 PDFKit fonts ship with PDFKit itself — no asset loading.
  pdfMake.setFonts({
    Helvetica: {
      normal: 'Helvetica',
      bold: 'Helvetica-Bold',
      italics: 'Helvetica-Oblique',
      bolditalics: 'Helvetica-BoldOblique',
    },
  });
  // Deny every external URL: invoices reference only inline content
  // and bundled fonts, so there is never a legitimate fetch to allow.
  // Also silences pdfmake's "No URL access policy defined" warning.
  pdfMake.setUrlAccessPolicy(() => false);
  fontsConfigured = true;
}

/**
 * Render an invoice to a PDF buffer. Pure with respect to the file
 * system — callers decide whether to stream to HTTP or persist with
 * `writeInvoicePdf`.
 */
export async function renderInvoicePdf(
  invoice: Invoice,
  company: Company,
  client: Client,
): Promise<Buffer> {
  configureFonts();
  const docDefinition = buildInvoiceDocDefinition(invoice, company, client);
  const pdfDoc = pdfMake.createPdf(docDefinition);
  return await pdfDoc.getBuffer();
}
