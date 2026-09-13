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
    }
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    exclude: '(^|/)node_modules/',
    includeOnly: '^src',
    tsPreCompilationDeps: true
  }
}
