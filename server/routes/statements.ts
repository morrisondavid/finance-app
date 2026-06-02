import express, { Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import archiver from 'archiver';
import type { AccountName } from '../types.js';
import { ACCOUNTS } from '../types.js';
import { accountsForEntity, getAccountConfig, businessAccounts } from '../domain/accounts/index.js';
import { listInvoicesByIssuingEntityId } from '../domain/invoices/index.js';
import { resolveReportingPeriod } from '../domain/reporting/index.js';
import { EntityIdSchema, ReportingRegimeSchema } from '../../shared/api-contracts.js';
import type { ReportingRegime } from '../../shared/api-contracts.js';
import { formatFinancialYearPackName, formatQuarterName } from '../../shared/formatting.js';
import {
  INVOICES_UPLOAD_DIR as INVOICES_DIR,
  REPO_ROOT,
  STATEMENTS_DIR,
  matchesQuarter,
  listFilesInDir,
} from '../domain/statements/statement-files-catalog.js';

export { matchesQuarter } from '../domain/statements/statement-files-catalog.js';
import type {
  StatementsResponse,
  StatementYearsResponse,
  CheckQuarterResponse,
  StatementInvoiceUploadsListResponse
} from '../../shared/api-contracts.js';

import { sendJsonRead } from '../http/read/send-json-read.js';
import {
  readStatementYears,
  readStatementsIndexFromQuery,
  readStatementsQuarterCheck,
  readStatementLedgerAccounts,
  readStatementsForLedgerAccount,
  readStatementBulkInvoiceUploads,
} from '../http/read/statements-read.js';

const router = express.Router();

interface StatementsQuery {
  search?: string;
  year?: string;
  month?: string;
  quarter?: string;
}

// GET /api/statements/years - Get list of available years (lightweight)
router.get('/years', (_req: Request, res: Response<StatementYearsResponse>) => {
  sendJsonRead(res, readStatementYears());
});

// GET /api/statements - List all statements grouped by account
router.get('/', (req: Request<object, StatementsResponse, object, StatementsQuery>, res: Response<StatementsResponse>) => {
  sendJsonRead(res, readStatementsIndexFromQuery(req.query as Record<string, unknown>));
});

// GET /api/statements/download-all - Download all filtered statements as ZIP
router.get('/download-all', (req: Request<object, unknown, object, StatementsQuery>, res: Response) => {
  const { search, year, month, quarter } = req.query;
  
  // Collect all matching files
  interface FileToZip {
    path: string;
    name: string;
  }
  const filesToZip: FileToZip[] = [];
  
  for (const account of ACCOUNTS) {
    const accountDir = path.join(STATEMENTS_DIR, account);
    const pdfDir = path.join(accountDir, 'pdf');
    const csvDir = path.join(accountDir, 'csv');
    
    let pdfs = listFilesInDir(pdfDir);
    let csvs = listFilesInDir(csvDir);
    
    // Apply same filters as the list endpoint
    if (search) {
      const searchLower = search.toLowerCase();
      pdfs = pdfs.filter(f => f.filename.toLowerCase().includes(searchLower));
      csvs = csvs.filter(f => f.filename.toLowerCase().includes(searchLower));
    }
    
    if (quarter) {
      const overlap = getAccountConfig(account as AccountName).quarterOverlapMonths ?? 0;
      pdfs = pdfs.filter(f => matchesQuarter(f.displayDate, quarter, overlap));
      csvs = csvs.filter(f => matchesQuarter(f.displayDate, quarter, overlap));
    } else {
      if (year) {
        pdfs = pdfs.filter(f => f.displayDate.startsWith(year));
        csvs = csvs.filter(f => f.displayDate.startsWith(year));
      }
      
      if (month) {
        const monthPadded = month.toString().padStart(2, '0');
        pdfs = pdfs.filter(f => f.displayDate.endsWith(`-${monthPadded}`));
        csvs = csvs.filter(f => f.displayDate.endsWith(`-${monthPadded}`));
      }
    }
    
    // Add files with account prefix to avoid name collisions
    pdfs.forEach(f => {
      filesToZip.push({
        path: path.join(pdfDir, f.filename),
        name: `${account}/pdf/${f.filename}`
      });
    });
    
    csvs.forEach(f => {
      filesToZip.push({
        path: path.join(csvDir, f.filename),
        name: `${account}/csv/${f.filename}`
      });
    });
  }
  
  if (filesToZip.length === 0) {
    res.status(404).json({ error: 'No files match the selected filters' });
    return;
  }
  
  // Generate ZIP filename
  let zipName = 'statements';
  if (quarter) {
    zipName = `statements-${quarter}`;
  } else if (year && month) {
    zipName = `statements-${year}-${month.toString().padStart(2, '0')}`;
  } else if (year) {
    zipName = `statements-${year}`;
  }
  zipName += '.zip';
  
  // Set response headers for ZIP download
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="${zipName}"`);
  
  // Create archive and pipe to response
  const archive = archiver('zip', { zlib: { level: 9 } });
  
  archive.on('error', (err) => {
    console.error('Archive error:', err);
    res.status(500).json({ error: 'Failed to create archive' });
  });
  
  archive.pipe(res);
  
  // Add files to archive
  filesToZip.forEach(file => {
    if (fs.existsSync(file.path)) {
      archive.file(file.path, { name: file.name });
    }
  });
  
  archive.finalize();
});

// Helper to get business accounts only
function getBusinessAccounts(): readonly AccountName[] {
  return businessAccounts();
}

interface AccountantPackQuery {
  quarter?: string;
  period?: string;
  regime?: string;
  entityId?: string;
}

// GET /api/statements/check-quarter - Check for missing files in a quarter
router.get('/check-quarter', (req: Request<object, CheckQuarterResponse, object, AccountantPackQuery>, res: Response) => {
  const quarter = req.query.quarter;
  if (typeof quarter !== 'string' || quarter.trim() === '') {
    res.status(400).json({ error: 'Quarter parameter required' });
    return;
  }
  sendJsonRead(res, readStatementsQuarterCheck(quarter));
});

// GET /api/statements/download-for-accountant - VAT quarter or CT financial year pack
router.get('/download-for-accountant', (req: Request<object, unknown, object, AccountantPackQuery>, res: Response) => {
  const regimeRaw = typeof req.query.regime === 'string' ? req.query.regime : 'vat';
  const regimeParsed = ReportingRegimeSchema.safeParse(regimeRaw);
  if (!regimeParsed.success) {
    res.status(400).json({ error: 'Invalid regime' });
    return;
  }
  const regime: ReportingRegime = regimeParsed.data;

  const periodLabel =
    (typeof req.query.period === 'string' && req.query.period.trim() !== ''
      ? req.query.period.trim()
      : undefined) ??
    (typeof req.query.quarter === 'string' && req.query.quarter.trim() !== ''
      ? req.query.quarter.trim()
      : undefined);

  if (!periodLabel) {
    res.status(400).json({ error: 'Period parameter required' });
    return;
  }

  let resolved;
  try {
    resolved = resolveReportingPeriod(regime, periodLabel);
  } catch {
    res.status(400).json({ error: 'Invalid period' });
    return;
  }

  const entityParsed = EntityIdSchema.safeParse(req.query.entityId);
  const packAccounts =
    entityParsed.success ? accountsForEntity(entityParsed.data) : getBusinessAccounts();

  const monthKeySet = new Set(resolved.monthKeys);

  interface FileToZip {
    path: string;
    name: string;
  }
  const filesToZip: FileToZip[] = [];

  for (const account of packAccounts) {
    const accountConfig = getAccountConfig(account);
    const accountDir = path.join(STATEMENTS_DIR, account);
    const pdfDir = path.join(accountDir, 'pdf');
    const csvDir = path.join(accountDir, 'csv');

    let pdfs = listFilesInDir(pdfDir);
    let csvs = listFilesInDir(csvDir);

    const overlap = accountConfig.quarterOverlapMonths ?? 0;
    const fileInPeriod = (displayDate: string): boolean =>
      regime === 'vat'
        ? matchesQuarter(displayDate, periodLabel, overlap)
        : monthKeySet.has(displayDate);

    pdfs = pdfs.filter(f => fileInPeriod(f.displayDate));
    csvs = csvs.filter(f => fileInPeriod(f.displayDate));

    const folderName = accountConfig.label.toLowerCase().replace(/\s+/g, '-');

    pdfs.forEach(f => {
      filesToZip.push({
        path: path.join(pdfDir, f.filename),
        name: `${folderName}/pdf/${f.filename}`,
      });
    });

    csvs.forEach(f => {
      filesToZip.push({
        path: path.join(csvDir, f.filename),
        name: `${folderName}/csv/${f.filename}`,
      });
    });
  }

  if (entityParsed.success && entityParsed.data === 'autonize-it-ltd') {
    for (const inv of listInvoicesByIssuingEntityId('autonize-it-ltd')) {
      if (
        inv.pdf_path !== null &&
        inv.invoice_date >= resolved.startDate &&
        inv.invoice_date <= resolved.endDate
      ) {
        const invoicePath = path.join(REPO_ROOT, inv.pdf_path);
        if (fs.existsSync(invoicePath)) {
          filesToZip.push({
            path: invoicePath,
            name: `invoices/${path.basename(inv.pdf_path)}`,
          });
        }
      }
    }
  }

  if (filesToZip.length === 0) {
    res.status(404).json({ error: 'No files found for the selected period' });
    return;
  }

  const zipName =
    regime === 'vat'
      ? `${formatQuarterName(periodLabel)}.zip`
      : `${formatFinancialYearPackName(periodLabel)}.zip`;
  
  // Set response headers for ZIP download
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="${zipName}"`);
  
  // Create archive and pipe to response
  const archive = archiver('zip', { zlib: { level: 9 } });
  
  archive.on('error', (err) => {
    console.error('Archive error:', err);
    res.status(500).json({ error: 'Failed to create archive' });
  });
  
  archive.pipe(res);
  
  // Add files to archive
  filesToZip.forEach(file => {
    if (fs.existsSync(file.path)) {
      archive.file(file.path, { name: file.name });
    }
  });
  
  archive.finalize();
});

