# AWS deployment (Docker + finances.traxiproducts.com)

**All settings are in [`config.sh`](config.sh)** (region, S3 names, EC2 key name, ECR repo, Enable URLs, etc.). Change **`BANK_APP_KEY_NAME`** there to match an EC2 key pair you create in **eu-west-2**, or create a key pair with the exact name already in `config.sh`.

Prerequisites: [AWS CLI v2](https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html) + credentials/SSO; for EC2, a key pair; Docker on your laptop for `07`.

## Order to run (from `deploy/aws/`)

```bash
./01-s3-buckets.sh
./02-iam-ec2-profile.sh
./03-ec2-provision.sh        # writes .elastic-ip; create key pair in AWS if this fails
./04-route53-upsert-a.sh     # uses .elastic-ip from step 3
./07-ecr-build-and-push.sh   # from repo: laptop with Docker
```

## S3 durable state (pull on container start)

Production data (`statements/`, `data/transactions.db`, `budgets/`, …—same trees as [`server/storage/durable-paths.ts`](../server/storage/durable-paths.ts)) can live in **`s3://${BUCKET_DATA}/${BANK_S3_DURABLE_PREFIX}`**. On boot the app **pulls** that prefix before SQLite opens; after a full CSV rebuild, **shutdown**, or on a **periodic timer** (production only), it **pushes** updates back.

- **`data/enable-sessions.json` is never synced** (server-local Enable OAuth material); re-link banks if you restore only from S3.
- At-rest encryption uses **S3 default encryption** (SSE-S3). Principals that can `GetObject` still receive decrypted bytes—lock down IAM (`02` currently attaches broad S3 access; tighten later to `GetObject`/`PutObject`/`ListBucket` on `arn:aws:s3:::${BUCKET_DATA}/${PREFIX}*`).

### One-time seed from your laptop

Requires buckets from `./01-s3-buckets.sh` and AWS CLI credentials (same profile you use for deploy):

```bash
# From repo root
./deploy/aws/12-s3-seed-durable-from-local.sh
```

Optional: install `sqlite3` CLI so the script runs `PRAGMA wal_checkpoint(TRUNCATE)` before upload (single-file DB snapshot).

### Enable sync on EC2

[`config.sh`](config.sh) sets **`BANK_S3_DURABLE_BUCKET`** (defaults to `BUCKET_DATA`) and **`BANK_S3_DURABLE_PREFIX`** (defaults to `bank-state/prod`). On the instance, **before** `./09-docker-run-production.sh`:

```bash
export BANK_S3_DURABLE_SYNC=1
```

[`09-docker-run-production.sh`](09-docker-run-production.sh) passes `AWS_REGION`, `BANK_S3_*`, optional **`BANK_S3_DURABLE_SSE_KMS_KEY_ID`**, and **`BANK_S3_DURABLE_PUSH_INTERVAL_MS`** (default 30 minutes). The instance profile supplies credentials—do **not** put static AWS keys in env.

[`08-host-create-dirs.sh`](08-host-create-dirs.sh) creates **all** bind-mount paths under `/opt/bank-app` (not only `data`/`statements`/`invoices`).

### Rolling out after code changes

1. Run **`12-s3-seed-durable-from-local.sh`** if S3 does not yet reflect your authoritative copy (first deploy or drift recovery).
2. On EC2: **`./08-host-create-dirs.sh`** once so new mount roots exist with correct ownership.
3. Laptop: **`./07-ecr-build-and-push.sh`** (image must include `@aws-sdk/client-s3`).
4. EC2: ECR login (see below), then **`docker rm -f bank`** and **`./09-docker-run-production.sh`** with **`BANK_S3_DURABLE_SYNC=1`** so `:latest` is pulled.
5. Confirm logs show **`[S3Sync] Pull`** then **`[Database]`** and the dashboard loads without manual `scp`.

Optional legacy cron: **`11-s3-sync-push.sh`** only pushed `data/` + `statements/`; the app sync now covers the **full durable tree** when sync is enabled.

## Copy `deploy/aws` onto the EC2 host

From your **laptop**, at the **repo root** (`bank-statements-app/`), replace `EC2_IP` and the key path if yours differ (see [`config.sh`](config.sh) `BANK_APP_KEY_NAME`).

```bash
export EC2_IP="YOUR_ELASTIC_IP"   # e.g. from deploy/aws/.elastic-ip
export SSH_KEY="${HOME}/.ssh/traxiproducts-finances-bank-app-eu-west-2.pem"

scp -i "$SSH_KEY" -r deploy/aws ec2-user@${EC2_IP}:~/bank-deploy-aws
```

**Enable private key** (must end up as `/opt/bank-app/secrets/enable-banking-private.pem` on the instance — path is fixed in [`09-docker-run-production.sh`](09-docker-run-production.sh)):

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

Optional backup cron: **`11-s3-sync-push.sh`** (needs instance profile / AWS creds on host).

## HTTPS + Enable

- Caddyfile hostname: **finances.traxiproducts.com** (see `caddy/Caddyfile.example`).
- Whitelist in Enable: **`https://finances.traxiproducts.com/api/feed/enable/callback`** (must match [`config.sh`](config.sh) `ENABLE_BANKING_REDIRECT_URL`).

## Lightsail

Use **`05-lightsail-provision.sh`** instead of 03; it also writes **`.elastic-ip`** for **`04-route53-upsert-a.sh`**.

## Local Docker smoke test

```bash
docker build -t bank-app:latest .
docker run --rm -p 3000:3000 -e NODE_ENV=production bank-app:latest
```
