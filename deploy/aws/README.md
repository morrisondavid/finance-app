# AWS deployment (Docker + finances.traxiproducts.com)

**Deployment constants:** copy [`config.example.sh`](config.example.sh) to **`config.sh`** in this folder (gitignored) and edit region, S3 names, EC2 key name, ECR repo, Enable URLs, etc. Change **`BANK_APP_KEY_NAME`** to match an EC2 key pair you create in **eu-west-2**, or create a key pair with the exact name in the example.

Prerequisites: [AWS CLI v2](https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html) + credentials/SSO **(on your laptop *and* on EC2)** — **`09-docker-run-production.sh`** uses **`aws s3 sync`** on the instance; Docker on your laptop for **`07`**; EC2 needs a key pair.

## Order to run (from `deploy/aws/`)

```bash
cp config.example.sh config.sh   # first time only
./01-s3-buckets.sh
./02-iam-ec2-profile.sh
./03-ec2-provision.sh        # writes .elastic-ip; create key pair in AWS if this fails
./04-route53-upsert-a.sh     # uses .elastic-ip from step 3
./07-ecr-build-and-push.sh   # from repo: laptop with Docker
```

## S3 durable state (CLI pull in `09`, SDK push on mutation from the app)

**Authoritative data is files on disk** — CSVs under `statements/`, `data/*.csv`, `budgets/`, etc. (same trees as [`server/storage/durable-paths.ts`](../server/storage/durable-paths.ts)) — mirrored under **`s3://${BUCKET_DATA}/${BANK_S3_DURABLE_PREFIX}`** (defaults in your **`config.sh`**).

- **`data/transactions.db`** (and `-wal`/`-shm`) are **not** sources of truth and **must not** be treated as backup objects in S3. The host **`09`** script **`--exclude`s** `transactions.db*` on **`data/`** sync and **`rm -f`s** any local SQLite files under the bind mount before starting Docker so the container always rebuilds the DB from CSVs. **`12-s3-seed-durable-from-local.sh`** also excludes `transactions.db*` from upload.
- **One-time bucket hygiene:** if older syncs left **`…/data/transactions.db*`** in the bucket, remove them so nobody restores SQLite by mistake (ops task; not automated).
- **Pull:** [`09-docker-run-production.sh`](09-docker-run-production.sh) stops the **`bank`** container first (so SQLite releases files on the mounts), runs **`aws s3 sync … --delete`** from S3 **per durable top-level folder** under **`/opt/bank-app`** (same list as **`DURABLE_TOP_LEVEL_DIRS`** in TypeScript plus **`data/`**), then **`docker run`**. The instance **needs [AWS CLI v2](https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html)** on PATH; IAM uses the instance profile. **`--delete`** removes files under those subtrees only if they were removed remotely (nothing under **`/opt/bank-app/secrets/`** — not in sync list — is touched by sync).
- **`data/enable-sessions.json`** is excluded from **`data/`** sync (Enable OAuth blobs stay server-local for a single EC2 writer). **Portable financial CSVs are not portable live OAuth session state:** if you run multiple app instances (Lambda/Fargate, `desiredCount > 1`), you need a **single shared, strongly consistent store** for refresh tokens (S3 conditional writes, DynamoDB, etc.) — see **Multi-instance Enable Banking** below.
- **Push:** when **`BANK_S3_DURABLE_BUCKET`** is set, the Node process **uploads only the repo paths touched** by a mutation (CSV ingest, feed sync, opening-balance updates, warning user-state CSV, etc.), plus **`data/manifest.json`** after a full rebuild, via `@aws-sdk` PutObject. There is **no** periodic or shutdown bulk push. Omit the bucket env on your laptop → no pushes during dev.

**Container init:** **`09`** sets **`BANK_STATEMENTS_SKIP_INIT_WHEN_MANIFEST_UNCHANGED=0`** so production always runs a **full SQLite rebuild** after sync (deterministic from files), regardless of manifest digest shortcuts that are useful on dev machines.

At-rest encryption uses **S3 default encryption** (SSE-S3). Optional **`BANK_S3_DURABLE_SSE_KMS_KEY_ID`** remains supported on PutObject via env.

[`08-host-create-dirs.sh`](08-host-create-dirs.sh) creates **all** bind-mount paths under `/opt/bank-app` (not only `data`/`statements`/`invoices`).

### Portability: new laptop / fresh host

1. **`aws s3 sync`** the durable prefix (or run **`09`** on the host).
2. Copy **`config.sh`**, **`.env`** equivalents, and Enable PEM as you do today.
3. **`npm run build`** / Docker with the same env as production; **`initDatabase`** performs a **full rebuild** from CSVs.

