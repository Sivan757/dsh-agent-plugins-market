// Layering boundaries for the shipped source.
//
// Node builtin edges are invisible to dependency-cruiser: a `node:*` dependency appears in the
// graph only as a bare `resolved` value, so a `to: { path: '^node:' }` rule can never fire. The
// "domain data and the client bundle stay free of Node APIs" boundaries are therefore enforced by
// `no-restricted-imports` in `eslint.config.mjs`.
module.exports = {
  forbidden: [
    {
      name: 'client-cannot-import-host',
      severity: 'error',
      from: { path: '^src/client' },
      to: { path: '^src/(application|catalog|context|routes|runtime)(/|\\.)' }
    },
    {
      name: 'catalog-cannot-import-host-or-client',
      severity: 'error',
      from: { path: '^src/catalog' },
      to: { path: '^src/(application|client|context|index|routes|runtime)(/|\\.)' }
    },
    {
      name: 'runtime-cannot-import-client-or-routes',
      severity: 'error',
      from: { path: '^src/runtime' },
      to: { path: '^src/(client|routes)(/|\\.)' }
    },
    {
      name: 'contracts-import-nothing',
      severity: 'error',
      from: { path: '^src/contracts' },
      to: { path: '^src/(?!contracts(/|\\.))' }
    },
    {
      name: 'model-cannot-import-server-layers',
      severity: 'error',
      from: { path: '^src/model' },
      to: { path: '^src/(application|client|index|routes|runtime)(/|\\.)' }
    },
    {
      name: 'application-cannot-import-client-routes-or-index',
      severity: 'error',
      from: { path: '^src/application' },
      to: { path: '^src/(client|index|routes)(/|\\.)' }
    },
    {
      // The design plan draws application -> model/catalog/contracts with runtime
      // effects driven through ports. Every cross-edge this rule used to warn
      // about was resolved by the Stage C2 relocation; violations are errors now.
      name: 'application-cannot-import-runtime',
      severity: 'error',
      from: { path: '^src/application' },
      to: { path: '^src/runtime(/|\\.)' }
    },
    {
      // Feature folders are peers, not layers: code in one feature may not import a
      // sibling feature's modules. A \1 backreference would not work here — inside
      // to.path it refers to the to-regex's own (empty) groups and would flag
      // self-folder imports too. dependency-cruiser's equivalent is the $1 group
      // placeholder, substituted from the from.path capture. The trailing lookahead
      // keeps cross-feature .css imports legal; the panels share one design vocabulary.
      name: 'client-feature-cannot-import-sibling-feature',
      severity: 'error',
      from: { path: '^src/client/features/([^/]+)' },
      to: { path: '^src/client/features/(?!$1(?:/|\\.))(?![^']*\\.css)' }
    },
    {
      // Shared controls stay generic: ui/ may not reach into a feature or the
      // workspace shell; the dependency direction is features -> ui only.
      name: 'client-ui-cannot-import-features',
      severity: 'error',
      from: { path: '^src/client/ui' },
      to: { path: '^src/client/(features|workspace)' }
    }
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    exclude: '(^|/)node_modules/',
    includeOnly: '^src',
    tsPreCompilationDeps: true
  }
}
