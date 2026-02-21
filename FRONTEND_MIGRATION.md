# Frontend Modularization with TypeScript + Vite

## Overview

The frontend has been successfully migrated from vanilla JavaScript to a modular TypeScript architecture using Vite as the build tool. This provides better code organization, type safety, and improved developer experience with hot module replacement (HMR).

## Architecture

### Directory Structure

```
public/
├── src/
│   ├── main.ts              # Application entry point
│   ├── types.ts             # Type definitions (re-exports server types)
│   ├── modules/
│   │   ├── dashboard.ts     # Dashboard logic, charts, tax calculations
│   │   ├── statements.ts    # Statements filtering, downloads, checkboxes
│   │   ├── upload.ts        # File upload with drag-and-drop
│   │   ├── tabs.ts          # Tab navigation
│   │   └── state.ts         # Centralized application state
│   └── utils/
│       ├── api.ts           # Typed API wrappers
│       └── formatting.ts    # Formatting utilities
├── index.html               # HTML entry point (loads main.ts)
├── styles.css               # Global styles
└── app.js                   # ⚠️ DEPRECATED - old monolithic file

server/
├── types.ts                 # Shared types between frontend and backend
└── ...
```

### Key Improvements

1. **Type Safety**: Full TypeScript with strict mode
2. **Modular Design**: Code split into focused modules
3. **Type Sharing**: Frontend imports types directly from `server/types.ts`
4. **Hot Module Replacement**: Changes reflect instantly during development
5. **Better IDE Support**: IntelliSense, auto-completion, refactoring tools
6. **Maintainability**: Each module has a single responsibility

## Development

### Start Development Servers

```bash
npm run dev
```

This starts both:
- Backend (Express): `http://localhost:3000`
- Frontend (Vite): `http://localhost:5174` (or 5173 if available)

Vite proxies `/api/*` requests to the backend automatically.

### Build for Production

```bash
npm run build
```

This:
1. Runs TypeScript compiler (`tsc`)
2. Builds optimized frontend bundle with Vite
3. Output goes to `dist/` directory

### Preview Production Build

```bash
npm run preview
```

## Module Breakdown

### `main.ts` - Entry Point
- Initializes all modules
- Loads account configuration
- Sets up tab navigation with data loading callbacks

### `modules/state.ts` - Application State
- Centralized state management
- Type-safe getters and setters
- Stores: dashboard data, statements, chart instances, selected account, etc.

### `modules/dashboard.ts` - Dashboard
- Financial summary cards (income, expenses, net position)
- Monthly chart (Chart.js with click handlers)
- Tax liabilities panel (VAT, Corporation Tax, Personal Tax)
- Account balance tracking
- Modals for transactions, VAT payments, VAT liability breakdown

### `modules/statements.ts` - Statements
- File listing with filters (year, month, VAT quarter)
- Checkboxes for file selection
- Download buttons:
  - Individual file downloads
  - "Download All" for filtered results
  - "Download for Accountant" (business accounts only)
  - "Download Selected" for checked files
- Missing file indicators (when viewing VAT quarters)

### `modules/upload.ts` - Upload
- Drag-and-drop file upload
- Progress tracking
- Supports both statement and invoice uploads
- Refreshes data after successful upload

### `modules/tabs.ts` - Navigation
- Simple tab switching
- No data loading logic (handled by main.ts)

### `utils/api.ts` - API Layer
- Typed fetch wrappers for all backend endpoints
- Consistent error handling
- Type-safe request/response

### `utils/formatting.ts` - Formatting
- `formatCurrency()`: GBP formatting
- `formatAccountName()`: kebab-case to Title Case
- `formatMonthYear()`: YYYY-MM to "Mon YYYY"
- `formatQuarterName()`: For ZIP filenames

### `types.ts` - Type Definitions
- Re-exports all types from `server/types.ts`
- Frontend-specific types (AppState, filters, etc.)
- Maintains single source of truth for shared types

## Type Safety

### Shared Types
The frontend imports types directly from the backend:

