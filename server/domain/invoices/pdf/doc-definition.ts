/**
 * Invoice PDF document definition — pure builder.
 *
 * `buildInvoiceDocDefinition(invoice, company, client)` returns the
 * pdfmake `TDocumentDefinitions` object that the render layer feeds
 * into the library. Pure — it never touches disk, the registry, or
 * the clock, which keeps the output deterministic and makes the
 * structural tests easy to read.
 *
 * The builder is company-shape-aware but deliberately avoids a
 * `switch (company.kind)` in its body: each sub-builder asks for the
 * specific field it needs (VAT row iff `vat_amount > 0`, bank block
 * reads sort/account for UK Ltd vs IBAN/SWIFT for FZCO). Adding a
 * third jurisdiction means extending the sub-builder data tables,
 * not forking the top-level builder.
 *
 * Fonts are intentionally left to the renderer — this file only
 * describes structural content.
 */

import type {
  Client,
  Company,
  Invoice,
} from '../../../../shared/api-contracts.js';
import type { Content, TDocumentDefinitions } from 'pdfmake/interfaces.js';

/** Money formatter: `subtotal: 12100` → `"£12,100.00"`. */
function formatCurrency(amount: number, currency: string): string {
  const symbol = currency === 'GBP' ? '£' : currency === 'AED' ? 'AED ' : `${currency} `;
  const body = amount.toLocaleString('en-GB', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${symbol}${body}`;
}

function formatIsoHuman(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

/** ISO date → `dd/mm/yy` — tighter than full year for table cells that share a row with other columns. */
function formatIsoDateUkShort(iso: string): string {
  const parts = iso.split('-');
  if (parts.length !== 3) return iso;
  const [y, m, d] = parts;
  if (y === undefined || m === undefined || d === undefined) return iso;
  return `${d}/${m}/${y.slice(-2)}`;
}

function buildHeaderBlock(company: Company): Content {
  const companyLegalName = company.legal_name;
  const regulatorLine =
    company.jurisdiction === 'UK'
      ? `${company.regulator} · Company No. ${company.company_number}${company.vat_registered === true && company.vat_number !== null && company.vat_number !== 'TBC' ? ` · VAT ${company.vat_number}` : ''}`
      : `${company.regulator} · License ${company.license_number} · Reg ${company.registration_number}`;
  return {
    columns: [
      {
        width: '*',
        stack: [
          { text: companyLegalName, style: 'h1', margin: [0, 0, 0, 6] },
          { text: company.address, style: 'address', margin: [0, 0, 0, 5] },
          { text: regulatorLine, style: 'small', margin: [0, 0, 0, 5] },
          { text: company.email, style: 'small' },
        ],
      },
      {
        width: 'auto',
        stack: [
          { text: 'INVOICE', style: 'h1', alignment: 'right' },
        ],
      },
    ],
    margin: [0, 0, 0, 20],
  };
}

function buildBillToBlock(client: Client): Content {
  // Agency clients get invoiced at the agency — the end-client block
  // is descriptive metadata, not the payer.
  const stack: Content[] = [
    { text: 'Bill to', style: 'label', margin: [0, 0, 0, 5] },
    { text: client.legal_name, bold: true, margin: [0, 0, 0, 5] },
    { text: client.billing_address, style: 'address', margin: [0, 0, 0, 5] },
  ];
  if (client.primary_contact_name !== null && client.primary_contact_name !== 'TBC') {
    stack.push({
      text: `Attn: ${client.primary_contact_name}`,
      style: 'small',
      margin: [0, 0, 0, 4],
    });
  }
  if (client.vat_number !== null && client.vat_number !== 'TBC') {
    stack.push({ text: `VAT: ${client.vat_number}`, style: 'small' });
  }
  return {
    columns: [
      {
        width: '*',
        stack,
      },
    ],
    margin: [0, 0, 0, 16],
  };
}

function buildInvoiceMetaBlock(invoice: Invoice): Content {
  const refSame = invoice.payment_reference === invoice.invoice_number;
  const refRows: [Content, Content][] = refSame
    ? [
        [
          { text: 'Invoice / payment ref.', style: 'label' },
          {
            text: invoice.invoice_number,
            bold: true,
          },
        ],
      ]
    : [
        [{ text: 'Invoice no.', style: 'label' }, { text: invoice.invoice_number, bold: true }],
        [
          { text: 'Payment reference', style: 'label' },
          { text: invoice.payment_reference },
        ],
      ];

  const body: [Content, Content][] = [
    ...refRows,
    [{ text: 'Invoice date', style: 'label' }, { text: formatIsoHuman(invoice.invoice_date) }],
    [{ text: 'Due date', style: 'label' }, { text: formatIsoHuman(invoice.due_date) }],
  ];

  return {
    columns: [
      {
        width: '*',
        table: {
          widths: ['auto', '*'],
          body,
        },
        layout: {
          hLineWidth: () => 0,
          vLineWidth: () => 0,
          paddingTop: () => 4,
          paddingBottom: () => 4,
          paddingLeft: () => 0,
          paddingRight: () => 0,
        },
      },
    ],
    margin: [0, 0, 0, 16],
  };
}

function dayRateFromInvoice(invoice: Invoice): number {
  return invoice.days_billed > 0 ? invoice.subtotal / invoice.days_billed : 0;
}

function buildDayRateSummaryLine(invoice: Invoice): Content {
  const rate = dayRateFromInvoice(invoice);
  const dayLabel = invoice.days_billed === 1 ? 'day' : 'days';
  const line =
    invoice.days_billed > 0
      ? `${invoice.days_billed} ${dayLabel} at ${formatCurrency(rate, invoice.currency)} / day`
      : `Day rate: ${formatCurrency(rate, invoice.currency)} / day`;
  return { text: line, style: 'small', margin: [0, 0, 0, 6] };
}

function buildLineItemsTable(invoice: Invoice): Content {
  // Single-line period: compact en-dash (no spaces) + narrow column font so
  // pdfmake does not hyphenate/wrap mid-range.
  const period = `${formatIsoDateUkShort(invoice.period_start)}\u2013${formatIsoDateUkShort(invoice.period_end)}`;
  return {
    table: {
      headerRows: 1,
      // `*` fills remaining width so the grid spans the full content column (A4 minus margins).
      widths: ['*', 128, 36, 72],
      body: [
        [
          { text: 'Description', style: 'th' },
          { text: 'Period', style: 'th', alignment: 'right' },
          { text: 'Days', style: 'th', alignment: 'right' },
          { text: 'Amount', style: 'th', alignment: 'right' },
        ],
        [
          { text: invoice.description },
          {
            text: period,
            alignment: 'right',
            fontSize: 9,
            noWrap: true,
          },
          { text: String(invoice.days_billed), alignment: 'right' },
          { text: formatCurrency(invoice.subtotal, invoice.currency), alignment: 'right' },
        ],
      ],
    },
    layout: {
      hLineColor: () => '#cccccc',
      vLineColor: () => '#ffffff',
      hLineWidth: (i: number) => (i === 0 || i === 1 ? 0.5 : 0),
      vLineWidth: () => 0,
      paddingTop: () => 6,
      paddingBottom: () => 6,
    },
    margin: [0, 0, 0, 0],
  };
}

/** Day-rate summary (above the table) + line items without repeating rate in a narrow column. */
function buildLineItemsSection(invoice: Invoice): Content {
  return {
    stack: [buildDayRateSummaryLine(invoice), buildLineItemsTable(invoice)],
    margin: [0, 0, 0, 16],
  };
}

function buildTotalsBlock(invoice: Invoice): Content {
  const totalRows: Content[] = [];

  const subtotalRow: Content = {
    columns: [
      { width: '*', text: '' },
      { width: 120, text: 'Subtotal', alignment: 'right', style: 'label' },
      {
        width: 100,
        text: formatCurrency(invoice.subtotal, invoice.currency),
        alignment: 'right',
      },
    ],
    margin: [0, 0, 0, 6],
  };
  totalRows.push(subtotalRow);

  // VAT row only shown when there is VAT to declare — FZCO invoices
  // drop this row entirely, UK Ltd invoices show it with the applied
  // rate.
  if (invoice.vat_amount > 0) {
    totalRows.push({
      columns: [
        { width: '*', text: '' },
        {
          width: 120,
          text: `VAT (${(invoice.vat_rate * 100).toFixed(0)}%)`,
          alignment: 'right',
          style: 'label',
        },
        {
          width: 100,
          text: formatCurrency(invoice.vat_amount, invoice.currency),
          alignment: 'right',
        },
      ],
      margin: [0, 0, 0, 6],
    });
  }

  totalRows.push({
    columns: [
      { width: '*', text: '' },
      { width: 120, text: 'Total', alignment: 'right', bold: true },
      {
        width: 100,
        text: formatCurrency(invoice.total, invoice.currency),
        alignment: 'right',
        bold: true,
      },
    ],
    margin: [0, 8, 0, 0],
  });

  return { stack: totalRows, margin: [0, 0, 0, 24] };
}

function buildFooterBlock(company: Company): Content {
  const bankLines: string[] = [];
  bankLines.push('Bank details');
  if (company.jurisdiction === 'UK') {
    if (company.bank_sort_code !== null) {
      bankLines.push(`Sort code: ${company.bank_sort_code}`);
    }
    if (company.bank_account_number !== null) {
      bankLines.push(`Account number: ${company.bank_account_number}`);
    }
  } else {
    if (company.iban !== null && company.iban !== 'TBC') {
      bankLines.push(`IBAN: ${company.iban}`);
    }
    if (company.swift_bic !== null && company.swift_bic !== 'TBC') {
      bankLines.push(`SWIFT/BIC: ${company.swift_bic}`);
    }
  }
  bankLines.push(`Account name: ${company.legal_name}`);

  return {
    stack: bankLines.map((line, i) => ({
      text: line,
      style: i === 0 ? 'label' : 'small',
      margin: i === 0 ? [0, 0, 0, 2] : [0, 0, 0, 0],
    })),
    margin: [0, 16, 0, 0],
  };
}

/**
 * Canonical document definition for an invoice. Consumed by
 * `renderInvoicePdf` (prod) and by `doc-definition.test.ts`
 * (structural snapshot).
 */
export function buildInvoiceDocDefinition(
  invoice: Invoice,
  company: Company,
  client: Client,
): TDocumentDefinitions {
  return {
    info: {
      title: `Invoice ${invoice.invoice_number}`,
      author: company.legal_name,
      subject: `Invoice ${invoice.invoice_number} for ${client.legal_name}`,
    },
    pageSize: 'A4',
    pageMargins: [40, 40, 40, 60],
    defaultStyle: {
      font: 'Helvetica',
      fontSize: 10,
      color: '#1f2937',
    },
    styles: {
      h1: { fontSize: 20, bold: true, lineHeight: 1.22 },
      label: { fontSize: 9, color: '#6b7280', bold: false, lineHeight: 1.45 },
      small: { fontSize: 9, color: '#4b5563', lineHeight: 1.45 },
      /** Roomy line height for postal addresses and header copy. */
      address: { fontSize: 9, color: '#4b5563', lineHeight: 1.45 },
      th: { fontSize: 9, bold: true, color: '#6b7280' },
    },
    content: [
      buildHeaderBlock(company),
      buildBillToBlock(client),
      buildInvoiceMetaBlock(invoice),
      buildLineItemsSection(invoice),
      buildTotalsBlock(invoice),
      buildFooterBlock(company),
    ],
  };
}
