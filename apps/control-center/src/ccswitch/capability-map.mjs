export const CCSWITCH_UPSTREAM = Object.freeze({
  repository: "farion1231/cc-switch",
  version: "3.18.0",
  registry: ".scratch/cc-switch/cc-switch-3.18.0/src-tauri/src/lib.rs",
  registrySha256: "50f6b4ec0c072d70d1cc2d7c3d811f68f15e9fa9b8e7c734fbc8f8c5a7d82c6c",
  commandCount: 288,
  namespacedCommandCount: 287,
});

const group = (id, status, commands, implementation, api, ui, tests, boundary = "") => Object.freeze({
  id,
  status,
  commands: Object.freeze(commands.trim().split(/\s+/).filter(Boolean)),
  implementation: Object.freeze(implementation),
  api: Object.freeze(api),
  ui: Object.freeze(ui),
  tests: Object.freeze(tests),
  boundary,
});

// Every upstream invoke entry is named explicitly. Do not replace these lists with
// prefix or catch-all rules: a new upstream command must force a deliberate review.
export const CCSWITCH_CAPABILITY_GROUPS = Object.freeze([
  group(
    "provider-catalog",
    "equivalent",
    `get_providers get_current_provider add_provider update_provider delete_provider
     remove_provider_from_live_config switch_provider import_default_config`,
    ["apps/control-center/src/providers.mjs"],
    ["/api/providers", "/api/providers/switch", "/api/providers/presets"],
    ["配置中心 > Providers"],
    ["apps/control-center/tests/providers.test.mjs"],
  ),
  group(
    "official-provider-bootstrap",
    "adapted",
    `get_claude_desktop_status get_claude_desktop_default_routes
     import_claude_desktop_providers_from_claude ensure_claude_desktop_official_provider
     ensure_codex_official_provider ensure_grokbuild_official_provider`,
    ["apps/control-center/src/providers.mjs", "apps/control-center/src/data/provider-presets.json"],
    ["/api/providers", "/api/providers/presets", "/api/providers/switch"],
    ["配置中心 > Providers > 预设 / 应用"],
    ["apps/control-center/tests/providers.test.mjs"],
    "514cc uses one eight-application ProviderStore and deterministic live writers instead of separate ensure commands.",
  ),
  group(
    "config-paths-and-diagnostics",
    "adapted",
    `get_claude_config_status get_config_status get_claude_code_config_path get_config_dir
     open_config_folder pick_directory open_external get_init_error get_migration_result
     get_skills_migration_result get_app_config_path open_app_config_folder read_live_provider_settings`,
    ["apps/control-center/src/ccswitch/domain.mjs", "apps/control-center/server.mjs", "apps/control-center/src/providers.mjs"],
    ["/api/ccswitch/domain/status", "/api/providers", "/api/system/pick-directory", "/api/system/reveal"],
    ["CC-Switch > 同步 > 配置目录", "配置中心 > Providers"],
    ["apps/control-center/tests/ccswitch-domain.test.mjs", "apps/control-center/tests/providers.test.mjs"],
    "Browser and local-kernel routes replace Tauri-only folder/dialog commands; storeStatus carries initialization failures without clobbering corrupt files.",
  ),
  group(
    "common-settings",
    "equivalent",
    `get_claude_common_config_snippet set_claude_common_config_snippet get_common_config_snippet
     set_common_config_snippet update_toml_common_config_snippet extract_common_config_snippet
     get_settings save_settings`,
    ["apps/control-center/src/providers.mjs", "apps/control-center/src/ccswitch/domain.mjs"],
    ["/api/providers/common-config", "/api/ccswitch/domain/status"],
    ["配置中心 > Providers > 通用配置", "CC-Switch > 同步"],
    ["apps/control-center/tests/provider-net.test.mjs", "apps/control-center/tests/ccswitch-domain.test.mjs"],
  ),
  group(
    "codex-history-safety",
    "adapted",
    `has_codex_unify_history_backup restore_codex_unified_history`,
    ["apps/control-center/src/sessions.mjs"],
    ["/api/sessions", "/api/sessions/preview"],
    ["会话 > 历史会话"],
    ["apps/control-center/tests/multicli-sessions.test.mjs", "apps/control-center/tests/cursor-sessions.test.mjs"],
    "514cc never rewrites Codex provider buckets, so the upstream destructive unify migration and its restore ledger are unnecessary; sessions are aggregated read-only from native stores.",
  ),
  group(
    "routing-optimization-and-logs",
    "adapted",
    `get_rectifier_config set_rectifier_config get_optimizer_config set_optimizer_config
     get_copilot_optimizer_config set_copilot_optimizer_config get_log_config set_log_config`,
    ["apps/control-center/src/response-limiter.mjs", "apps/control-center/src/router.mjs", "apps/control-center/src/observability.mjs"],
    ["/api/router/preview", "/api/observability/summary", "/api/config/sources"],
    ["配置中心 > Router / Sources", "观测"],
    ["apps/control-center/tests/response-limiter.test.mjs", "apps/control-center/tests/observability-sessions.test.mjs"],
    "Upstream product-specific rectifier/optimizer records are represented by 514cc routing, response leases, source configuration, and observability controls.",
  ),
  group(
    "native-lifecycle",
    "equivalent",
    `restart_app is_portable_mode copy_text_to_clipboard update_tray_menu set_auto_launch
     get_auto_launch_status set_window_theme enter_lightweight_mode exit_lightweight_mode is_lightweight_mode`,
    ["apps/desktop/src-tauri/src/native.rs", "apps/desktop/src-tauri/src/main.rs"],
    ["tauri://native"],
    ["CC-Switch > 代理 > 桌面原生", "系统托盘"],
    ["apps/desktop/src-tauri/src/native.rs"],
    "Portable mode reports false for the installed 514cc shell; lightweight mode intentionally hides the WebView while keeping the authenticated kernel alive.",
  ),
  group(
    "signed-updater",
    "blocked_external_trust",
    `install_update_and_restart check_app_update_available check_for_updates`,
    ["apps/desktop/src-tauri/src/native.rs", "apps/desktop/src-tauri/tauri.conf.json"],
    ["tauri://get_native_capabilities"],
    ["CC-Switch > 代理 > 桌面原生 > Updater 禁用"],
    ["apps/desktop/src-tauri/src/native.rs"],
    "Blocked until 514cc owns a signed release endpoint and updater public key; upstream signing material is never borrowed.",
  ),
  group(
    "claude-plugin-and-onboarding",
    "adapted",
    `get_claude_plugin_status read_claude_plugin_config apply_claude_plugin_config
     is_claude_plugin_applied apply_claude_onboarding_skip clear_claude_onboarding_skip`,
    ["apps/control-center/src/capabilities.mjs", "apps/control-center/src/providers.mjs", "module.yaml"],
    ["/api/capabilities", "/api/providers/switch"],
    ["能力中心", "配置中心 > Providers"],
    ["apps/control-center/tests/capabilities.test.mjs", "apps/control-center/tests/providers.test.mjs"],
    "514cc manages Claude capabilities through the module registry and live settings writer; it does not forge Claude onboarding completion state.",
  ),
  group(
    "claude-mcp-compat",
    "equivalent",
    `get_claude_mcp_status read_claude_mcp_config upsert_claude_mcp_server
     delete_claude_mcp_server validate_mcp_command`,
    ["apps/control-center/src/ccswitch/domain.mjs"],
    ["/api/ccswitch/domain/mcps"],
    ["CC-Switch > 资源 > MCP"],
    ["apps/control-center/tests/ccswitch-domain.test.mjs"],
  ),
  group(
    "usage-script",
    "equivalent",
    `queryProviderUsage testUsageScript`,
    ["apps/control-center/src/provider-net.mjs", "apps/control-center/src/usage-script-worker.mjs"],
    ["/api/providers/usage-test", "/api/providers/:id/usage"],
    ["配置中心 > Providers > 用量脚本"],
    ["apps/control-center/tests/provider-net.test.mjs"],
    "Untrusted extractors execute in a one-shot Worker and node:vm context; host objects never cross the isolate boundary.",
  ),
  group(
    "subscription-and-balance",
    "equivalent",
    `get_subscription_quota get_codex_oauth_quota get_codex_oauth_models get_xai_oauth_models
     get_coding_plan_quota get_balance`,
    ["apps/control-center/src/ccswitch/auth.mjs", "apps/control-center/src/provider-net.mjs"],
    ["/api/ccswitch/auth/:provider/quota", "/api/ccswitch/auth/:provider/models", "/api/providers/:id/usage"],
    ["CC-Switch > 账户", "配置中心 > Providers > 用量"],
    ["apps/control-center/tests/ccswitch-auth.test.mjs", "apps/control-center/tests/provider-net.test.mjs"],
  ),
  group(
    "unified-mcp",
    "equivalent",
    `get_mcp_config upsert_mcp_server_in_config delete_mcp_server_in_config set_mcp_enabled
     get_mcp_servers upsert_mcp_server delete_mcp_server toggle_mcp_app import_mcp_from_apps`,
    ["apps/control-center/src/ccswitch/domain.mjs"],
    ["/api/ccswitch/domain/mcps", "/api/ccswitch/domain/mcps/:id/apps/:app"],
    ["CC-Switch > 资源 > MCP"],
    ["apps/control-center/tests/ccswitch-domain.test.mjs", "apps/control-center/tests/ccswitch-http-e2e.test.mjs"],
  ),
  group(
    "prompt-management",
    "equivalent",
    `get_prompts upsert_prompt delete_prompt enable_prompt import_prompt_from_file
     get_current_prompt_file_content`,
    ["apps/control-center/src/ccswitch/domain.mjs"],
    ["/api/ccswitch/domain/prompts", "/api/ccswitch/domain/prompts/import", "/api/ccswitch/domain/prompts/current"],
    ["CC-Switch > 资源 > Prompt"],
    ["apps/control-center/tests/ccswitch-domain.test.mjs", "apps/control-center/tests/ccswitch-http-e2e.test.mjs"],
  ),
  group(
    "profile-management",
    "equivalent",
    `list_profiles create_profile update_profile delete_profile clear_current_profile apply_profile`,
    ["apps/control-center/src/ccswitch/domain.mjs"],
    ["/api/ccswitch/domain/profiles"],
    ["CC-Switch > 资源 > Profile"],
    ["apps/control-center/tests/ccswitch-domain.test.mjs"],
  ),
  group(
    "models-endpoints-sort-and-dirs",
    "equivalent",
    `fetch_models_for_config test_api_endpoints get_custom_endpoints add_custom_endpoint
     remove_custom_endpoint update_endpoint_last_used get_app_config_dir_override
     set_app_config_dir_override update_providers_sort_order`,
    ["apps/control-center/src/provider-net.mjs", "apps/control-center/src/providers.mjs", "apps/control-center/src/ccswitch/domain.mjs"],
    ["/api/providers/test-endpoints", "/api/providers/sort", "/api/ccswitch/domain/models/fetch", "/api/ccswitch/domain/config-dirs/:app"],
    ["配置中心 > Providers > 端点", "CC-Switch > 同步 > 配置目录"],
    ["apps/control-center/tests/provider-net.test.mjs", "apps/control-center/tests/ccswitch-domain.test.mjs"],
  ),
  group(
    "import-export-remote-sync-and-backups",
    "equivalent",
    `export_config_to_file import_config_from_file webdav_test_connection webdav_sync_upload
     webdav_sync_download webdav_sync_save_settings webdav_sync_fetch_remote_info
     s3_test_connection s3_sync_upload s3_sync_download s3_sync_save_settings
     s3_sync_fetch_remote_info save_file_dialog open_file_dialog open_zip_file_dialog
     create_db_backup list_db_backups restore_db_backup rename_db_backup delete_db_backup
     sync_current_providers_live`,
    ["apps/control-center/src/ccswitch/domain.mjs", "apps/control-center/server.mjs"],
    ["/api/ccswitch/domain/backups", "/api/ccswitch/domain/sync/:kind/:action", "/api/system/pick-file"],
    ["CC-Switch > 资源 > 备份", "CC-Switch > 同步"],
    ["apps/control-center/tests/ccswitch-domain.test.mjs", "apps/control-center/tests/ccswitch-http-e2e.test.mjs"],
    "Browser downloads/uploads and the local system picker replace Tauri save/open dialogs; backup payloads include providers, domain resources, and OAuth account metadata/tokens in the private data root.",
  ),
  group(
    "deeplink-import",
    "equivalent",
    `parse_deeplink merge_deeplink_config import_from_deeplink import_from_deeplink_unified`,
    ["apps/control-center/src/ccswitch/domain.mjs", "apps/desktop/src-tauri/src/native.rs"],
    ["/api/ccswitch/domain/deeplink/parse", "/api/ccswitch/domain/deeplink/import", "ccswitch://v1/import"],
    ["CC-Switch > 资源 > 深链"],
    ["apps/control-center/tests/ccswitch-domain.test.mjs", "apps/control-center/tests/ccswitch-http-e2e.test.mjs", "apps/desktop/src-tauri/src/native.rs"],
  ),
  group(
    "environment-conflicts",
    "equivalent",
    `check_env_conflicts delete_env_vars restore_env_backup`,
    ["apps/control-center/src/ccswitch/domain.mjs", "apps/control-center/src/providers.mjs"],
    ["/api/ccswitch/domain/env/conflicts", "/api/ccswitch/domain/env/delete", "/api/ccswitch/domain/env/backups/:id/restore"],
    ["CC-Switch > 同步 > 环境冲突"],
    ["apps/control-center/tests/ccswitch-domain.test.mjs", "apps/control-center/tests/provider-net.test.mjs"],
    "Deletion and restore require explicit confirmation and retain source/scope-aware backups; Windows user and machine environments are handled through the platform adapter.",
  ),
  group(
    "skill-management",
    "adapted",
    `get_installed_skills get_skill_backups delete_skill_backup install_skill_unified
     uninstall_skill_unified restore_skill_backup toggle_skill_app scan_unmanaged_skills
     import_skills_from_apps discover_available_skills check_skill_updates update_skill
     migrate_skill_storage search_skills_sh get_skills get_skills_for_app install_skill
     install_skill_for_app uninstall_skill uninstall_skill_for_app get_skill_repos add_skill_repo
     remove_skill_repo install_skills_from_zip`,
    ["apps/control-center/src/ccswitch/domain.mjs", "apps/control-center/src/market.mjs"],
    ["/api/ccswitch/domain/skills", "/api/market/skills", "/api/market/skills/install"],
    ["CC-Switch > 资源 > Skill", "市场 > Skills"],
    ["apps/control-center/tests/ccswitch-domain.test.mjs", "apps/control-center/tests/market.test.mjs"],
    "514cc uses canonical local skill storage plus the governed market staging/install flow instead of retaining the legacy per-app repository API.",
  ),
  group(
    "local-proxy-lifecycle",
    "equivalent",
    `start_proxy_server stop_proxy_server stop_proxy_with_restore get_proxy_takeover_status
     set_proxy_takeover_for_app get_proxy_status get_proxy_config update_proxy_config`,
    ["apps/control-center/src/ccswitch/proxy.mjs", "apps/control-center/src/providers.mjs"],
    ["/api/ccswitch/proxy/start", "/api/ccswitch/proxy/stop", "/api/ccswitch/proxy/status", "/api/ccswitch/proxy/config", "/api/ccswitch/proxy/takeover/:app"],
    ["CC-Switch > 代理"],
    ["apps/control-center/tests/ccswitch-proxy.test.mjs", "apps/control-center/tests/ccswitch-http-e2e.test.mjs"],
  ),
  group(
    "proxy-routing-config",
    "adapted",
    `get_global_proxy_config update_global_proxy_config get_proxy_config_for_app
     update_proxy_config_for_app get_default_cost_multiplier set_default_cost_multiplier
     get_pricing_model_source set_pricing_model_source is_proxy_running
     is_live_takeover_active switch_proxy_provider`,
    ["apps/control-center/src/ccswitch/proxy.mjs", "apps/control-center/src/providers.mjs"],
    ["/api/ccswitch/proxy/config", "/api/providers/switch", "/api/ccswitch/proxy/pricing"],
    ["CC-Switch > 代理", "配置中心 > Providers > 高级"],
    ["apps/control-center/tests/ccswitch-proxy.test.mjs", "apps/control-center/tests/providers.test.mjs"],
    "Per-app provider metadata and one proxy runtime replace separate upstream global/per-app config tables.",
  ),
  group(
    "circuit-breaker-and-failover",
    "equivalent",
    `get_provider_health reset_circuit_breaker get_circuit_breaker_config
     update_circuit_breaker_config get_circuit_breaker_stats get_failover_queue
     get_available_providers_for_failover add_to_failover_queue remove_from_failover_queue
     get_auto_failover_enabled set_auto_failover_enabled`,
    ["apps/control-center/src/ccswitch/proxy.mjs", "apps/control-center/src/providers.mjs"],
    ["/api/ccswitch/proxy/health", "/api/ccswitch/proxy/breaker/:app/:provider/reset", "/api/providers/failover/:app"],
    ["CC-Switch > 代理 > 熔断器", "配置中心 > Providers > Failover"],
    ["apps/control-center/tests/ccswitch-proxy.test.mjs", "apps/control-center/tests/provider-net.test.mjs"],
  ),
  group(
    "usage-statistics",
    "adapted",
    `get_usage_summary get_usage_summary_by_app get_usage_trends get_provider_stats
     get_model_stats get_request_logs get_request_detail get_model_pricing update_model_pricing
     delete_model_pricing check_provider_limits sync_session_usage rebuild_codex_usage
     get_usage_data_sources`,
    ["apps/control-center/src/ccswitch/proxy.mjs", "apps/control-center/src/sessions.mjs"],
    ["/api/ccswitch/proxy/usage/summary", "/api/ccswitch/proxy/usage/trends", "/api/ccswitch/proxy/usage/providers", "/api/ccswitch/proxy/usage/models", "/api/ccswitch/proxy/logs", "/api/ccswitch/proxy/pricing"],
    ["CC-Switch > 代理 > 指标 / 日志 / 定价", "会话"],
    ["apps/control-center/tests/ccswitch-proxy.test.mjs", "apps/control-center/tests/multicli-sessions.test.mjs"],
    "Proxy traffic is authoritative for live cost data; native CLI sessions remain separate read-only data sources instead of being rewritten into CC-Switch's SQLite schema.",
  ),
  group(
    "stream-health",
    "equivalent",
    `stream_check_provider stream_check_all_providers get_stream_check_config save_stream_check_config`,
    ["apps/control-center/src/ccswitch/domain.mjs", "apps/control-center/src/provider-net.mjs"],
    ["/api/ccswitch/domain/stream/check", "/api/ccswitch/domain/stream/config"],
    ["CC-Switch > 同步 > Stream Check"],
    ["apps/control-center/tests/ccswitch-domain.test.mjs", "apps/control-center/tests/provider-net.test.mjs"],
  ),
  group(
    "sessions-tools-and-terminal",
    "adapted",
    `list_sessions get_session_messages delete_session delete_sessions launch_session_terminal
     get_tool_versions run_tool_lifecycle_action probe_tool_installations open_provider_terminal`,
    ["apps/control-center/src/sessions.mjs", "apps/control-center/src/pty.mjs", "apps/control-center/src/health.mjs"],
    ["/api/sessions", "/api/sessions/preview", "/api/projects/delete-sessions", "/api/pty", "/api/health"],
    ["会话", "终端", "配置中心 > CLI 健康"],
    ["apps/control-center/tests/multicli-sessions.test.mjs", "apps/control-center/tests/pty.test.mjs", "apps/control-center/tests/health.test.mjs"],
    "514cc exposes provider terminals through the governed PTY surface and aggregates multiple CLI session formats rather than using CC-Switch's session schema.",
  ),
  group(
    "universal-providers",
    "equivalent",
    `get_universal_providers get_universal_provider upsert_universal_provider
     delete_universal_provider sync_universal_provider`,
    ["apps/control-center/src/providers.mjs"],
    ["/api/providers", "/api/providers/switch"],
    ["配置中心 > Providers"],
    ["apps/control-center/tests/providers.test.mjs"],
  ),
  group(
    "opencode-provider-compat",
    "equivalent",
    `import_opencode_providers_from_live get_opencode_live_provider_ids`,
    ["apps/control-center/src/providers.mjs"],
    ["/api/providers"],
    ["配置中心 > Providers > OpenCode"],
    ["apps/control-center/tests/providers.test.mjs"],
  ),
  group(
    "openclaw-config",
    "adapted",
    `import_openclaw_providers_from_live get_openclaw_live_provider_ids get_openclaw_live_provider
     scan_openclaw_config_health get_openclaw_default_model set_openclaw_default_model
     get_openclaw_model_catalog set_openclaw_model_catalog get_openclaw_agents_defaults
     set_openclaw_agents_defaults get_openclaw_env set_openclaw_env get_openclaw_tools
     set_openclaw_tools`,
    ["apps/control-center/src/providers.mjs", "apps/control-center/src/ccswitch/domain.mjs"],
    ["/api/providers", "/api/providers/common-config", "/api/ccswitch/domain/workspace"],
    ["配置中心 > Providers > OpenClaw", "CC-Switch > 资源 > Workspace"],
    ["apps/control-center/tests/providers.test.mjs", "apps/control-center/tests/ccswitch-domain.test.mjs"],
    "Provider switching owns models.providers; the compatibility workspace editor owns OpenClaw agents, env, tools, and memory files with whole-file backup before writes.",
  ),
  group(
    "hermes-config-memory-and-dashboard",
    "adapted",
    `import_hermes_providers_from_live get_hermes_live_provider_ids get_hermes_live_provider
     get_hermes_model_config open_hermes_web_ui launch_hermes_dashboard get_hermes_memory
     set_hermes_memory get_hermes_memory_limits set_hermes_memory_enabled`,
    ["apps/control-center/src/providers.mjs", "apps/control-center/src/ccswitch/domain.mjs", "apps/control-center/src/pty.mjs"],
    ["/api/providers", "/api/ccswitch/domain/workspace", "/api/pty"],
    ["配置中心 > Providers > Hermes", "CC-Switch > 资源 > Workspace", "终端"],
    ["apps/control-center/tests/providers.test.mjs", "apps/control-center/tests/ccswitch-domain.test.mjs", "apps/control-center/tests/pty.test.mjs"],
    "Hermes provider YAML and memory files are managed locally; dashboard launch uses the governed terminal surface and loopback URL checks.",
  ),
  group(
    "global-upstream-proxy",
    "adapted",
    `get_global_proxy_url set_global_proxy_url test_proxy_url get_upstream_proxy_status
     scan_local_proxies`,
    ["apps/control-center/src/ccswitch/proxy.mjs"],
    ["/api/ccswitch/proxy/upstream", "/api/ccswitch/proxy/upstream/test", "/api/ccswitch/proxy/upstream/scan"],
    ["CC-Switch > 代理 > 出站代理"],
    ["apps/control-center/tests/ccswitch-proxy.test.mjs"],
    "HTTP and HTTPS proxy URLs are applied to the process-wide fetch dispatcher. SOCKS candidates are detected but remain discovery-only because Node's trusted dispatcher does not support SOCKS; per-provider CLI proxy projection still supports socks5.",
  ),
  group(
    "managed-auth",
    "equivalent",
    `auth_start_login auth_poll_for_account auth_list_accounts auth_get_status
     auth_remove_account auth_set_default_account auth_logout`,
    ["apps/control-center/src/ccswitch/auth.mjs"],
    ["/api/ccswitch/auth/:provider/:action"],
    ["CC-Switch > 账户"],
    ["apps/control-center/tests/ccswitch-auth.test.mjs"],
  ),
  group(
    "copilot-auth",
    "equivalent",
    `copilot_start_device_flow copilot_poll_for_auth copilot_poll_for_account
     copilot_list_accounts copilot_remove_account copilot_set_default_account
     copilot_get_auth_status copilot_logout copilot_is_authenticated copilot_get_token
     copilot_get_token_for_account copilot_get_models copilot_get_models_for_account
     copilot_get_usage copilot_get_usage_for_account`,
    ["apps/control-center/src/ccswitch/auth.mjs"],
    ["/api/ccswitch/auth/github_copilot/:action"],
    ["CC-Switch > 账户 > GitHub Copilot"],
    ["apps/control-center/tests/ccswitch-auth.test.mjs"],
    "Token-returning upstream IPC calls are intentionally narrowed: tokens stay server-side and only authenticated resource results cross the HTTP API.",
  ),
  group(
    "omo-provider-compat",
    "adapted",
    `read_omo_local_file get_current_omo_provider_id disable_current_omo
     read_omo_slim_local_file get_current_omo_slim_provider_id disable_current_omo_slim`,
    ["apps/control-center/src/providers.mjs"],
    ["/api/providers", "/api/providers/switch"],
    ["配置中心 > Providers > OpenCode / OMO"],
    ["apps/control-center/tests/providers.test.mjs"],
    "OMO and OMO Slim are modeled as OpenCode provider categories; switching rewrites only the managed plugin entry and preserves unrelated plugins.",
  ),
  group(
    "openclaw-workspace-memory",
    "equivalent",
    `read_workspace_file write_workspace_file list_daily_memory_files read_daily_memory_file
     write_daily_memory_file delete_daily_memory_file search_daily_memory_files
     open_workspace_directory`,
    ["apps/control-center/src/ccswitch/domain.mjs"],
    ["/api/ccswitch/domain/workspace"],
    ["CC-Switch > 资源 > Workspace"],
    ["apps/control-center/tests/ccswitch-domain.test.mjs"],
    "Workspace filenames and daily-memory dates use fixed allowlists; writes are atomic and deletion requires explicit confirmation.",
  ),
]);

export const CCSWITCH_ALLOWED_STATUSES = Object.freeze(new Set([
  "equivalent",
  "adapted",
  "blocked_external_trust",
]));

export function ccSwitchCapabilityEntries() {
  return CCSWITCH_CAPABILITY_GROUPS.flatMap((item) => item.commands.map((command) => ({
    command,
    group: item.id,
    status: item.status,
    implementation: item.implementation,
    api: item.api,
    ui: item.ui,
    tests: item.tests,
    boundary: item.boundary,
  })));
}
