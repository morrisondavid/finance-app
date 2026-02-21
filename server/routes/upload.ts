import express, { Request, Response, NextFunction } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { normalizeFileOnDisk } from '../utils/filename-normalizer.js';
import { partitionByMonth } from '../utils/csv-partitioner.js';
import { validateAndCleanup } from '../utils/csv-validator.js';
import { initDatabase } from '../db/index.js';
import type { UploadedFile, UploadResponse } from '../types.js';
import { ACCOUNTS, AccountName } from '../types.js';
import type { UploadResponse as UploadResponseContract } from '../../shared/api-contracts.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();

const STATEMENTS_DIR = path.join(__dirname, '../../statements');
const INVOICES_DIR = path.join(__dirname, '../../invoices');

/**
 * Safely get a param value as string
 */
function getParam(params: Record<string, string | string[] | undefined>, key: string): string {
  const value = params[key];
  if (Array.isArray(value)) {
    return value[0] || '';
  }
  return value || '';
}

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, _file, cb) => {
    const account = getParam(req.params, 'account');
    const type = getParam(req.params, 'type');
    
    let destDir: string;
    
    if (account === 'invoices') {
      destDir = INVOICES_DIR;
    } else if (ACCOUNTS.includes(account as AccountName) && ['pdf', 'csv'].includes(type)) {
      destDir = path.join(STATEMENTS_DIR, account, type);
    } else {
      return cb(new Error('Invalid account or file type'), '');
    }
    
    // Ensure directory exists
    if (!fs.existsSync(destDir)) {
      fs.mkdirSync(destDir, { recursive: true });
    }
    
    cb(null, destDir);
  },
  filename: (_req, file, cb) => {
    // Keep original filename
    cb(null, file.originalname);
  }
});

const upload = multer({ 
  storage,
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const account = getParam(req.params, 'account');
    const type = getParam(req.params, 'type');
    
    // For invoices, accept PDF
    if (account === 'invoices') {
      if (ext === '.pdf') {
        return cb(null, true);
      }
      return cb(new Error('Invoices must be PDF files'));
    }
    
    // For statements, match the type
    if (type === 'pdf' && ext === '.pdf') {
      return cb(null, true);
    }
    if (type === 'csv' && ext === '.csv') {
      return cb(null, true);
    }
    
    cb(new Error(`Invalid file type. Expected ${type.toUpperCase()} file.`));
  }
});

interface UploadedFileWithStats extends UploadedFile {
  transactionsAdded?: number;
  duplicatesSkipped?: number;
}

interface UploadResponseWithStats extends UploadResponse {
  totalTransactionsAdded?: number;
  totalDuplicatesSkipped?: number;
}

