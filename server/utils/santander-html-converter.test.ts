import { describe, it, expect } from 'vitest';
import { convertSantanderHtmlToCsv, isSantanderHtmlExport } from './santander-html-converter.js';

/** Build a Santander-style table with a header and a list of data rows. */
function buildExport(dataRows: string[]): string {
  return [
    '<!DOCTYPE html><html><body><table>',
    '<tr><td /><td style="TDSeparadorDoble">Transactions</td></tr>',
    '<tr><td id="TDSeparadorInicial" /><td id="TDNoWrappedLeftDoble"><font id="CabeceraCuerpo">XXXX XXXX XXXX 3062</font></td><td /><td><font id="CuerpoDetalle">20/03/2025 To 03/05/2025</font></td></tr>',
    '<tr><td /><td id="TDSubTituloBorderBotton">Date</td><td /><td id="TDSubTituloBorderBotton">Card</td><td /><td id="TDSubTituloBorderBotton">Description</td><td /><td id="TDSubTituloBorderBotton">Money in</td><td /><td id="TDSubTituloBorderBotton">Money Out</td></tr>',
    ...dataRows,
    '</table></body></html>',
  ].join('');
}

/**
 * Helper: build a data row laid out exactly as Santander produces - ten `<td>`
 * slots where slots 0/2/4/6/8 are self-closing separators and slots 1/3/5/7/9
 * carry the date, card, description, money in, money out respectively.
 */
function row(date: string, card: string, description: string, moneyIn: string, moneyOut: string): string {
  const cell = (txt: string) => (txt === ''
    ? '<td id="TDListadoBorderBottom" />'
    : `<td id="CuerpoDetalle"><font id="CuerpoDetalle">${txt}</font></td>`);
  return [
    '<tr>',
    '<td id="TDSeparadorInicial" />',
    cell(date),
    '<td id="TDListadoBorderBottom" />',
    cell(card),
    '<td id="TDListadoBorderBottom" />',
    cell(description),
    '<td id="TDListadoBorderBottom" />',
    cell(moneyIn),
    '<td id="TDListadoBorderBottom" />',
    cell(moneyOut),
    '</tr>',
  ].join('');
}

