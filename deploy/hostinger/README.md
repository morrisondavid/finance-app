# Hostinger deployment — ASAP runbook

**Cursor stays local.** You SSH to the VPS and run AWS CLI on your laptop.

Same app as EC2: Docker + Caddy + S3 durable sync. EC2 used an **instance profile**; Hostinger needs an **IAM user + access keys** in `production-env.local.sh`.

---

## What was missing (now scripted)

| Gap | Fix |
|-----|-----|
| No IAM user on Hostinger (EC2 had instance profile) | **Laptop:** `./05-create-iam-user.sh` (exact S3 actions on the existing bucket) |
| DNS still points at EC2 Elastic IP | **Laptop:** `./05-route53-upsert-a.sh` |
| AWS CLI not installed on VPS | **VPS:** `01-host-install-docker.sh` installs it |
| Caddy manual start | **VPS:** `03-install-caddy.sh` installs systemd unit |

No new bucket needed — the app already stores everything in `traxiproducts-finances-bank-app-data-eu-west-2`. The IAM policy is scoped to that one bucket with exact actions, so isolation is by policy, not by bucket. (`05-create-s3-bucket.sh` remains available if you ever want a fresh bucket.)

Policy: `05-create-iam-user.sh` grants **only the exact S3 actions the app uses** (GetObject, PutObject, HeadObject, ListBucket, multipart) on `BUCKET_DATA` — no `s3:*`, no AWS account admin. Details: [IAM-S3-POLICY.example.json](IAM-S3-POLICY.example.json). Template: [iam-s3-bank-app-policy.json](iam-s3-bank-app-policy.json).

---

## ASAP order (~30–60 min)

### A. Laptop — AWS (once)

```bash
cd deploy/hostinger
cp config.example.sh config.sh
# Edit config.sh: set HOSTINGER_PUBLIC_IP (BUCKET_DATA already points at the existing bucket)

./05-create-iam-user.sh          # exact S3 actions on the existing bucket → save keys for step C
./05-route53-upsert-a.sh         # finances.traxiproducts.com → Hostinger IP
```

Requires: AWS admin creds on laptop (`aws sts get-caller-identity`), Route53 hosted zone for `traxiproducts.com`.

### B. Laptop — build + ship image

```bash
# From repo root — match VPS arch (ssh user@host uname -m)
export DOCKER_DEFAULT_PLATFORM=linux/amd64   # or linux/arm64
docker build -t bank-app:latest .

docker save bank-app:latest | gzip > bank-app-latest.tar.gz
scp bank-app-latest.tar.gz user@HOSTINGER_IP:~/
scp -r deploy/hostinger user@HOSTINGER_IP:~/bank-deploy-hostinger
```

Copy Enable PEM separately:

```bash
scp secrets/enable-banking-private.pem user@HOSTINGER_IP:/opt/bank-app/secrets/
```

(Or scp after VPS bootstrap creates `/opt/bank-app/secrets`.)

### C. VPS — bootstrap (once)

```bash
ssh user@HOSTINGER_IP
cd ~/bank-deploy-hostinger
chmod +x *.sh lib/*.sh

./00-host-bootstrap.sh           # Docker + AWS CLI + dirs + Caddy (or run 01–03 individually)

cp config.example.sh config.sh
```

**Secrets:** scp `production-env.local.sh` from your laptop (see step A). Do **not** run `cp production-env.local.example.sh production-env.local.sh` — that wipes secrets. First-time only: `./init-production-env.sh` then edit.

**`production-env.local.sh` checklist** (copy from your `.env.local` where applicable):

```bash
export AWS_ACCESS_KEY_ID='...'           # from 05-create-iam-user.sh
export AWS_SECRET_ACCESS_KEY='...'
export BANK_SITE_ACCESS_SECRET='...'     # ≥16 bytes
export MCP_BEARER_TOKEN='...'            # ≥16 bytes
export TRUELAYER_CLIENT_ID='...'
export TRUELAYER_CLIENT_SECRET='...'
export TRUELAYER_REDIRECT_URL='https://finances.traxiproducts.com/api/feed/truelayer/callback'
export ENABLE_BANKING_APP_ID='...'
# optional: export BANK_SITE_LOGIN_PASSWORD='...'
```

Place Enable key: `sudo mkdir -p /opt/bank-app/secrets && sudo cp ~/enable-banking-private.pem /opt/bank-app/secrets/`

### D. VPS — deploy

```bash
gunzip -c ~/bank-app-latest.tar.gz | docker load
cd ~/bank-deploy-hostinger
./04-docker-run-production.sh    # S3 pull → start bank container

sudo systemctl start caddy
sudo systemctl status caddy
```

### E. Verify

```bash
curl -s http://127.0.0.1:3000/api/version          # on VPS
curl -s https://finances.traxiproducts.com/api/version
docker logs -f bank   # wait for [Database] Ready (1–2 min first boot)
```

Login: `https://finances.traxiproducts.com` with `BANK_SITE_ACCESS_SECRET`.

---

## Rolling deploy (after first time)

1. Laptop: `docker build` + `docker save` + `scp` image (or rebuild on VPS if you prefer).
2. VPS: `./04-docker-run-production.sh`.

---

## Route53 cutover

Script: `./05-route53-upsert-a.sh` (laptop). Manual equivalent:

- Route53 → `traxiproducts.com` → **A** `finances` → Hostinger public IP, TTL 300.

TrueLayer / Enable redirect URLs stay the same if hostname unchanged.

## Decommission EC2

After **48h** stable on Hostinger:

1. Confirm `[S3Sync] Upload` in `docker logs bank` after any edit.
2. Terminate EC2; release Elastic IP if unused.
3. Keep S3 bucket + Route53 + Hostinger IAM user.

---

## TrueLayer feed cache

Feed sync tries local disk → S3 → TrueLayer API. No mode flags required.

Optional laptop prefetch: `./scripts/pull-truelayer-feed-cache-from-s3.sh`

---

## Hermes (optional, separate container)

[HERMES.md](HERMES.md) + [docker-compose.hermes.example.yml](docker-compose.hermes.example.yml). No shared volumes with `bank`.

---

## Env reference

| Variable | Where |
|----------|--------|
| `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` | `production-env.local.sh` (required) |
| `BANK_S3_DURABLE_BUCKET` | `config.sh` (default: same bucket as EC2) |
| `HOSTINGER_PUBLIC_IP` | `config.sh` (laptop DNS script only) |
| `MCP_BEARER_TOKEN` | `production-env.local.sh` |

See [production-env.local.example.sh](production-env.local.example.sh) and repo `.env.example`.

---

## Operator image transfer

Details: [OPERATOR-image-transfer.md](OPERATOR-image-transfer.md)

## IAM policy reference

Human-readable notes: [IAM-S3-POLICY.example.json](IAM-S3-POLICY.example.json)  
Machine policy for `05-create-iam-user.sh`: [iam-s3-bank-app-policy.json](iam-s3-bank-app-policy.json)
