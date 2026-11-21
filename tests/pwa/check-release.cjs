// No deployment or production client. Run from any directory after installing the existing fixture package.
'use strict';
const { spawnSync } = require('node:child_process'),
  path = require('node:path'),
  fs = require('node:fs');
const root = path.resolve(__dirname, '../..');
if (!fs.existsSync(path.join(root, 'tests/auth/node_modules/@electric-sql/pglite/dist/index.js'))) {
  console.error(
    'Install the existing fixture dependency first: npm ci --prefix tests/auth --ignore-scripts --no-audit --no-fund',
  );
  process.exit(2);
}
for (const args of [
  ['tools/build-public-study.cjs', '--check'],
  [
    '--test',
    'tests/pwa/public-worker.test.cjs',
    'tests/pwa/install-invite.test.cjs',
    'tests/academic/student-level-ui.test.cjs',
    'tests/academic/frontend.test.cjs',
  ],
  ['tests/academic/profile-rollout-smoke.mjs'],
  ['tests/academic/database-smoke.mjs'],
  ['tests/materials/check-release.cjs'],
]) {
  const r = spawnSync(process.execPath, args, { cwd: root, stdio: 'inherit' });
  if (r.error || r.status !== 0) {
    if (r.error) console.error(r.error.message);
    process.exit(r.status || 1);
  }
}
console.log('STUDY RELEASE CHECKS PASSED (local fixtures only; not a deployment or proof of live email).');
