/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'domain-stays-pure',
      severity: 'error',
      from: { path: '^packages/domain' },
      to: { path: '^(packages/(db|clients|runtime|application|config)|apps)' },
    },
    {
      name: 'shared-stays-low',
      severity: 'error',
      from: { path: '^packages/shared' },
      to: { path: '^(packages/(?!shared(/|$))|apps)' },
    },
    {
      name: 'contracts-is-thin',
      severity: 'error',
      from: { path: '^packages/contracts' },
      to: { path: '^(packages/(db|clients|runtime|application)|apps)' },
    },
    {
      name: 'db-src-stays-low',
      severity: 'error',
      from: { path: '^packages/db/src' },
      to: { path: '^(packages/(application|runtime|clients|config)|apps)' },
    },
    {
      name: 'clients-do-not-own-persistence',
      severity: 'error',
      from: { path: '^packages/clients' },
      to: { path: '^(packages/(db|runtime|config)|apps)' },
    },
    {
      name: 'application-does-not-import-adapters',
      severity: 'error',
      from: { path: '^packages/application' },
      to: { path: '^(packages/(clients|runtime)|apps)' },
    },
    {
      name: 'no-app-imports-from-packages',
      severity: 'error',
      from: { path: '^packages/' },
      to: { path: '^apps/' },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    tsPreCompilationDeps: true,
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default'],
    },
  },
}
