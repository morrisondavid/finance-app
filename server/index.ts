import express, { Request, Response } from 'express';
import type { Server as HttpServer } from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import statementsRouter from './routes/statements.js';
import dashboardRouter from './routes/dashboard.js';
import uploadRouter from './routes/upload.js';
import taxRouter from './routes/tax.js';
import budgetRouter from './routes/budget.js';
import { normalizeAllFiles } from './utils/filename-normalizer.js';
import { initDatabase, closeDatabase } from './db/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());

// Serve static files from public directory
app.use(express.static(path.join(__dirname, '../public')));

// API routes
app.use('/api/statements', statementsRouter);
app.use('/api/dashboard', dashboardRouter);
app.use('/api/upload', uploadRouter);
app.use('/api/tax', taxRouter);
app.use('/api/budget', budgetRouter);

// Serve index.html for all other routes (SPA support)
app.get('*', (_req: Request, res: Response) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

let httpServer: HttpServer | undefined;
let shutdownStarted = false;

function gracefulShutdown(signal: string): void {
  if (shutdownStarted) {
    closeDatabase();
    process.exit(1);
    return;
  }
  shutdownStarted = true;
  console.log(`\n${signal} received — closing HTTP server and database...`);

  const forceExit = setTimeout(() => {
    closeDatabase();
    process.exit(0);
  }, 2000);

  if (!httpServer) {
    clearTimeout(forceExit);
    closeDatabase();
    process.exit(0);
    return;
  }

  // Drop idle keep-alive sockets so server.close() can finish (Node 18.2+)
  const srv = httpServer as HttpServer & { closeIdleConnections?: () => void };
  if (typeof srv.closeIdleConnections === 'function') {
    srv.closeIdleConnections();
  }

  httpServer.close(() => {
    clearTimeout(forceExit);
    closeDatabase();
    process.exit(0);
  });
}

// Initialize and start server
async function start(): Promise<void> {
  // Normalize any existing files on startup
  normalizeAllFiles();
  
  // Initialize database and populate from CSV files
  await initDatabase();
  
  httpServer = app.listen(PORT, () => {
    console.log(`Bank Statements Dashboard running at http://localhost:${PORT}`);
  });

  process.once('SIGINT', () => gracefulShutdown('SIGINT'));
  process.once('SIGTERM', () => gracefulShutdown('SIGTERM'));
}

start().catch(err => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
