// The old, unused 007 + 011 release is retired. Check publication only; never prepare live SQL.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const req = createRequire(import.meta.url),
  { inspectSite } = req('../../tools/prepare-reviewed-release.cjs');
const cmd = fileURLToPath(new URL('../../tools/prepare-reviewed-release.cjs', import.meta.url));
const refused = spawnSync(process.execPath, [cmd, '--prepare', 'retired.sql'], { encoding: 'utf8' });
assert.notEqual(refused.status, 0);
assert.match(refused.stderr, /SQL preparation is retired/);
const host = 'https://fixture.invalid/';
const mismatch = await inspectSite(host, async () => new Response('old'));
assert(mismatch.includes('pages/materials.html'));
const good = await inspectSite(host, async (u) => {
  const p = new URL(u).pathname;
  const type = p.endsWith('.html') ? 'text/html' : p.endsWith('.css') ? 'text/css' : 'text/javascript';
  return new Response(await readFile(new URL('../../public' + p, import.meta.url)), {
    headers: { 'content-type': type },
  });
});
assert.deepEqual(good, []);
console.log('PASS publication status only; obsolete restrictive SQL preparation refused.');
