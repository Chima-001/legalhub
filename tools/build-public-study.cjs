// Deterministic release asset. Nothing is discovered recursively or fetched at build/install time.
// Only these six PUBLIC assets can enter the offline pack. Never add a protected page, SDK or PDF here.
'use strict';
const path = require('node:path'),
  fs = require('node:fs'),
  { createHash } = require('node:crypto');
const root = path.resolve(__dirname, '../public'),
  list = [
    ['study/index.html', 'text/html; charset=utf-8'],
    ['pwa/study.css', 'text/css; charset=utf-8'],
    ['pwa/register.js', 'application/javascript; charset=utf-8'],
    ['manifest.webmanifest', 'application/manifest+json'],
    ['pwa/lh-192.png', 'image/png'],
    ['pwa/lh-512.png', 'image/png'],
  ];
const entries = list.map(([key, type]) => {
  let b = fs.readFileSync(path.join(root, key));
  const binary = type === 'image/png';
  if (!binary) b = Buffer.from(b.toString('utf8').replace(/\r\n/g, '\n'));
  return { key, type, binary, body: b.toString(binary ? 'base64' : 'utf8') };
});
const data = JSON.stringify(entries),
  revision = createHash('sha256').update(data).digest('hex').slice(0, 20);
const out =
  '// Generated from the six public reading assets only. Run node tools/build-public-study.cjs after editing them.\nself.LH_PUBLIC_STUDY = ' +
  JSON.stringify({ revision, entries }) +
  ';\n';
const dest = path.join(root, 'pwa/public-pack.js');
if (process.argv[2] === '--check') {
  if (fs.readFileSync(dest, 'utf8').replace(/\r\n/g, '\n') !== out) {
    console.error('Public pack differs from source; regenerate and review it.');
    process.exitCode = 1;
  } else console.log(`Public study pack ${revision}: six public assets match.`);
} else if (process.argv.length === 2) {
  fs.writeFileSync(dest, out);
  console.log(`Built public study pack ${revision}.`);
} else {
  console.error('Use no flag to build, or --check to verify.');
  process.exitCode = 1;
}