**SQLite-only UX today:** **`warning_snapshots`** (computed warning history) is still **DB-only** — it resets after a full rebuild. **`warning_user_state`** (snooze/ack) is mirrored to **`data/warning-user-state.csv`** and is loaded early in **`initDatabase`** so S3 sync restores operator intent.

### One-time seed from your laptop

Requires buckets from `./01-s3-buckets.sh` and AWS CLI credentials (same profile you use for deploy):

```bash
# From repo root
./deploy/aws/12-s3-seed-durable-from-local.sh
```

### Rolling out after code changes

1. Run **`12-s3-seed-durable-from-local.sh`** if S3 does not yet reflect your authoritative copy (first deploy or drift recovery).
2. On EC2: **`./08-host-create-dirs.sh`** once so new mount roots exist with correct ownership.
3. Laptop: **`./07-ecr-build-and-push.sh`** (image needs `@aws-sdk` for targeted uploads).
4. EC2: ECR **`docker login`**, **`docker pull …:latest`**, **`./09-docker-run-production.sh`** (pull is built into **`09`**; ensure AWS CLI installed on host).
5. Confirm logs show **`[09] Syncing durable dirs`** (host), then **`[Database]`** in **`docker logs bank`**.

Optional legacy cron: **`11-s3-sync-push.sh`** only synced `data/` + `statements/` to legacy bucket layouts; **`09`** + targeted SDK uploads mirror the **full durable tree** under **`BANK_S3_DURABLE_PREFIX`** for new installs.

### Multi-instance Enable Banking (future)

For autoscaled containers or Lambda, **do not** rely on a shared **`enable-sessions.json`** on a network filesystem without compare-and-swap semantics—two writers can clobber refresh tokens. Plan on **`EnableSessionStore`** backed by **one** consistent store (S3 object ETag CAS, DynamoDB conditional update, etc.) keyed by tenant, and keep private keys in Secrets Manager / SSM—not in the durable CSV bucket.

### Local development

Daily **`npm run dev`** does **not** run **`09`**, so **`aws s3 sync` never executes** locally. Omit **`BANK_S3_DURABLE_BUCKET`** in **`.env.local`** so Node does **not** push during dev.

## Copy `deploy/aws` onto the EC2 host

From your **laptop**, at **repo root** (`bank-statements-app/`).

**Avoid `scp -r deploy/aws … ~/bank-deploy-aws`** when **`~/bank-deploy-aws` already exists** — that often creates **`~/bank-deploy-aws/aws/`**.

### Option A — `rsync` (needs `rsync` on the server too)

Remote Amazon Linux often has **no `rsync`** installed. If you see **`rsync: command not found`** over SSH, install it **once** on EC2:

```bash
sudo dnf install -y rsync
```

Then from the laptop (trailing **`./deploy/aws/`** keeps files **flat** under **`~/bank-deploy-aws/`**):

```bash
export EC2_IP="$(tr -d '[:space:]' < deploy/aws/.elastic-ip)"
export SSH_KEY="${HOME}/.ssh/traxiproducts-finances-bank-app-eu-west-2.pem"

rsync -avz \
  -e "ssh -i ${SSH_KEY}" \
  --exclude 'production-env.local.sh' \
  --exclude 'config.sh' \
  ./deploy/aws/ \
  ec2-user@${EC2_IP}:~/bank-deploy-aws/
```

(`EC2_IP` / `SSH_KEY`: adjust host IP or key path if yours differ.)

### Option B — `tar` over SSH (no `rsync` on either side required)

Works when the server only has **`ssh` + `tar`** (default on AL2023):

```bash
export EC2_IP="$(tr -d '[:space:]' < deploy/aws/.elastic-ip)"
export SSH_KEY="${HOME}/.ssh/traxiproducts-finances-bank-app-eu-west-2.pem"

tar -C ./deploy/aws \
  --exclude='production-env.local.sh' \
  --exclude='config.sh' \
  -cf - . | ssh -i "${SSH_KEY}" "ec2-user@${EC2_IP}" 'mkdir -p ~/bank-deploy-aws && tar -C ~/bank-deploy-aws -xf -'
```

### Server secrets (`production-env.local.sh`)

[`09-docker-run-production.sh`](09-docker-run-production.sh) **`source`**s **`./production-env.local.sh`** next to itself on the server when present (same directory as **`config.sh`**). Create once from the shipped template ([`production-env.local.example.sh`](production-env.local.example.sh)); **`chmod 600`**. Put **`export BANK_SITE_ACCESS_SECRET='…'`** there (≥16 UTF‑8 bytes).

**Enable private key** (same **`SSH_KEY`** / **`EC2_IP`** as copy steps above):

```bash
scp -i "$SSH_KEY" secrets/enable-banking-private.pem ec2-user@${EC2_IP}:/tmp/enable-banking-private.pem
```

Then SSH in:

