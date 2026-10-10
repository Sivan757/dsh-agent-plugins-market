// Domain ownership and technical layers for private source workspaces.
const root = 'packages/'
module.exports = {
  forbidden: [
    { name: 'browser-does-not-load-host-augmentations', severity: 'error', from: { path: '^packages/market-ui/' }, to: { path: '^packages/market-contracts/src/host/' } },
    { name: 'no-circular-dependencies', severity: 'error', from: {}, to: { circular: true } },
    {
      name: 'cross-domain-imports-use-public-entries',
      severity: 'error',
      from: { path: '^packages/(market-[^/]+)/src/' },
      to: { path: '^packages/(?!$1/|market-contracts/)[^/]+/src/(?!index[.]ts$)' }
    },
    { name: 'contracts-stay-stateless', severity: 'error', from: { path: '^packages/market-contracts/' }, to: { path: '^packages/(?!market-contracts/)' } },
    { name: 'catalog-has-no-product-runtime', severity: 'error', from: { path: '^packages/market-catalog/' }, to: { path: '^packages/(?!market-catalog/|market-contracts/)' } },
    {
      name: 'runtime-does-not-import-concrete-adapters',
      severity: 'error',
      from: { path: '^packages/market-runtime/' },
      to: { path: '^packages/(?!market-runtime/|market-catalog/|market-contracts/)' }
    },
    {
      name: 'connectors-do-not-import-composition-or-each-other',
      severity: 'error',
      from: { path: '^packages/(market-mcp|market-lsp)/' },
      to: { path: '^packages/(?!$1/|market-runtime/|market-catalog/|market-contracts/)' }
    },
    {
      name: 'translation-independent-of-product',
      severity: 'error',
      from: { path: '^packages/market-translation/' },
      to: { path: '^packages/(?!market-translation/|market-catalog/|market-contracts/)' }
    },
    { name: 'browser-imports-portable-contracts-only', severity: 'error', from: { path: '^packages/market-ui/' }, to: { path: '^packages/(?!market-ui/|market-contracts/)' } },
    {
      name: 'scanning-does-not-import-use-cases',
      severity: 'error',
      from: { path: '^packages/market-catalog/src/scanning/' },
      to: { path: '^packages/market-catalog/src/application/' }
    },
    {
      name: 'application-does-not-import-host-effects',
      severity: 'error',
      from: { path: '^packages/(?!market-bundle/)[^/]+/src/application/' },
      to: { path: '^packages/[^/]+/src/runtime/' }
    },
    {
      name: 'client-feature-cannot-import-sibling-feature',
      severity: 'error',
      from: { path: '^packages/market-ui/src/features/([^/]+)' },
      to: { path: '^packages/market-ui/src/features/(?!$1(?:/|[.]))(?!.*[.]css$)' }
    },
    { name: 'client-ui-cannot-import-features', severity: 'error', from: { path: '^packages/market-ui/src/ui/' }, to: { path: '^packages/market-ui/src/(features|workspace)/' } },
    { name: 'client-entry-is-not-a-type-module', severity: 'error', from: { path: '^packages/market-ui/src/(?!index[.]ts)' }, to: { path: '^packages/market-ui/src/index[.]ts$' } }
  ],
  options: { doNotFollow: { path: 'node_modules' }, exclude: '(^|/)node_modules/', includeOnly: '^(index[.]ts$|' + root + ')', tsPreCompilationDeps: true }
}
