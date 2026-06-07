/**
 * Canonical MCP tool identifiers (migration target names).
 * Legacy aliases (`get_http_*`, `post_http_*`, `get_ai_*`, verb-first names) remain registered
 * beside these during deprecation — see MCP `instructions` in {@link ./bank-mcp-server.js}.
 */

export const CANONICAL_MCP_TOOL_GROUPS = [
  ['Cross-domain', ['household_financial_posture', 'income_get_composition']],
  [
    'Survival & insights',
    [
      'analytics_get_available_funds',
      'analytics_get_spend_rate',
      'analytics_get_upcoming',
      'analytics_get_survival',
      'survival_get_allowance',
      'survival_plan_commit',
      'survival_plan_get',
      'survival_plan_clear',
    ],
  ],
  ['Net worth', ['net_worth_capture_snapshot']],
  [
    'Analytics §2.0',
    [
      'analytics_get_liquidity',
      'analytics_get_pipeline',
      'analytics_get_runway',
      'analytics_get_snapshot',
      'analytics_get_financial_snapshot',
      'analytics_get_financial_safety',
      'analytics_get_spend_by_currency',
    ],
  ],
  ['Feeds', ['bank_feed_sync', 'feed_oauth_enable_start', 'feed_oauth_truelayer_start']],
  ['Transactions', ['transactions_drill_query']],
  ['Monthly invoices', ['invoices_preview_monthly', 'invoices_commit_monthly']],
  [
    'Accountant',
    [
      'accountant_readiness_snapshot',
      'accountant_readiness_financial_year',
      'reporting_list_periods',
      'accountant_readiness_upcoming',
      'accountant_preview_vat_bundle',
      'accountant_preview_corporation_tax_bundle',
      'accountant_preview_sa_bundle',
      'accountant_send_vat_bundle',
      'accountant_send_corporation_tax_bundle',
      'accountant_send_sa_bundle',
    ],
  ],
  ['Statements binary', ['statements_upload_base64', 'invoices_upload_supplier_pdfs_base64']],
  ['Contracts binary', ['contracts_get_signed_pdf_base64', 'invoices_get_pdf_base64']],
  [
    'Additional reads (representative)',
    [
      'debts_list',
      'debt_strategy_get_state',
      'budgets_list_lines',
      'budgets_get_category_names',
      'fixed_expenses_snapshot',
    ],
  ],
  [
    'Additional writes (representative)',
    [
      'deadlines_create',
      'financial_obligations_create',
      'financial_obligations_upsert_state',
      'financial_obligations_list_payment_candidates',
      'clients_update',
      'warnings_resolve_inter_company_classifications',
      'contracts_request_renewal',
    ],
  ],
] as const;