```bash
ssh -i "$SSH_KEY" ec2-user@${EC2_IP}
```

On the **server**:

```bash
chmod +x ~/bank-deploy-aws/*.sh ~/bank-deploy-aws/user-data/*.sh 2>/dev/null || true
sudo mkdir -p /opt/bank-app/secrets
sudo mv /tmp/enable-banking-private.pem /opt/bank-app/secrets/enable-banking-private.pem
sudo chown ec2-user:ec2-user /opt/bank-app/secrets/enable-banking-private.pem
chmod 600 /opt/bank-app/secrets/enable-banking-private.pem
```

Run host scripts from the copied folder (`cd ~/bank-deploy-aws`). **`09-docker-run-production.sh`** needs **ECR pull**: either install AWS CLI on the box and run `aws ecr get-login-password … | docker login …` (with IAM that can read ECR—your instance profile may need **`AmazonEC2ContainerRegistryReadOnly`** in addition to S3), or pull from your laptop after SSH tunneling is awkward—simplest is to **attach ECR read policy** to the **`bank-app-ec2-profile`** role in IAM, then on the server:

```bash
aws ecr get-login-password --region eu-west-2 | docker login --username AWS --password-stdin "$(aws sts get-caller-identity --query Account --output text).dkr.ecr.eu-west-2.amazonaws.com"
```

On the **server** (after `cd ~/bank-deploy-aws`):

```bash
./06-host-install-docker-al2023.sh   # only if Docker missing
./08-host-create-dirs.sh
./09-docker-run-production.sh
./10-install-caddy-al2023.sh         # then start Caddy (see Caddy docs / run as systemd)
```

If **`aws s3 sync`** in **09** reports **`Permission denied`** under **`/opt/bank-app`**, the mounts had **root-owned** files left by Docker while sync runs as **`ec2-user`**. Current **09** runs **`sudo chown -R ec2-user:ec2-user /opt/bank-app`** before sync; on an older copy of the script, fix once with that **`chown`**, then re-run **09**.

Optional backup cron: **`11-s3-sync-push.sh`** (needs instance profile / AWS creds on host).

## HTTPS + Enable

- Caddyfile hostname: **finances.traxiproducts.com** (see [`caddy/Caddyfile.example`](caddy/Caddyfile.example)).
- Whitelist in Enable: **`https://finances.traxiproducts.com/api/feed/enable/callback`** (must match **`config.sh`** `ENABLE_BANKING_REDIRECT_URL`).

## Site access (production internet exposure)

When **`BANK_SITE_ACCESS_SECRET`** is set on the container (pass via [`09-docker-run-production.sh`](09-docker-run-production.sh)), Express requires **either**:

- **`Authorization: Bearer <BANK_SITE_ACCESS_SECRET>`** on `/api/*` (for `curl`, automation, AI HTTP clients — configure only in env / secrets managers, **never paste into chat**), **or**
- An **HttpOnly session cookie** after signing in at **`/login.html`** (password defaults to the same secret unless **`BANK_SITE_LOGIN_PASSWORD`** is set).

Always exempt without prior auth: **`GET /api/feed/enable/callback`** (Enable Banking redirect).

Optional **`BANK_SITE_LOGIN_PASSWORD`**: human-facing login password only; Bearer tokens continue to use **`BANK_SITE_ACCESS_SECRET`** only.

Minimum secret length is enforced (**16 UTF-8 bytes**). Omit **`BANK_SITE_ACCESS_SECRET`** entirely for dev/local containers so `/api/*` stays open.

On EC2, [`09-docker-run-production.sh`](09-docker-run-production.sh) automatically **`source`**s **`./production-env.local.sh`** when it sits **next to that script** on the server (same folder as **`config.sh`** — typically **`~/bank-deploy-aws/production-env.local.sh`**). Create it on the server only, **`chmod 600`**, with `export BANK_SITE_ACCESS_SECRET='…'` and any other overrides (**`BANK_SITE_LOGIN_PASSWORD`**, optional **`BANK_S3_DURABLE_*`** overrides). Use [`production-env.local.example.sh`](production-env.local.example.sh) as a starting point (**exclude `production-env.local.sh` when copying `deploy/aws`** so laptop copies do not overwrite server secrets).

Optional edge friction: HTTP Basic Auth in Caddy — commented appendix in [`caddy/Caddyfile.example`](caddy/Caddyfile.example) (often awkward for browser automation unless credentials are wired into the tool).

## Lightsail

Use **`05-lightsail-provision.sh`** instead of 03; it also writes **`.elastic-ip`** for **`04-route53-upsert-a.sh`**.

## Local Docker smoke test

```bash
docker build -t bank-app:latest .
docker run --rm -p 3000:3000 -e NODE_ENV=production bank-app:latest
```
