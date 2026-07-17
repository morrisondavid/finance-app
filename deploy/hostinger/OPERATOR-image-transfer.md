# Transfer Docker image to Hostinger (operator)

The agent does not SSH. **You** build on your laptop and move the image to the VPS.

## 1. Build for Hostinger CPU

From repo root:

```bash
# Match VPS architecture (check with: ssh user@host uname -m)
export DOCKER_DEFAULT_PLATFORM=linux/amd64   # or linux/arm64

docker build -t bank-app:latest .
docker run --rm bank-app:latest node -e \
  'console.log(JSON.parse(require("fs").readFileSync("/app/dist/source-hash.json","utf8")).value)'
```

Copy the `sourceSha256` hex into `production-env.local.sh` as `BANK_EXPECT_SOURCE_SHA256` on the VPS (optional guard).

## 2. Option A — save + scp + load (simple)

**Laptop:**

```bash
docker save bank-app:latest | gzip > bank-app-latest.tar.gz
scp bank-app-latest.tar.gz user@YOUR_HOSTINGER_IP:~/
```

**VPS:**

```bash
gunzip -c ~/bank-app-latest.tar.gz | docker load
docker images bank-app:latest
```

Set in `config.sh`: `BANK_APP_IMAGE=bank-app:latest`

## 3. Option B — private registry

Push to GHCR/Docker Hub from laptop; on VPS `docker login` and `docker pull`. Set `BANK_APP_IMAGE` to the full tag.

## 4. Deploy scripts

```bash
scp -r deploy/hostinger user@YOUR_HOSTINGER_IP:~/bank-deploy-hostinger
```

On VPS: `cd ~/bank-deploy-hostinger`, copy `config.example.sh` → `config.sh`, add `production-env.local.sh`, run `04-docker-run-production.sh`.
