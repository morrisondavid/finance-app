/**
 * Single wrapper around `pdf-parse`.
 *
 * Every self-bill ingestion pathway goes through `extractPdfText` so
 * the `pdf-parse` import lives in exactly one place. That keeps the
 * bundle surface tight and makes it trivial to swap the underlying
 * library later (tried `pdfjs-dist` directly; not worth the boilerplate
 * for our two supported layouts).
 *
 * `pdf-parse` 2.x exposes a `PDFParse` class with `getText()` — the
 * older `@types/pdf-parse` definitions target 1.x and are wrong for
 * our version, so we consume the library's shipped types directly
 * (see `node_modules/pdf-parse/dist/pdf-parse/cjs/index.d.cts`).
 */

import { PDFParse } from 'pdf-parse';

/**
 * Return the concatenated text of every page in `buffer`, in document
 * order. Intended for parser consumption — callers pass the returned
 * string to layout-specific regex helpers.
 */
export async function extractPdfText(buffer: Buffer): Promise<string> {
  const parser = new PDFParse({ data: new Uint8Array(buffer) });
  try {
    const result = await parser.getText();
    return result.text;
  } finally {
    await parser.destroy();
  }
}
