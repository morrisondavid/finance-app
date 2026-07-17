# Hermes on Hostinger

## docker-compose (example)

Copy to the VPS and adjust. **Separate** from `bank` — no shared volumes.

```yaml
services:
  hermes:
    image: nousresearch/hermes-agent:latest
    container_name: hermes
    restart: unless-stopped
    command: gateway run
    volumes:
      - /opt/hermes-data:/opt/data
    ports:
      - "127.0.0.1:8642:8642"
    extra_hosts:
      - "host.docker.internal:host-gateway"
```

Setup wizard (once):

```bash
mkdir -p /opt/hermes-data
docker run -it --rm -v /opt/hermes-data:/opt/data nousresearch/hermes-agent setup
docker compose -f docker-compose.hermes.example.yml up -d
```

## MCP allowlist (budgeting)

In Hermes `config.yaml` for the finance MCP server, prefer **`tools.include`**:

- `tax_get_overview`
- `analytics_get_available_funds`
- `analytics_get_survival`
- `survival_get_allowance`
- `analytics_get_upcoming`
- `financial_obligations_list_upcoming`
- `transactions_drill_query`
- `warnings_get_consolidated`

Exclude unless needed:

- `household_financial_posture` (heavy; use narrower tools)
- `statements_upload_base64` (only if using Telegram PDF skill)
- `invoices_get_pdf_base64`, `contracts_get_signed_pdf_base64`
- `bank_feed_sync`, `feed_oauth_*`
- `*_commit_*`, `*_send_*`

Set `approvals.mode: manual` for terminal commands.

## Local LLM (Ollama)

On the Hostinger host:

```bash
curl -fsSL https://ollama.com/install.sh | sh
ollama pull qwen2.5:7b-instruct-q4_K_M
```

Point Hermes model config at `http://host.docker.internal:11434`.

## Backup

See [README.md](README.md#hermes-off-box-backup-you). Use **`hermes backup` + rclone → S3** — not GitHub for full state (secrets in `.env`).
