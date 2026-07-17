# Hostinger deployment (operator runbook)

**Cursor agent stays local** — it only edits this repo. **You** SSH, copy files, run AWS/DNS, and deploy on the VPS.

Finance app: Docker + Caddy + S3 durable sync (same bucket as former EC2). Hermes runs in a **separate** container with **no** shared volumes with `bank`.

## Quick start

| Step | Where | Command |
|------|-------|---------|
| 1 | VPS once | `./01-host-install-docker.sh` → `./02-host-create-dirs.sh` → `./03-install-caddy.sh` |
| 2 | VPS | `cp config.example.sh config.sh`; `cp production-env.local.example.sh production-env.local.sh` (chmod 600); add secrets + [IAM keys](IAM-S3-POLICY.example.json) |
| 3 | Laptop | `docker build` → [OPERATOR-image-transfer.md](OPERATOR-image-transfer.md) |
| 4 | VPS | `./04-docker-run-production.sh` |
| 5 | VPS | Start Caddy with `/etc/caddy/Caddyfile` |
| 6 | You | [Route53 cutover](#route53-cutover) |
| 7 | You | [Terminate EC2](#decommission-ec2) after stable |

## Bootstrap checklist

1. Copy `deploy/hostinger/` to the VPS (`scp -r`).
2. Place Enable PEM at `/opt/bank-app/secrets/enable-banking-private.pem`.
3. Run `04` — pulls S3 durable tree (including `data/truelayer-feed-cache/`).
4. Verify:
   - `curl -s https://finances.traxiproducts.com/api/version` → JSON with `sourceSha256`
   - `docker logs bank` → `[Database] Ready`
   - MCP: `Authorization: Bearer $MCP_BEARER_TOKEN` on `/mcp`
5. TrueLayer: OAuth on this host or restore tokens from S3; check Logs / `data/feed-sync-scheduled-status.json`.

## TrueLayer feed cache (local ↔ prod)

Feed sync **always** tries the cache first: local disk, then S3 GetObject when `BANK_S3_DURABLE_BUCKET` is set. On miss it calls TrueLayer (if OAuth tokens exist) and writes the response back to disk + S3.

**On your laptop** — set `BANK_S3_DURABLE_BUCKET` / credentials in `.env.local`, then run feed sync normally. No mode flags required. Optional bulk prefetch:

```bash
./scripts/pull-truelayer-feed-cache-from-s3.sh   # warm local disk before sync
npx tsx scripts/feed-sync-all.ts
```

## Route53 cutover

1. Route53 hosted zone `traxiproducts.com` → **A** record `finances` → Hostinger public IP (TTL 300 during cutover).
2. Caddy serves `finances.traxiproducts.com` (see `../aws/caddy/Caddyfile.example`).
3. TrueLayer / Enable redirect URLs unchanged if hostname unchanged.
4. Hermes MCP URL stays `https://finances.traxiproducts.com/mcp` (now same region as Hostinger).

## Decommission EC2

After **48h** stable on Hostinger:

1. On old EC2: confirm `[S3Sync] Upload` in logs for any recent edits.
2. Optional EBS snapshot.
3. **Terminate** instance; release Elastic IP if unused.
4. Keep S3 bucket + Route53 + Hostinger IAM user.

## Hermes (separate container)

See [docker-compose.hermes.example.yml](docker-compose.hermes.example.yml) and [HERMES.md](HERMES.md).

- State: `/opt/hermes-data` → container `/opt/data` only.
- **Do not** mount `/opt/bank-app` or `docker.sock`.
- MCP: remote HTTPS to finance app; use [MCP allowlist](HERMES.md#mcp-allowlist-budgeting).
- Ollama on host: `http://host.docker.internal:11434` for local LLM.

### Hermes off-box backup (you)

Hermes ships `hermes backup` (v0.12+) → zip under `/opt/hermes-data/backups/`.

1. `docker exec hermes hermes backup` (smoke test).
2. Install `rclone`; configure S3 remote (same IAM or scoped key).
3. Nightly: `hermes cron` or host cron:

```bash
rclone copy /opt/hermes-data/backups/ s3:traxiproducts-finances-bank-app-data-eu-west-2/hermes-backup/
```

Restore: `rclone copy` down → `hermes import <archive>`.

**GitHub:** optional private repo for hand-authored `skills/*.md` only — never `.env` or `state.db`.

## Env reference

| Variable | Production typical |
|----------|-------------------|
| `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` | IAM user (required on Hostinger) |
| `BANK_READ_CACHE_TTL_SECONDS` | `60` |
| `MCP_BEARER_TOKEN` | Hermes / HTTP MCP |

See [production-env.local.example.sh](production-env.local.example.sh) and repo `.env.example`.

## Rolling deploy

1. Laptop: `docker build` + image transfer.
2. VPS: `./04-docker-run-production.sh` (S3 pull + restart `bank`).
