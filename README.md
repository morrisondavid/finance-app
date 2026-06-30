# Bank Statements Dashboard

A local web application for managing bank statements and viewing financial summaries. Store your PDF statements and CSV transaction data, then view income/expense breakdowns and VAT liability calculations.

## Features

- **Statement Storage**: Organize PDFs and CSVs from multiple bank accounts
- **Financial Dashboard**: View income, expenses, and net position at a glance
- **VAT Calculation**: Automatic VAT liability estimation (20% UK rate)
- **Monthly Breakdown**: Chart and table showing income/expenses by month
- **Statement Search**: Find statements by account, year, or month
- **One-Click Download**: Quick access to any stored PDF statement
- **Drag & Drop Upload**: Easily add new statements through the browser

## Tech Stack

- **TypeScript** - Type-safe server code
- **Express** - HTTP server
- **tsx** - Direct TypeScript execution (no build step)
- **csv-parse** - CSV parsing
- **Vanilla JS** - Frontend (no framework)

## Supported Banks

- Barclays (Current & Savings accounts)
- NatWest
- Capital on Tap (Credit Card)
- Barclaycard (Credit Card)

## Quick Start

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Start the server:**
   ```bash
   npm start
   ```

3. **Open in browser:**
   ```
   http://localhost:3000
   ```

## Folder Structure

Your statements should be organized in the following structure:

```
statements/
├── barclays-current/
│   ├── pdf/          <- PDF statements
│   └── csv/          <- CSV transaction exports
├── barclays-savings/
│   ├── pdf/
│   └── csv/
├── capital-on-tap/
│   ├── pdf/
│   └── csv/
├── barclaycard/
│   ├── pdf/
│   └── csv/
└── natwest/
    ├── pdf/
    └── csv/

invoices/             <- Invoice PDFs
```

## Adding Statements

### Option 1: Through the Dashboard
1. Go to the **Upload** tab
2. Select the account and file type (PDF or CSV)
3. Drag & drop files or click to browse

### Option 2: Manual File System
Simply copy your files directly into the appropriate folders:
- PDF statements → `statements/{account}/pdf/`
- CSV exports → `statements/{account}/csv/`

## File Naming

The system automatically extracts dates from filenames using common patterns:

- `2024-01-statement.pdf` → January 2024
- `Statement_Jan2024.pdf` → January 2024
- `January 2024.csv` → January 2024

If a date can't be extracted, the file's modification date is used.

**Tip:** For cleaner organization, you can prefix files with `YYYY-MM_`:
- `2024-01_original-filename.pdf`

## CSV Formats

Each bank exports CSVs in different formats. The app handles these automatically:

| Bank | Expected Columns |
|------|-----------------|
| Barclays | Date, Description, Money In, Money Out, Balance |
| NatWest | Date, Description, Paid In, Paid Out, Balance |
| Capital on Tap | Transaction Date, Description, Amount |
| Barclaycard | Transaction Date, Description, Amount |

> **Note:** The parsers are flexible and will attempt to detect column names automatically. If your CSV format differs slightly, it should still work.

## VAT Calculation

VAT liability is estimated assuming:
- All expenses include 20% VAT
- Formula: `expenses × 0.2 ÷ 1.2`

This is a rough estimate for business expenses. Consult your accountant for accurate VAT returns.

## API Endpoints

For programmatic access:

| Endpoint | Description |
|----------|-------------|
| `GET /api/statements` | List all statements |
| `GET /api/statements/:account` | List statements for an account |
| `GET /api/statements/download/:account/:type/:filename` | Download a file |
| `GET /api/dashboard/summary` | Get financial summary |
| `GET /api/dashboard/transactions` | Get all transactions |
| `POST /api/upload/:account/:type` | Upload files |

## Development

Run with auto-reload on changes:
```bash
npm run dev
```

Type-check the codebase:
```bash
npm run typecheck
```

## Troubleshooting

### CSV not parsing correctly
- Check that your CSV has a header row
- Ensure date and amount columns are present
- Check the console for parsing errors

### Files not showing up
- Verify files are in the correct `pdf/` or `csv/` subfolder
- Refresh the page or click "Search" to reload

### Server won't start
- Ensure port 3000 is available
- Check that `npm install` completed successfully

## Security Note

This app runs locally and has no authentication. It's designed for personal use on your own machine. Do not expose it to the public internet.

# Test IntentKeep

Add some changes to see wagwan!!!
