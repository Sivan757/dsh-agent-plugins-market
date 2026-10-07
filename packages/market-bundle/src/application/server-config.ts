/**
 * Compatibility barrel for the service-configuration helpers that used to live
 * here. Each declaration now belongs to the domain that owns it: MCP validation
 * and redaction-restore to market-mcp, LSP validation and the override layer to
 * market-lsp. The re-exports stay so existing importers and tests keep their
 * current specifier; new code imports the owning module directly.
 */
export { McpConfigError, restoreRedactedConfig, validateServerMcp, type McpFieldError } from '../../../market-mcp/src/index.js'
export { applyLspOverrides, loadLspOverrides, lspConfig, saveLspOverride, validateServerLsp } from '../../../market-lsp/src/index.js'
