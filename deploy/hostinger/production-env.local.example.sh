#!/usr/bin/env bash
# TEMPLATE ONLY — never copy over an existing production-env.local.sh (you will wipe secrets).
# First-time on VPS: ./init-production-env.sh  (creates production-env.local.sh once)
# Normal workflow: scp production-env.local.sh from your laptop after 05-create-iam-user.sh

export AWS_ACCESS_KEY_ID=''
export AWS_SECRET_ACCESS_KEY=''

export BANK_SITE_ACCESS_SECRET=''
export MCP_BEARER_TOKEN=''

export TRUELAYER_CLIENT_ID=''
export TRUELAYER_CLIENT_SECRET=''
export TRUELAYER_REDIRECT_URL='https://finances.traxiproducts.com/api/feed/truelayer/callback'
export TRUELAYER_AUTH_BASE='https://auth.truelayer.com'
export TRUELAYER_API_BASE='https://api.truelayer.com'

export ENABLE_BANKING_APP_ID=''

export BANK_READ_CACHE_TTL_SECONDS='60'