interface SelectedFile {
  account: string;
  type: 'pdf' | 'csv';
  filename: string;
}

interface DownloadSelectedBody {
  files: SelectedFile[];
}

// POST /api/statements/download-selected - Download selected files as ZIP
router.post('/download-selected', (req: Request<object, unknown, DownloadSelectedBody>, res: Response) => {
  const { files } = req.body;
  
  if (!files || !Array.isArray(files) || files.length === 0) {
    res.status(400).json({ error: 'No files selected' });
    return;
  }
  
  interface FileToZip {
    path: string;
    name: string;
  }
  const filesToZip: FileToZip[] = [];
  
  files.forEach(file => {
    if (!ACCOUNTS.includes(file.account as typeof ACCOUNTS[number])) {
      return; // Skip invalid accounts
    }
    
    if (file.type !== 'pdf' && file.type !== 'csv') {
      return; // Skip invalid types
    }
    
    const accountConfig = getAccountConfig(file.account as AccountName);
    const folderName = accountConfig.label.toLowerCase().replace(/\s+/g, '-');
    const filePath = path.join(STATEMENTS_DIR, file.account, file.type, file.filename);
    
    if (fs.existsSync(filePath)) {
      filesToZip.push({
        path: filePath,
        name: `${folderName}/${file.type}/${file.filename}`
      });
    }
  });
  
  if (filesToZip.length === 0) {
    res.status(404).json({ error: 'No valid files found' });
    return;
  }
  
  const zipName = `selected-statements-${new Date().toISOString().slice(0, 10)}.zip`;
  
  // Set response headers for ZIP download
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="${zipName}"`);
  
  // Create archive and pipe to response
  const archive = archiver('zip', { zlib: { level: 9 } });
  
  archive.on('error', (err) => {
    console.error('Archive error:', err);
    res.status(500).json({ error: 'Failed to create archive' });
  });
  
  archive.pipe(res);
  
  // Add files to archive
  filesToZip.forEach(file => {
    archive.file(file.path, { name: file.name });
  });
  
  archive.finalize();
});

// GET /api/statements/accounts - List available accounts
router.get('/accounts', (_req: Request, res: Response) => {
  sendJsonRead(res, readStatementLedgerAccounts());
});

interface AccountParams {
  account: string;
}

// GET /api/statements/:account - List statements for specific account
router.get('/:account', (req: Request<AccountParams>, res: Response) => {
  sendJsonRead(res, readStatementsForLedgerAccount(req.params.account));
});

interface DownloadParams {
  account: string;
  type: string;
  filename: string;
}

// GET /api/statements/download/:account/:type/:filename - Download a file
router.get('/download/:account/:type/:filename', (req: Request<DownloadParams>, res: Response) => {
  const { account, type, filename } = req.params;
  
  if (!ACCOUNTS.includes(account as typeof ACCOUNTS[number])) {
    res.status(404).json({ error: 'Account not found' });
    return;
  }
  
  if (!['pdf', 'csv'].includes(type)) {
    res.status(400).json({ error: 'Invalid file type' });
    return;
  }
  
  const filePath = path.join(STATEMENTS_DIR, account, type, filename);
  
  if (!fs.existsSync(filePath)) {
    res.status(404).json({ error: 'File not found' });
    return;
  }
  
  res.download(filePath);
});

// GET /api/statements/invoices - List invoices
router.get('/invoices/list', (_req: Request, res: Response<StatementInvoiceUploadsListResponse>) => {
  sendJsonRead(res, readStatementBulkInvoiceUploads());
});

interface InvoiceDownloadParams {
  filename: string;
}

// GET /api/statements/invoices/download/:filename - Download an invoice
router.get('/invoices/download/:filename', (req: Request<InvoiceDownloadParams>, res: Response) => {
  const { filename } = req.params;
  const filePath = path.join(INVOICES_DIR, filename);
  
  if (!fs.existsSync(filePath)) {
    res.status(404).json({ error: 'File not found' });
    return;
  }
  
  res.download(filePath);
});

export default router;
