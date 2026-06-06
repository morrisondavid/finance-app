---
name: Upload limits JSON S3
overview: Fix MCP/base64 upload failures caused by Express's default ~100KB JSON limit, align decoded PDF caps with a 32MB MCP body budget, and push invoice upload artifacts to S3 the same way statement PDF/CSV uploads already do.
isProject: true
---

# Upload limits, Express JSON body, and invoice S3 publish

See implementation in `server/ingestion/upload-limits.ts`, `server/http/json-body-middleware.ts`, and `server/ingestion/invoice-upload-durable-publish.ts`.