// POST /api/upload/:account/:type - Upload a statement file
// Increased limit to 50 files at once
router.post('/:account/:type', upload.array('files', 50), async (req: Request, res: Response<UploadResponseContract | { error: string }>) => {
  const account = getParam(req.params, 'account');
  const type = getParam(req.params, 'type');
  const files = req.files as Express.Multer.File[] | undefined;
  
  if (!files || files.length === 0) {
    res.status(400).json({ error: 'No files uploaded' });
    return;
  }
  
  // For CSV files, validate format BEFORE processing
  if (type === 'csv') {
    const validationErrors: { filename: string; errors: string[] }[] = [];
    const validFiles: Express.Multer.File[] = [];
    
    for (const f of files) {
      const validation = validateAndCleanup(f.path, account, true);
      if (!validation.valid) {
        validationErrors.push({
          filename: f.originalname,
          errors: validation.errors || ['Unknown validation error']
        });
      } else {
        validFiles.push(f);
      }
    }
    
    // If any files failed validation, return error
    if (validationErrors.length > 0) {
      const errorMessage = validationErrors.length === files.length
        ? 'All uploaded CSV files failed validation'
        : `${validationErrors.length} of ${files.length} files failed validation`;
      
      res.status(400).json({
        error: 'Invalid CSV format',
        message: errorMessage,
        details: validationErrors,
        validFilesProcessed: validFiles.length
      });
      
      // If some files are valid, continue processing them below
      if (validFiles.length === 0) {
        return;
      }
      
      // Replace files array with only valid files for processing
      (req as { files?: Express.Multer.File[] }).files = validFiles;
    }
  }
  
  // Re-get files array (may have been filtered)
  const processFiles = req.files as Express.Multer.File[] | undefined;
  if (!processFiles || processFiles.length === 0) {
    return; // All files were invalid and response already sent
  }
  
  const overwrite = req.query.overwrite === 'true';
  
  // Check for duplicate originals BEFORE processing
  if (account !== 'invoices') {
    const originalsDir = path.join(STATEMENTS_DIR, account, type, '_originals');
    if (!fs.existsSync(originalsDir)) {
      fs.mkdirSync(originalsDir, { recursive: true });
    }
    
    const duplicates = processFiles
      .filter(f => fs.existsSync(path.join(originalsDir, f.originalname)))
      .map(f => f.originalname);
    
    if (duplicates.length > 0 && !overwrite) {
      // Clean up uploaded files since we're not processing them
      for (const f of processFiles) {
        try { fs.unlinkSync(f.path); } catch { /* ignore */ }
      }
      res.status(409).json({
        message: `${duplicates.length} file(s) already exist in originals`,
        duplicates
      });
      return;
    }
    
    // Save originals with their original bank-provided filenames
    for (const f of processFiles) {
      const originalDest = path.join(originalsDir, f.originalname);
      fs.copyFileSync(f.path, originalDest);
    }
  }
  
  // Process each file
  const uploadedFiles: UploadedFileWithStats[] = [];
  let partitionedFiles: string[] = [];
  
  for (const f of processFiles) {
    let fileInfo: UploadedFileWithStats;
    
    if (account !== 'invoices') {
      // Normalize filename
      const result = normalizeFileOnDisk(f.path, account);
      const finalPath = result.newPath || f.path;
      
      fileInfo = {
        originalFilename: f.originalname,
        filename: result.normalized,
        size: f.size,
        path: finalPath,
        renamed: result.renamed
      };
      
      // If it's a CSV file, check if it needs partitioning
      if (type === 'csv') {
        try {
          const partitionResult = partitionByMonth(finalPath, account);
          if (partitionResult.deleted) {
            partitionedFiles = partitionedFiles.concat(partitionResult.filesCreated);
            fileInfo.filename = `Partitioned into ${partitionResult.filesCreated.length} monthly files`;
          }
        } catch (err) {
          console.error(`Error partitioning ${f.originalname}:`, err);
        }
      }
    } else {
      fileInfo = {
        filename: f.filename,
        size: f.size,
        path: f.path
      };
    }
    
    uploadedFiles.push(fileInfo);
  }
  
  // For CSV uploads, reinitialize the database to pick up all changes
  if (type === 'csv') {
    try {
      console.log('[Upload] Reinitializing database after CSV upload...');
      await initDatabase();
      console.log('[Upload] Database reinitialized successfully');
    } catch (err) {
      console.error('[Upload] Error reinitializing database:', err);
    }
  }
  
  const response: UploadResponseWithStats = {
    message: `Successfully uploaded ${files.length} file(s)`,
    files: uploadedFiles,
    account,
    type
  };
  
  // Add info about partitioned files
  if (partitionedFiles.length > 0) {
    response.message = `Successfully uploaded and partitioned into ${partitionedFiles.length} monthly files. Database reinitialized.`;
  } else if (type === 'csv') {
    response.message = `Successfully uploaded ${files.length} file(s). Database reinitialized.`;
  }
  
  res.json(response);
});

// POST /api/upload/invoices - Upload invoice files
router.post('/invoices', upload.array('files', 50), (req: Request, res: Response<UploadResponseContract | { error: string }>) => {
  // Override params for invoice uploads
  req.params.account = 'invoices';
  req.params.type = 'pdf';
  
  const files = req.files as Express.Multer.File[] | undefined;
  
  if (!files || files.length === 0) {
    res.status(400).json({ error: 'No files uploaded' });
    return;
  }
  
  const uploadedFiles: UploadedFile[] = files.map(f => ({
    filename: f.filename,
    size: f.size,
    path: f.path
  }));
  
  const response: UploadResponse = {
    message: `Successfully uploaded ${files.length} invoice(s)`,
    files: uploadedFiles
  };
  
  res.json(response);
});

// Error handling middleware for multer
router.use((err: Error, _req: Request, res: Response, next: NextFunction) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_UNEXPECTED_FILE') {
      res.status(400).json({ error: 'Too many files. Maximum 50 files per upload.' });
      return;
    }
    res.status(400).json({ error: err.message });
    return;
  }
  if (err) {
    res.status(400).json({ error: err.message });
    return;
  }
  next();
});

export default router;
