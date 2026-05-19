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

# Uncomment if this host uses S3 durable sync:
# export BANK_S3_DURABLE_SYNC=1
