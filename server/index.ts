import express, { Request, Response } from 'express';
import type { Server as HttpServer } from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import statementsRouter from './routes/statements.js';
import dashboardRouter from './routes/dashboard.js';
import uploadRouter from './routes/upload.js';
import taxRouter from './routes/tax.js';
import expensesRouter from './routes/expenses.js';
import budgetsRouter from './routes/budgets.js';
import debtsRouter from './routes/debts.js';
import obligationsRouter from './routes/obligations.js';
import { normalizeAllFiles } from './utils/filename-normalizer.js';
import { initDatabase, closeDatabase } from './db/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;
const isProduction = process.env.NODE_ENV === 'production';

// Middleware
app.use(express.json());

// In production, Express serves the built frontend from dist/.
// In dev, Vite serves the frontend on :5173 and proxies /api to this server,
// so we skip the static/SPA handlers to avoid serving a broken page at :3000.
if (isProduction) {
  app.use(express.static(path.join(__dirname, '../dist')));
}

// API routes
app.use('/api/statements', statementsRouter);
app.use('/api/dashboard', dashboardRouter);
app.use('/api/upload', uploadRouter);
app.use('/api/tax', taxRouter);
app.use('/api/expenses', expensesRouter);
app.use('/api/budgets', budgetsRouter);
app.use('/api/debts', debtsRouter);
app.use('/api/obligations', obligationsRouter);

if (isProduction) {
  // SPA fallback — serve index.html for non-API routes
  app.get('*', (_req: Request, res: Response) => {
    res.sendFile(path.join(__dirname, '../dist/index.html'));
  });
} else {
  // Dev: make it obvious this server is API-only and point at Vite
  app.get('/', (_req: Request, res: Response) => {
    res
      .status(404)
      .type('text/plain')
      .send(
        'This is the API server (dev mode). Open the frontend at http://localhost:5173'
      );
  });
}

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
    if (isProduction) {
      console.log(`Bank Statements Dashboard running at http://localhost:${PORT}`);
    } else {
      console.log(
        `Bank Statements API running at http://localhost:${PORT} — open the app at http://localhost:5173`
      );
    }
  });

  process.once('SIGINT', () => gracefulShutdown('SIGINT'));
  process.once('SIGTERM', () => gracefulShutdown('SIGTERM'));
}

start().catch(err => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
