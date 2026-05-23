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
- **`data/enable-sessions.json`** is excluded from **`data/`** sync (Enable OAuth blobs stay server-local for a single EC2 writer).
- **`data/truelayer-tokens.local.json`** is excluded from **`data/`** sync (TrueLayer refresh tokens — same “server-local OAuth material” semantics as Enable).
- **Portable financial CSVs are not portable live OAuth session state:** if you run multiple app instances (Lambda/Fargate, `desiredCount > 1`), you need a **single shared, strongly consistent store** for refresh tokens (S3 conditional writes, DynamoDB, etc.) — see **Multi-instance Enable Banking** below.
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
4. Laptop (**if `deploy/aws` scripts changed**): **`./deploy/aws/copy-deploy-to-ec2.sh`**
5. EC2: **`cd ~/bank-deploy-aws`** → **`./09-docker-run-production.sh`** (ECR **`docker pull`** is built in; pulls **`:latest`** then S3 sync + **`docker run`**).
6. Confirm logs show **`[09] Pulling`**, then either **`Downloaded newer image`** **or** **`Image is up to date`** (the latter only means this host’s Docker cache already matched the tag’s manifest digest—not a failed pull), then **`[09] Registry digest`** (copy to compare with laptop / ECR console), **`[09] Syncing durable dirs`** (host), then **`[Database]`** in **`docker logs bank`**.
7. **Fingerprint parity:** **`GET /api/version`** returns JSON with **`packageVersion`**, **`sourceSha256`** (64-char lowercase hex from the shipped trees in [`Dockerfile`](../../Dockerfile) **`RUN npm run build`**), **`sourceHashManifest`** (**`built`** in production vs **`runtime-computed`** elsewhere), **`nodeEnv`**. See **[Verify deploy parity](#verify-deploy-parity-get-apiversion)**.

**If you expected a new deploy but the registry digest / `sourceSha256` never changes:** confirm **`07`** **`docker push`** finished for **both** **`…:latest`** and **`…:src-<prefix>`** (immutable tag from `dist/source-hash.json`) with the same **`BANK_APP_ECR_REPO_NAME`**, account, and region as **`config.sh`** on the host; confirm you re-ran **`09`** after the push; check **`BANK_APP_IMAGE`** in **`production-env.local.sh`** is not pinning an old tag.

### Verify deploy parity (`GET /api/version`)

- **JSON, not HTML:** `curl -si "https://<hostname>/api/version"` should show **`Content-Type: application/json`**. If the body is **`index.html`**, the live container is almost certainly an **old image** (Express **`app.get('*')` SPA fallback before **`/api/version` existed**) or traffic is not reaching Express on **`:3000`**.
- **Inside the container:** `docker exec bank wget -qO- http://127.0.0.1:3000/api/version` — same JSON; isolates TLS / Caddy.
- **Match laptop build:** run **`./07-ecr-build-and-push.sh`** and copy the printed **full `sourceSha256`**; after **`09`**, the site’s **`sourceSha256`** must match (same checkout). **`07`** also pushes **`…:src-<first 12 hex chars>`** — set **`BANK_APP_IMAGE`** to that tag on the server for a pin that cannot float with **`:latest`**.
- **ECR digest:** **`[09] Registry digest for …`** line — compare to your laptop’s **`docker image inspect <image> --format '{{index .RepoDigests 0}}'`** after push, or the ECR console manifest for the tag you run.
- **Optional guard:** set **`BANK_EXPECT_SOURCE_SHA256`** (64-char hex) in **`production-env.local.sh`**; **`09`** **`docker pull`** then **`docker run --rm … node -e …`** verifies **`/app/dist/source-hash.json`** before S3 sync and starting the **`bank`** container. See [`production-env.local.example.sh`](production-env.local.example.sh).

Optional legacy cron: **`11-s3-sync-push.sh`** only synced `data/` + `statements/` to legacy bucket layouts; **`09`** + targeted SDK uploads mirror the **full durable tree** under **`BANK_S3_DURABLE_PREFIX`** for new installs.

### Multi-instance Enable Banking (future)

For autoscaled containers or Lambda, **do not** rely on a shared **`enable-sessions.json`** on a network filesystem without compare-and-swap semantics—two writers can clobber refresh tokens. Plan on **`EnableSessionStore`** backed by **one** consistent store (S3 object ETag CAS, DynamoDB conditional update, etc.) keyed by tenant, and keep private keys in Secrets Manager / SSM—not in the durable CSV bucket.

### Local development

Daily **`npm run dev`** does **not** run **`09`**, so **`aws s3 sync` never executes** locally. Omit **`BANK_S3_DURABLE_BUCKET`** in **`.env.local`** so Node does **not** push during dev.

## Copy `deploy/aws` onto the EC2 host

From your **laptop**, at **repo root** (`bank-statements-app/`).

**Preferred:** [`copy-deploy-to-ec2.sh`](copy-deploy-to-ec2.sh) streams **`tar` over SSH** (no `rsync` on the laptop or server). The archive **omits** `production-env.local.sh`, `config.sh`, and `.elastic-ip` so existing server-only files are not replaced when you extract into `~/bank-deploy-aws/`.

```bash
./deploy/aws/copy-deploy-to-ec2.sh
# or: EC2_IP=16.xx.xx.xx SSH_KEY=~/.ssh/your.pem ./deploy/aws/copy-deploy-to-ec2.sh
```

Uses `deploy/aws/.elastic-ip` when `EC2_IP` is unset.

**Avoid `scp -r deploy/aws … ~/bank-deploy-aws`** when **`~/bank-deploy-aws` already exists** — that often creates **`~/bank-deploy-aws/aws/`**.

### Manual equivalent (`tar` over SSH)

Same transport and excludes as the script:

```bash
export EC2_IP="$(tr -d '[:space:]' < deploy/aws/.elastic-ip)"
export SSH_KEY="${HOME}/.ssh/traxiproducts-finances-bank-app-eu-west-2.pem"

tar -C ./deploy/aws \
  --exclude='production-env.local.sh' \
  --exclude='config.sh' \
  --exclude='.elastic-ip' \
  -cf - . | ssh -i "${SSH_KEY}" "ec2-user@${EC2_IP}" 'mkdir -p ~/bank-deploy-aws && tar -C ~/bank-deploy-aws -xf -'
```

### Server secrets (`production-env.local.sh`)

[`09-docker-run-production.sh`](09-docker-run-production.sh) **`source`**s **`./production-env.local.sh`** next to itself on the server when present (same directory as **`config.sh`**). Create once from the shipped template ([`production-env.local.example.sh`](production-env.local.example.sh)); **`chmod 600`**. Put **`export BANK_SITE_ACCESS_SECRET='…'`** there (≥16 UTF‑8 bytes). Use **`export`** for **`TRUELAYER_*`** / **`ENABLE_BANKING_*`** when those vars are passed with bare **`-e NAME`** into Docker — see **`09-docker-run-production.sh`**.

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

Run host scripts from the copied folder (`cd ~/bank-deploy-aws`). **`09-docker-run-production.sh`** logs into ECR when **`BANK_APP_IMAGE`** targets **`.dkr.ecr.`** and runs **`docker pull`** **before** removing the old container or syncing from S3, so each deploy picks up the `:latest` you pushed from **`07-ecr-build-and-push.sh`**. The instance profile needs ECR read (e.g. **`AmazonEC2ContainerRegistryReadOnly`**) alongside S3.

On the **server** (after `cd ~/bank-deploy-aws`):

```bash
./06-host-install-docker-al2023.sh   # only if Docker missing
./08-host-create-dirs.sh
./09-docker-run-production.sh
./10-install-caddy-al2023.sh         # then start Caddy (see Caddy docs / run as systemd)
```

If **`aws s3 sync`** in **09** reports **`Permission denied`** under **`/opt/bank-app`**, the mounts had **root-owned** files left by Docker while sync runs as **`ec2-user`**. Current **09** runs **`sudo chown -R ec2-user:ec2-user /opt/bank-app`** before sync; on an older copy of the script, fix once with that **`chown`**, then re-run **09**.

Optional backup cron: **`11-s3-sync-push.sh`** (needs instance profile / AWS creds on host).

## Enable Banking (registration, ASPSPs, Barclays live feed)

Use this when onboarding a **live** Enable Banking application and linking **Barclays business** (`barclays-current`) via the bundled Enable integration ([`server/routes/feed.ts`](deploy/aws/../server/routes/feed.ts), [`scripts/enable-banking-link.ts`](deploy/aws/../scripts/enable-banking-link.ts)).

### Policy URLs for Enable Banking application registration

After `npm run build` and Docker deploy, hosted static pages (readable without Bearer or cookie—they are outside `/api/*`):

| Page | Typical production URL |
|------|--------------------------|
| Privacy | `https://<your-public-host>/privacy.html` |
| Terms | `https://<your-public-host>/terms.html` |

Customise [`public/privacy.html`](deploy/aws/../public/privacy.html) and [`public/terms.html`](deploy/aws/../public/terms.html) for your legal entity before submitting to Enable.

### Operators: dump ASPSP directory JSON (`aspsps-*.json`)

From **repo root** with `ENABLE_BANKING_APP_ID`, private key, and **`ENABLE_BANKING_API_BASE`** unset for production API (unless you intentionally use sandbox):

```bash
npm run enable-banking -- aspsps GB --out aspsps-gb.json
```

Outputs are **`gitignored`** (pattern `aspsps-*.json`) and are **not** copied into Docker images unless you add an explicit bake step—they are laptop/operator artefacts for discovering the **`name`** Enable expects when calling **`POST /auth`**.

Discover **Barclays Business**: open the dump and locate the Barclays **business** entry; copy its **`name`** string exactly into `POST /api/feed/enable/start` **`aspspName`** (or **`aispFeed.enableBanking.institutionHint.institutionName`** in [`server/domain/accounts/data.ts`](deploy/aws/../server/domain/accounts/data.ts)).

### Operator checklist — TrueLayer Console

1. **`TRUELAYER_CLIENT_ID`** + **`TRUELAYER_CLIENT_SECRET`** on the container (see repo **`.env.example`**); **`TRUELAYER_AUTH_BASE`** / **`TRUELAYER_API_BASE`** default to TrueLayer production hosts when unset.
2. Redirect allowlist: **`https://<your-domain>/api/feed/truelayer/callback`** must match **`TRUELAYER_REDIRECT_URL`** exactly (**`09-docker-run-production.sh`** passes this through from **`config.sh`** / **`production-env.local.sh`**).
3. Console scopes (**`info`**, **`accounts`**, **`balance`**, **`transactions`**, **`offline_access`**).
4. **`POST /api/feed/truelayer/start`** → open **`url`** → callback persists **`data/truelayer-tokens.local.json`** (gitignored — excluded from **`aws s3 sync`** on **`09`**/`12`, same idea as **`enable-sessions.json`**). Multi-account: **`data/truelayer-account-links.csv`**.

Automated **`POST /api/feed/sync`** prefers TrueLayer when **`aispFeed.trueLayer.dataAccountId`** is set **and** a TL refresh token exists; otherwise Enable.

### Operator checklist — Enable control panel (`enable-prod-console`)

1. Production app id aligned with **`ENABLE_BANKING_APP_ID`** on the container.
2. **Redirect URL whitelist:** `https://<your-domain>/api/feed/enable/callback` (= **`ENABLE_BANKING_REDIRECT_URL`**).
3. Public key paired with PEM at **`ENABLE_BANKING_PRIVATE_KEY_PATH`** on the host.
4. **Privacy + terms URLs** pointing at **`/privacy.html`** and **`/terms.html`**.
5. **Live** access to Barclays UK ASPSPs (not sandbox-only), if gated by Enable.

### Operator checklist — production env (`prod-env-caddy`)

[`09-docker-run-production.sh`](09-docker-run-production.sh): **`ENABLE_BANKING_APP_ID`**, **`ENABLE_BANKING_REDIRECT_URL`**, **`ENABLE_BANKING_PRIVATE_KEY_PATH`** (Enable); **`TRUELAYER_*`** forwarded when exporting them in **`config.sh`** / **`production-env.local.sh`**; Caddy terminates HTTPS on the hostname that matches each provider whitelist.

### Link once (`link-flow`)

Preferred: **Accounts** tab (`public/index.html` balance panel) — when the toolbar is **`Connect bank`** / **`Reconnect bank`** (driven by **`GET /api/dashboard/feed-toolbar-state`**, aligned with **`requireLinkedFeed`** in [`server/ingestion/feeds/sync.ts`](deploy/aws/../server/ingestion/feeds/sync.ts)), click it to **`POST`** [`/api/feed/truelayer/start`](deploy/aws/../server/routes/truelayer-oauth.ts) or **`/api/feed/enable/start`** and redirect to bank consent (`enable` fills **`country`** / **`aspspName`** from **`aispFeed.enableBanking.institutionHint`** when omitted). **`Sync bank feed`** appears only when a link is active. **`401`** with **`expired-session`** / **`no-session`** from **`POST /api/feed/sync`** prompts **Reconnect**.

Manual / automation (same APIs the UI calls):

1. Authenticate **`/api/*`** when site gate enabled (`/login.html` cookie or **`Authorization: Bearer`**).
2. **TrueLayer**: **`POST /api/feed/truelayer/start`** `{ "account":"barclays-current" }` → open **`url`** → callback.
3. **Enable**: **`POST /api/feed/enable/start`** JSON e.g. `{ "account":"barclays-current", "country":"GB", "aspspName":"<exact from dump>" }` — **`psuType` defaults to `business`** for business-category accounts ([`enable-oauth.ts`](deploy/aws/../server/routes/enable-oauth.ts)).
4. If a single PSU account is linked (Enable) or TL returns one Data account id, CSV / tokens update automatically; else map UID / account ids manually ([`enable-oauth.ts`](deploy/aws/../server/routes/enable-oauth.ts)), ([`truelayer-oauth.ts`](deploy/aws/../server/routes/truelayer-oauth.ts)).

### First automated sync (`feed-sync-verify`)

`POST /api/feed/sync` with `{ "account":"barclays-current", "dateFrom":"YYYY-MM-DD" [, "force": true ] }`. Confirm new CSV under **`statements/barclays-current/csv/`** after container logs show ingest.

## HTTPS + OAuth callbacks (Enable / TrueLayer)

- Caddyfile hostname: **finances.traxiproducts.com** (see [`caddy/Caddyfile.example`](caddy/Caddyfile.example)).
- Whitelist in Enable: **`https://finances.traxiproducts.com/api/feed/enable/callback`** (must match **`config.sh`** `ENABLE_BANKING_REDIRECT_URL`).
- Whitelist in TrueLayer: **`https://finances.traxiproducts.com/api/feed/truelayer/callback`** (must match **`TRUELAYER_REDIRECT_URL`**).

## Site access (production internet exposure)

When **`BANK_SITE_ACCESS_SECRET`** is set on the container (pass via [`09-docker-run-production.sh`](09-docker-run-production.sh)), Express requires **either**:

- **`Authorization: Bearer <BANK_SITE_ACCESS_SECRET>`** on `/api/*` (for `curl`, automation, AI HTTP clients — configure only in env / secrets managers, **never paste into chat**), **or**
- An **HttpOnly session cookie** after signing in at **`/login.html`** (password defaults to the same secret unless **`BANK_SITE_LOGIN_PASSWORD`** is set).

Always exempt without prior auth: **`GET /api/feed/enable/callback`** (Enable), **`GET /api/feed/truelayer/callback`** (TrueLayer OAuth redirect), and **`GET /api/version`** — JSON **`{ packageVersion, sourceSha256, sourceHashManifest, nodeEnv }`** for deploy parity (see **`dist/source-hash.json`** produced by **`npm run build`** in the [`Dockerfile`](../../Dockerfile) and **`07-ecr-build-and-push.sh`**).

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
