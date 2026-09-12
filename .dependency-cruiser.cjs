module.exports = {
  forbidden: [
    {
      name: 'client-cannot-import-host',
      severity: 'error',
      from: { path: '^src/client' },
      to: { path: '^src/(application|catalog|context|routes|runtime)(/|\\.)' }
    },
    {
      name: 'client-cannot-import-node',
      severity: 'error',
      from: { path: '^src/client' },
      to: { path: '^node:' }
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
      to: { path: '^(node:|src/(?!contracts(/|\\.)))' }
    },
    {
      name: 'model-cannot-import-server-layers',
      severity: 'error',
      from: { path: '^src/model' },
      to: { path: '^src/(application|client|index|routes|runtime)(/|\\.)' }
    },
    {
      name: 'model-cannot-import-node-effects',
      severity: 'error',
      // `state.ts` is the persisted-state codec: reading and writing
      // `<root>/state.json` is its job. Every other model module is domain
      // data and stays free of filesystem and process access.
      from: { path: '^src/model', pathNot: '^src/model/state\\.ts$' },
      to: { path: '^node:' }
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
