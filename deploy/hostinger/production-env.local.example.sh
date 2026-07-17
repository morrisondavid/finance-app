#!/usr/bin/env bash
# Template — on the Hostinger VPS, copy next to 04-docker-run-production.sh and chmod 600:
#   cp production-env.local.example.sh production-env.local.sh && chmod 600 production-env.local.sh

# Required — site + MCP Bearer auth (≥16 UTF-8 bytes each)
# export BANK_SITE_ACCESS_SECRET=''
# export MCP_BEARER_TOKEN=''

# Required — S3 durable sync (narrow IAM user; no EC2 instance profile on Hostinger)
# export AWS_ACCESS_KEY_ID=''
# export AWS_SECRET_ACCESS_KEY=''

# Optional — human login for /login.html
# export BANK_SITE_LOGIN_PASSWORD=''

# TrueLayer OAuth
# export TRUELAYER_CLIENT_ID=''
# export TRUELAYER_CLIENT_SECRET=''
# export TRUELAYER_REDIRECT_URL='https://finances.traxiproducts.com/api/feed/truelayer/callback'

# Enable Banking
# export ENABLE_BANKING_APP_ID=''

# Optional deploy guard (64-char hex from docker image source-hash.json)
# export BANK_EXPECT_SOURCE_SHA256=''

# Production defaults (04 sets these if unset)
# export BANK_READ_CACHE_TTL_SECONDS='60'
