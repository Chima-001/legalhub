// Fixed, offline suite list. Dependency installation is separate; no project client, mail, Git or deployment.
'use strict';
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const root = path.resolve(__dirname, '../..');
if (!fs.existsSync(path.join(root, 'tests/auth/node_modules/@electric-sql/pglite/dist/index.js'))) {
  console.error(
    'Install the pinned fixture dependency first: npm ci --prefix tests/auth --ignore-scripts --no-audit --no-fund',
  );
  process.exit(2);
}
for (const args of [
  [
    '--test',
    'tests/materials/upload-feedback.test.cjs',
    'tests/semester/library-filters.test.cjs',
    'tests/materials/removal.test.mjs',
  ],
  ['tests/materials/review-smoke.mjs'],
  ['tests/materials/alert-smoke.mjs'],
]) {
  const r = spawnSync(process.execPath, args, { cwd: root, stdio: 'inherit' });
  if (r.error) {
    console.error(r.error.message);
    process.exit(1);
  }
  if (r.status !== 0) process.exit(r.status || 1);
}
console.log('MATERIAL RELEASE CHECKS PASSED (synthetic only; not deployment or inbox delivery).');