describe('convertSantanderHtmlToCsv', () => {
  it('emits a header line followed by data rows', () => {
    const html = buildExport([
      row('2025-03-25', '** 3062', 'PURCHASE - DOMESTIC SHELL ROMFORD', '', '£ 16.69'),
    ]);

    const csv = convertSantanderHtmlToCsv(html);
    const lines = csv.trimEnd().split('\n');

    expect(lines[0]).toBe('Date,Card,Description,Amount');
    expect(lines[1]).toBe('2025-03-25,** 3062,PURCHASE - DOMESTIC SHELL ROMFORD,16.69');
  });

  it('classifies Money In cells as negative amounts (payment reduces debt)', () => {
    const html = buildExport([
      row('2025-05-02', '** 3062', 'DD PAYMENT RECEIVED D/DEBIT', '£ 77.56', ''),
    ]);

    const csv = convertSantanderHtmlToCsv(html);
    const dataLine = csv.trimEnd().split('\n')[1];

    expect(dataLine).toBe('2025-05-02,** 3062,DD PAYMENT RECEIVED D/DEBIT,-77.56');
  });

  it('classifies Money Out cells as positive amounts (spend increases debt)', () => {
    const html = buildExport([
      row('2025-03-20', '** 3062', 'BALANCE TRANSFER     MERCH', '', '£ 7,230.00'),
      row('2025-08-08', '** 3062', 'LATE PAYMENT FEE', '', '£ 12.00'),
    ]);

    const lines = convertSantanderHtmlToCsv(html).trimEnd().split('\n');

    expect(lines[1]).toBe('2025-03-20,** 3062,BALANCE TRANSFER MERCH,7230.00');
    expect(lines[2]).toBe('2025-08-08,** 3062,LATE PAYMENT FEE,12.00');
  });

  it('drops INITIAL BALANCE rows (they are statement carry-over, not transactions)', () => {
    const html = buildExport([
      row('2025-04-08', '** 3062', 'INITIAL BALANCE', '', '£ 7,755.69'),
      row('2025-05-02', '** 3062', 'DD PAYMENT RECEIVED D/DEBIT', '£ 77.56', ''),
    ]);

    const lines = convertSantanderHtmlToCsv(html).trimEnd().split('\n');

    expect(lines).toHaveLength(2); // header + one real row
    expect(lines[1]).toContain('DD PAYMENT RECEIVED');
  });

  it('ignores the header row (Date/Card/Description) and non-transaction rows', () => {
    const html = buildExport([
      row('2025-03-25', '** 3062', 'PURCHASE - DOMESTIC SHELL', '', '£ 16.69'),
    ]);

    const lines = convertSantanderHtmlToCsv(html).trimEnd().split('\n');
    // Header + exactly one data row; the "Date | Card | Description | Money in | Money Out"
    // row must not slip through as a transaction.
    expect(lines).toHaveLength(2);
  });

  it('recognises the lone low-surrogate \\uDCA3 form of the pound sign', () => {
    const html = buildExport([
      row('2025-03-25', '** 3062', 'PURCHASE', '', '\uDCA3 509.00'),
    ]);

    const line = convertSantanderHtmlToCsv(html).trimEnd().split('\n')[1];
    expect(line).toBe('2025-03-25,** 3062,PURCHASE,509.00');
  });

  it('collapses multiple spaces in descriptions but preserves content', () => {
    const html = buildExport([
      row('2025-03-25', '** 3062', 'PURCHASE - DOMESTIC            ROMFORD                    SHELL ROMFORD', '', '£ 16.69'),
    ]);

    const line = convertSantanderHtmlToCsv(html).trimEnd().split('\n')[1];
    expect(line).toBe('2025-03-25,** 3062,PURCHASE - DOMESTIC ROMFORD SHELL ROMFORD,16.69');
  });

  it('tolerates rows where the Card cell is empty (observed in malformed exports)', () => {
    const html = buildExport([
      row('2025-08-08', '', 'LATE PAYMENT FEE', '', '£ 12.00'),
    ]);

    const line = convertSantanderHtmlToCsv(html).trimEnd().split('\n')[1];
    // Missing card is backfilled to "** 3062" so downstream CSV rows stay uniform.
    expect(line).toBe('2025-08-08,** 3062,LATE PAYMENT FEE,12.00');
  });

  it('emits zero data rows when the HTML contains no transactions', () => {
    const html = buildExport([]);
    const csv = convertSantanderHtmlToCsv(html);
    expect(csv.trimEnd()).toBe('Date,Card,Description,Amount');
  });

  it('quotes description fields that contain commas', () => {
    const html = buildExport([
      row('2025-03-25', '** 3062', 'PURCHASE, COMMA SHOP', '', '£ 10.00'),
    ]);
    const line = convertSantanderHtmlToCsv(html).trimEnd().split('\n')[1];
    expect(line).toBe('2025-03-25,** 3062,"PURCHASE, COMMA SHOP",10.00');
  });
});

describe('isSantanderHtmlExport', () => {
  it('returns true for an HTML DOCTYPE preamble', () => {
    expect(isSantanderHtmlExport('<!DOCTYPE html><html><body></body></html>')).toBe(true);
  });

  it('returns true for leading whitespace before the doctype', () => {
    expect(isSantanderHtmlExport('  \n<!DOCTYPE html><html></html>')).toBe(true);
  });

  it('returns true for raw <table> openings', () => {
    expect(isSantanderHtmlExport('<table><tr><td>a</td></tr></table>')).toBe(true);
  });

  it('returns false for plain CSV input', () => {
    expect(isSantanderHtmlExport('Date,Card,Description,Amount\n2025-01-01,** 3062,X,1.00')).toBe(false);
  });
});
