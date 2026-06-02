# Official PDF bank statement automation — findings

## Summary

Neither TrueLayer nor Enable Banking exposes downloadable official PDF statements through the integrations currently wired in this app. Transaction CSVs remain the reliable Open Banking output; PDFs must be uploaded manually or ingested from another channel (e.g. bank email).

## TrueLayer Data API

- Endpoints in use: accounts, balance, transactions, identity.
- Scopes: `info accounts cards balance transactions offline_access` (`server/http/mutation/feed-oauth-start.ts`).
- **No statement-file / document download endpoint** in the Data API surface used here.

## Enable Banking AISP

- Provides accounts, transactions, and balances for connected banks.
- **Statement PDF documents are not surfaced** in the current connector integration; confirm per-bank with Enable support (Barclays UK was the priority bank).

## Open Banking UK (optional ASPSP feature)

- The UK standard defines optional `GET /accounts/{AccountId}/statements/{StatementId}/file` (PDF), gated by `ReadStatementsDetail`.
- Implementation is **ASPSP-optional**; aggregators in this project do not pass it through today.

## Manifest: all business accounts

Readiness requires **both** official PDF statements and transaction CSVs for every account on the entity manifest (`server/domain/reporting/reporting-manifest.ts`), including credit cards (`capital-on-tap`, `barclaycard`). If a provider does not issue monthly PDFs, obtain equivalent official documentation (portal export, emailed statement, etc.) and upload via `statements/<account>/pdf/`.

## Recommended pragmatic automation

1. **Email / IMAP ingestion** — Bank-emailed statement PDFs → `statements/<account>/pdf/`, reusing the existing upload normalizer (`POST /api/upload/:account/pdf`, MCP `statements_upload_base64`).
2. **Keep manual upload** as fallback for gaps.
3. **Revisit aggregator APIs** if TrueLayer or Enable add statement-document endpoints (would need new scopes and connector work).

## Follow-up checklist (out of scope for initial readiness feature)

- [ ] Spike IMAP listener + routing rules per account alias
- [ ] Confirm Enable Banking Barclays connector document support in writing
- [ ] If an API appears: add scope widening + download job + idempotent storage path
