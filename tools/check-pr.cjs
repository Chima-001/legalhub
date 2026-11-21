// Local deterministic release + previously shipped auth/admin regressions, not private remote CI.
'use strict';
const { spawnSync } = require('node:child_process'),
  path = require('node:path'),
  fs = require('node:fs');
const root = path.resolve(__dirname, '..');
const groups = [
  ['Student, materials, calendar and public PWA', ['tests/pwa/check-release.cjs']],
  ['Sign-in, recovery and signup forms', ['tests/auth/frontend-smoke.cjs', root]],
  ['Confirmation links, callback sessions and account routing', ['tests/auth/confirmation-smoke.cjs', root]],
  ['Signup database and maintenance grants', ['tests/auth/database-smoke.mjs']],
  ['Admin Back and catalogue UI', ['--test', 'tests/admin/back.test.mjs', 'tests/admin/catalog.test.mjs']],
  ['Owner and delegated authority', ['tests/admin/authority-smoke.mjs']],
  ['Curricula, course links and archive/delete', ['tests/admin/curricula-smoke.mjs']],
  ['Owner-private admin email list', ['tests/admin/owner-emails-smoke.mjs']],
];
const missing = groups.flatMap(([, args]) =>
  args.filter((s) => s.startsWith('tests/') && !fs.existsSync(path.join(root, s))),
);
if (missing.length) {
  console.error(
    'STOP: expected earlier branch tests are missing: ' +
      missing.join(', ') +
      '. Run this on the full checkout; do not call a partial result a PR pass.',
  );
  process.exit(2);
}
for (const [label, args] of groups) {
  console.log('\nChecking: ' + label);
  const r = spawnSync(process.execPath, args, { cwd: root, stdio: 'inherit' });
  if (r.error || r.status !== 0) {
    console.error('STOP: ' + label + ' did not pass' + (r.error ? ': ' + r.error.message : '.'));
    process.exit(r.status || 1);
  }
}
console.log(
  'COORDINATED LOCAL CHECKS PASSED. No private remote CI, hosting publish, live file operation or email dispatch was performed.',
);
