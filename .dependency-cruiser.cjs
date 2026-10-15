/**
 * Layer rules from docs/LOW_LEVEL_DESIGN.md §1.
 * The build fails if any of these are broken.
 */
module.exports = {
  forbidden: [
    {
      name: 'core-is-pure',
      comment: 'packages/core may only depend on packages/schema — no apps, no npm runtime deps.',
      severity: 'error',
      // Tests (and their helper) may also read sample maps.
      from: { path: '^packages/core', pathNot: '(\\.test\\.ts|/test-support\\.ts)$' },
      to: { pathNot: ['^packages/(core|schema)'] },
    },
    {
      name: 'schema-is-leaf',
      comment: 'packages/schema must not depend on core or apps.',
      severity: 'error',
      from: { path: '^packages/schema' },
      to: { path: ['^packages/core', '^apps/'] },
    },
    {
      name: 'packages-never-import-apps',
      severity: 'error',
      from: { path: '^packages/' },
      to: { path: '^apps/' },
    },
    {
      name: 'apps-never-import-each-other',
      severity: 'error',
      from: { path: '^apps/([^/]+)/' },
      to: { path: '^apps/', pathNot: '^apps/$1/' },
    },
    {
      name: 'no-circular',
      severity: 'error',
      from: {},
      to: { circular: true },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    exclude: { path: '(dist|coverage)/' },
    tsPreCompilationDeps: true,
    combinedDependencies: true,
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default', 'types'],
    },
  },
};