```typescript
import type {
  DashboardSummary,
  Transaction,
  AccountConfig,
  // ...
} from '@server/types';
```

This ensures:
- Backend API changes automatically reflect in frontend types
- No type drift between frontend and backend
- Compile-time errors if API contracts change

### Path Aliases
Configured in `tsconfig.json` and `vite.config.ts`:
- `@/`: Maps to `./public/src/`
- `@server/`: Maps to `./server/`

### No Type Casting Rule
Following the project rule: **Never cast types, especially not to `any` or `unknown`**

We use type assertions only when necessary and always to specific types:
```typescript
// ✅ Acceptable (specific type)
(element as HTMLButtonElement).disabled = true

// ❌ Never use
const data = response as any
```

## Migration Notes

### What Changed
1. `app.js` → Multiple TypeScript modules
2. Chart.js CDN → npm package (`chart.js`)
3. Inline `<script>` → Vite module system
4. Global functions → Exported functions from modules
5. Loose types → Strict TypeScript

### Backwards Compatibility
The old `app.js` file is still present but no longer loaded. It can be removed after confirming the new implementation works as expected.

### Breaking Changes
None for users - the UI and functionality remain identical. This is purely an internal code refactor.

## Configuration Files

### `vite.config.ts`
- Root directory: `public/`
- Build output: `dist/`
- API proxy to backend on port 3000
- Path aliases for clean imports

### `tsconfig.json`
- Target: ES2020
- Module: ESNext (for Vite)
- Strict mode enabled
- Path aliases matching Vite config

### `package.json` Scripts
- `dev`: Runs backend + Vite concurrently
- `server`: Backend only (tsx watch)
- `vite`: Frontend only
- `build`: TypeScript check + Vite build
- `preview`: Preview production build

## Best Practices

1. **Import from modules**: Never use global variables
2. **Type everything**: Avoid `any`, `unknown`, implicit types
3. **Pure utilities**: Keep formatting functions side-effect free
4. **Centralized state**: Use `state.ts` for shared data
5. **API layer**: Always use `api.ts` wrappers, never raw `fetch()`
6. **Error handling**: Log errors and show user-friendly messages

## Common Tasks

### Adding a New API Endpoint
1. Update `server/types.ts` if needed
2. Add typed wrapper to `utils/api.ts`
3. Use the wrapper in your module

### Adding a New Module
1. Create file in `public/src/modules/`
2. Export initialization function (`initMyModule()`)
3. Call it from `main.ts`

### Adding a New Type
1. If shared with backend: Add to `server/types.ts`
2. If frontend-only: Add to `public/src/types.ts`

### Debugging
- TypeScript errors: `npx tsc --noEmit`
- Linting (if configured): `npm run lint`
- Browser console: Full source maps in development mode

## Performance

### Development
- Vite provides instant HMR (< 100ms for most changes)
- TypeScript checking runs in parallel
- No full page reloads for CSS/JS changes

### Production
- Tree-shaking removes unused code
- Minification and compression
- Code splitting for optimal loading

## Next Steps

Potential future enhancements:
1. Add ESLint for consistent code style
2. Add Prettier for automatic formatting
3. Implement unit tests for utilities and API layer
4. Consider component library (if UI becomes more complex)
5. Add Playwright for E2E testing

## Troubleshooting

### TypeScript Errors
Run `npx tsc --noEmit` to see all errors. Common issues:
- Missing types in `server/types.ts`
- Incorrect path aliases
- Strict null checks (use `?` for optional)

### Vite Not Starting
- Check if port 5173/5174 is available
- Try `rm -rf node_modules/.vite` to clear cache

### Backend API Errors
- Ensure backend is running on port 3000
- Check Vite proxy configuration in `vite.config.ts`

## Summary

The migration to TypeScript + Vite provides:
- ✅ Type safety across the entire stack
- ✅ Better code organization and maintainability
- ✅ Improved developer experience
- ✅ Future-proof architecture
- ✅ No user-facing changes

The codebase is now more maintainable, easier to refactor, and ready for future enhancements.
