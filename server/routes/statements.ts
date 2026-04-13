import express, { Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import archiver from 'archiver';
import type { FileInfo, ExtractedDate, AllStatements, AccountStatements, AccountName } from '../types.js';
import { ACCOUNTS, ACCOUNT_CONFIG } from '../types.js';
import type {
  StatementsResponse,
  StatementYearsResponse,
  CheckQuarterResponse,
  AccountStatementResponse,
  InvoicesListResponse
} from '../../shared/api-contracts.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();

const STATEMENTS_DIR = path.join(__dirname, '../../statements');
const INVOICES_DIR = path.join(__dirname, '../../invoices');

const MONTH_MAP: Record<string, string> = {
  'jan': '01', 'january': '01',
  'feb': '02', 'february': '02',
  'mar': '03', 'march': '03',
  'apr': '04', 'april': '04',
  'may': '05',
  'jun': '06', 'june': '06',
  'jul': '07', 'july': '07',
  'aug': '08', 'august': '08',
  'sep': '09', 'september': '09',
  'oct': '10', 'october': '10',
  'nov': '11', 'november': '11',
  'dec': '12', 'december': '12',
};

/**
 * Extract date from filename using common bank naming patterns
 */
function extractDateFromFilename(filename: string): ExtractedDate | null {
  // Try various patterns
  const patterns = [
    // YYYY-MM format
    /(\d{4})-(\d{2})/,
    // YYYY_MM format
    /(\d{4})_(\d{2})/,
    // Month Year (e.g., "January 2024", "Jan2024", "Jan_2024")
    /(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)[_\s-]?(\d{4})/i,
    // Year Month (e.g., "2024 January", "2024_Jan")
    /(\d{4})[_\s-]?(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)/i,
    // DD-MM-YYYY or DD/MM/YYYY
    /(\d{2})[-\/](\d{2})[-\/](\d{4})/,
  ];

  // Pattern 1 & 2: YYYY-MM or YYYY_MM
  let match = filename.match(patterns[0]) || filename.match(patterns[1]);
  if (match) {
    return { year: match[1], month: match[2] };
  }

  // Pattern 3: Month Year
  match = filename.match(patterns[2]);
  if (match) {
    const monthStr = match[1].toLowerCase().substring(0, 3);
    const monthNum = MONTH_MAP[monthStr];
    if (monthNum) {
      return { year: match[2], month: monthNum };
    }
  }

  // Pattern 4: Year Month
  match = filename.match(patterns[3]);
  if (match) {
    const monthStr = match[2].toLowerCase().substring(0, 3);
    const monthNum = MONTH_MAP[monthStr];
    if (monthNum) {
      return { year: match[1], month: monthNum };
    }
  }

  // Pattern 5: DD-MM-YYYY
  match = filename.match(patterns[4]);
  if (match) {
    return { year: match[3], month: match[2] };
  }

  return null;
}

/**
 * Get file info with extracted date
 */
function getFileInfo(filePath: string, filename: string): FileInfo {
  const stats = fs.statSync(filePath);
  const dateInfo = extractDateFromFilename(filename);
  
  return {
    filename,
    size: stats.size,
    modified: stats.mtime.toISOString(),
    extractedDate: dateInfo,
    displayDate: dateInfo
      ? `${dateInfo.year}-${dateInfo.month}`
      : stats.mtime.toISOString().substring(0, 7)
  };
}

/**
 * List files in a directory, excluding hidden files, directories, and underscore-prefixed items
 */
function listFiles(dirPath: string): FileInfo[] {
  if (!fs.existsSync(dirPath)) return [];
  
  return fs.readdirSync(dirPath)
    .filter(f => {
      // Exclude hidden files and underscore-prefixed items (like _originals)
      if (f.startsWith('.') || f.startsWith('_')) return false;
      // Exclude directories
      const fullPath = path.join(dirPath, f);
      return fs.statSync(fullPath).isFile();
    })
    .map(filename => getFileInfo(path.join(dirPath, filename), filename))
    .sort((a, b) => b.displayDate.localeCompare(a.displayDate));
}

interface StatementsQuery {
  search?: string;
  year?: string;
  month?: string;
  quarter?: string;
}

// VAT Quarter definitions (Stagger 2)
// Q1: Nov-Jan (Nov-Dec of prev year + Jan of current year)
// Q2: Feb-Apr
// Q3: May-Jul
// Q4: Aug-Oct
const VAT_QUARTERS: Record<string, { months: number[], crossYear: boolean }> = {
  Q1: { months: [11, 12, 1], crossYear: true },
  Q2: { months: [2, 3, 4], crossYear: false },
  Q3: { months: [5, 6, 7], crossYear: false },
  Q4: { months: [8, 9, 10], crossYear: false }
};

/**
 * Check if a file matches a VAT quarter filter.
 * overlapMonths extends the range backwards for accounts with mid-month billing cycles.
 */
export function matchesQuarter(displayDate: string, quarterParam: string, overlapMonths: number = 0): boolean {
  const match = quarterParam.match(/^(Q[1-4])-(\d{4})$/);
  if (!match) return false;
  
  const quarterKey = match[1];
  const year = parseInt(match[2]);
  const quarter = VAT_QUARTERS[quarterKey];
  if (!quarter) return false;
  
  const dateMatch = displayDate.match(/^(\d{4})-(\d{2})/);
  if (!dateMatch) return false;
  
  const fileYear = parseInt(dateMatch[1]);
  const fileMonth = parseInt(dateMatch[2]);
  
  // Build (year, month) pairs for the standard quarter range
  const validPairs: Array<{ year: number; month: number }> = [];
  for (const m of quarter.months) {
    if (quarter.crossYear && (m === 11 || m === 12)) {
      validPairs.push({ year: year - 1, month: m });
    } else {
      validPairs.push({ year, month: m });
    }
  }
  
  // Extend backwards from the earliest month by overlapMonths
  if (overlapMonths > 0) {
    const earliest = validPairs.reduce((min, p) =>
      (p.year < min.year || (p.year === min.year && p.month < min.month)) ? p : min
    );
    let overlapYear = earliest.year;
    let overlapMonth = earliest.month;
    for (let i = 0; i < overlapMonths; i++) {
      overlapMonth--;
      if (overlapMonth === 0) {
        overlapMonth = 12;
        overlapYear--;
      }
      validPairs.push({ year: overlapYear, month: overlapMonth });
    }
  }
  
  return validPairs.some(p => p.year === fileYear && p.month === fileMonth);
}

// GET /api/statements/years - Get list of available years (lightweight)
router.get('/years', (_req: Request, res: Response<StatementYearsResponse>) => {
  const years = new Set<string>();
  
  for (const account of ACCOUNTS) {
    const accountDir = path.join(STATEMENTS_DIR, account);
    const pdfDir = path.join(accountDir, 'pdf');
    const csvDir = path.join(accountDir, 'csv');
    
    const allFiles = [...listFiles(pdfDir), ...listFiles(csvDir)];
    
    allFiles.forEach(f => {
      const year = f.displayDate.substring(0, 4);
      if (year && year.match(/^\d{4}$/)) {
        years.add(year);
      }
    });
  }
  
  const sortedYears = Array.from(years).sort().reverse();
  res.json(sortedYears);
});

// GET /api/statements - List all statements grouped by account
router.get('/', (req: Request<object, StatementsResponse, object, StatementsQuery>, res: Response<StatementsResponse>) => {
  const { search, year, month, quarter } = req.query;
  
  const result: AllStatements = {};
  
  for (const account of ACCOUNTS) {
    const accountDir = path.join(STATEMENTS_DIR, account);
    const pdfDir = path.join(accountDir, 'pdf');
    const csvDir = path.join(accountDir, 'csv');
    
    let pdfs = listFiles(pdfDir);
    let csvs = listFiles(csvDir);
    
    // Apply filters
    if (search) {
      const searchLower = search.toLowerCase();
      pdfs = pdfs.filter(f => f.filename.toLowerCase().includes(searchLower));
      csvs = csvs.filter(f => f.filename.toLowerCase().includes(searchLower));
    }
    
    // Quarter filter takes precedence over year/month
    if (quarter) {
      const overlap = ACCOUNT_CONFIG[account].quarterOverlapMonths ?? 0;
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
    
    result[account] = {
      pdf: pdfs,
      csv: csvs
    };
  }
  
  res.json(result as StatementsResponse);
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
    
    let pdfs = listFiles(pdfDir);
    let csvs = listFiles(csvDir);
    
    // Apply same filters as the list endpoint
    if (search) {
      const searchLower = search.toLowerCase();
      pdfs = pdfs.filter(f => f.filename.toLowerCase().includes(searchLower));
      csvs = csvs.filter(f => f.filename.toLowerCase().includes(searchLower));
    }
    
    if (quarter) {
      const overlap = ACCOUNT_CONFIG[account as AccountName]?.quarterOverlapMonths ?? 0;
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
function getBusinessAccounts(): AccountName[] {
  return ACCOUNTS.filter(account => ACCOUNT_CONFIG[account].ownership === 'business');
}

// Helper to get expected months for a quarter
function getQuarterMonths(quarter: string): { year: number; month: number }[] {
  const match = quarter.match(/^(Q[1-4])-(\d{4})$/);
  if (!match) return [];
  
  const qNum = match[1];
  const year = parseInt(match[2]);
  
  // VAT Stagger 2 quarters
  switch (qNum) {
    case 'Q1': // Nov-Jan (crosses year boundary)
      return [
        { year: year - 1, month: 11 },
        { year: year - 1, month: 12 },
        { year: year, month: 1 }
      ];
    case 'Q2': // Feb-Apr
      return [
        { year, month: 2 },
        { year, month: 3 },
        { year, month: 4 }
      ];
    case 'Q3': // May-Jul
      return [
        { year, month: 5 },
        { year, month: 6 },
        { year, month: 7 }
      ];
    case 'Q4': // Aug-Oct
      return [
        { year, month: 8 },
        { year, month: 9 },
        { year, month: 10 }
      ];
    default:
      return [];
  }
}

// Helper to format quarter name for ZIP filename
function formatQuarterName(quarter: string): string {
  const match = quarter.match(/^(Q[1-4])-(\d{4})$/);
  if (!match) return quarter;
  
  const qNum = match[1];
  const year = parseInt(match[2]);
  const prevYear = year - 1;
  
  const quarterNames: Record<string, string> = {
    Q1: `Nov-Jan-${prevYear}-${year.toString().slice(-2)}`,
    Q2: `Feb-Apr-${year}`,
    Q3: `May-Jul-${year}`,
    Q4: `Aug-Oct-${year}`
  };
  
  return `VAT-${qNum}-${quarterNames[qNum] || year}`;
}

interface QuarterQuery {
  quarter: string;
}

// GET /api/statements/check-quarter - Check for missing files in a quarter
router.get('/check-quarter', (req: Request<object, CheckQuarterResponse, object, QuarterQuery>, res: Response<CheckQuarterResponse | { error: string }>) => {
  const { quarter } = req.query;
  
  if (!quarter) {
    res.status(400).json({ error: 'Quarter parameter required' });
    return;
  }
  
  const businessAccounts = getBusinessAccounts();
  const expectedMonths = getQuarterMonths(quarter);
  const missingFiles: string[] = [];
  
  for (const account of businessAccounts) {
    const accountConfig = ACCOUNT_CONFIG[account];
    const accountDir = path.join(STATEMENTS_DIR, account);
    const pdfDir = path.join(accountDir, 'pdf');
    const csvDir = path.join(accountDir, 'csv');
    
    const pdfs = listFiles(pdfDir);
    const csvs = listFiles(csvDir);
    
    // Check each expected month
    for (const { year, month } of expectedMonths) {
      const monthStr = month.toString().padStart(2, '0');
      const expectedDate = `${year}-${monthStr}`;
      
      // Check for PDF
      const hasPdf = pdfs.some(f => f.displayDate === expectedDate);
      if (!hasPdf) {
        const monthName = new Date(year, month - 1).toLocaleString('en-GB', { month: 'long' });
        missingFiles.push(`${accountConfig.label}: No PDF for ${monthName} ${year}`);
      }
      
      // Check for CSV
      const hasCsv = csvs.some(f => f.displayDate === expectedDate);
      if (!hasCsv) {
        const monthName = new Date(year, month - 1).toLocaleString('en-GB', { month: 'long' });
        missingFiles.push(`${accountConfig.label}: No CSV for ${monthName} ${year}`);
      }
    }
  }
  
  res.json({ missingFiles });
});

// GET /api/statements/download-for-accountant - Download all business account files for a quarter
router.get('/download-for-accountant', (req: Request<object, unknown, object, QuarterQuery>, res: Response) => {
  const { quarter } = req.query;
  
  if (!quarter) {
    res.status(400).json({ error: 'Quarter parameter required' });
    return;
  }
  
  const businessAccounts = getBusinessAccounts();
  
  interface FileToZip {
    path: string;
    name: string;
  }
  const filesToZip: FileToZip[] = [];
  
  for (const account of businessAccounts) {
    const accountConfig = ACCOUNT_CONFIG[account];
    const accountDir = path.join(STATEMENTS_DIR, account);
    const pdfDir = path.join(accountDir, 'pdf');
    const csvDir = path.join(accountDir, 'csv');
    
    let pdfs = listFiles(pdfDir);
    let csvs = listFiles(csvDir);
    
    // Filter to quarter (with overlap for mid-month billing accounts)
    const overlap = accountConfig.quarterOverlapMonths ?? 0;
    pdfs = pdfs.filter(f => matchesQuarter(f.displayDate, quarter, overlap));
    csvs = csvs.filter(f => matchesQuarter(f.displayDate, quarter, overlap));
    
    // Use the friendly label for folder names in the ZIP
    const folderName = accountConfig.label.toLowerCase().replace(/\s+/g, '-');
    
    pdfs.forEach(f => {
      filesToZip.push({
        path: path.join(pdfDir, f.filename),
        name: `${folderName}/pdf/${f.filename}`
      });
    });
    
    csvs.forEach(f => {
      filesToZip.push({
        path: path.join(csvDir, f.filename),
        name: `${folderName}/csv/${f.filename}`
      });
    });
  }
  
  if (filesToZip.length === 0) {
    res.status(404).json({ error: 'No files found for the selected quarter' });
    return;
  }
  
  // Generate accountant-friendly ZIP filename
  const zipName = `${formatQuarterName(quarter)}.zip`;
  
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
    
    const accountConfig = ACCOUNT_CONFIG[file.account as AccountName];
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
  res.json(ACCOUNTS);
});

interface AccountParams {
  account: string;
}

// GET /api/statements/:account - List statements for specific account
router.get('/:account', (req: Request<AccountParams>, res: Response) => {
  const { account } = req.params;
  
  if (!ACCOUNTS.includes(account as typeof ACCOUNTS[number])) {
    res.status(404).json({ error: 'Account not found' });
    return;
  }
  
  const accountDir = path.join(STATEMENTS_DIR, account);
  const pdfDir = path.join(accountDir, 'pdf');
  const csvDir = path.join(accountDir, 'csv');
  
  const result: AccountStatements = {
    pdf: listFiles(pdfDir),
    csv: listFiles(csvDir)
  };
  
  res.json(result as AccountStatementResponse);
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
router.get('/invoices/list', (_req: Request, res: Response<InvoicesListResponse>) => {
  const files = listFiles(INVOICES_DIR);
  res.json(files as InvoicesListResponse);
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
