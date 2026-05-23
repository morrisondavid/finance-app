#!/usr/bin/env bash
# Template only — on the server, copy next to `09-docker-run-production.sh` and chmod 600:
#   cp production-env.local.example.sh production-env.local.sh && chmod 600 production-env.local.sh
#
# Edit `production-env.local.sh` and add at least:
#   export BANK_SITE_ACCESS_SECRET='your-secret-at-least-16-utf8-bytes'
#
# `09-docker-run-production.sh` sources `./production-env.local.sh` when that file exists.
# It is excluded from laptop→server rsync — never overwrite server secrets from git.

# Optional — human-only login for /login.html (Bearer always uses BANK_SITE_ACCESS_SECRET).
# export BANK_SITE_LOGIN_PASSWORD=''

# Optional — TrueLayer OAuth client secret (preferred here over config.sh — never commit secrets).
# export TRUELAYER_CLIENT_SECRET=''

# Optional — override defaults from config.sh (`BANK_S3_DURABLE_BUCKET`/`PREFIX`).
# `./09-docker-run-production.sh` always runs `aws s3 sync --delete` for durable dirs before `docker run`,
# using these values plus `AWS_REGION` from config.

# Optional — after `docker pull`, `09` compares the image `dist/source-hash.json` `.value` to this
# (64-char lowercase hex from laptop `./07` output or from a known-good `GET /api/version`).
# export BANK_EXPECT_SOURCE_SHA256=''
