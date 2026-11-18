// Offline source-coverage checks. No SDK, browser account, or external packages needed.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { Script } = require('node:vm');

const web = path.resolve(__dirname, '..', 'public');
const js = path.join(web, 'scripts', 'password-visibility.js');
const css = path.join(web, 'styles', 'password-visibility.css');
function* htmlIn(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* htmlIn(file);
    else if (entry.isFile() && /\.html?$/i.test(entry.name)) yield file;
  }
}
function attr(tag, key) {
  const m = new RegExp(`\\s${key}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(tag);
  return m ? m[1] ?? m[2] ?? m[3] : '';
}
function refersTo(file, url, asset) {
  if (!url || /^(?:[a-z]+:|\/\/)/i.test(url)) return false;
  const pathname = url.split(/[?#]/)[0];
  const target = pathname.startsWith('/') ? path.resolve(web, '.' + pathname) : path.resolve(path.dirname(file), pathname);
  return target === asset;
}

test('shared visibility assets exist and the script parses', () => {
  new Script(fs.readFileSync(js, 'utf8'), { filename: js });
  assert(fs.statSync(css).isFile());
});

test('all published HTML password fields start masked and load the local eye control once', t => {
  const found = new Map();
  for (const file of htmlIn(web)) {
    const html = fs.readFileSync(file, 'utf8').replace(/<!--[\s\S]*?-->/g, '');
    const markup = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
    const inputs = markup.match(/<input\b[^>]*>/gi) || [];
    for (const input of inputs) {
      if (/\b(?:current-password|new-password)\b/i.test(attr(input, 'autocomplete'))) {
        assert.equal(attr(input, 'type').toLowerCase(), 'password', `Unmasked password field in ${file}`);
      }
    }
    const passwords = inputs.filter(input => attr(input, 'type').toLowerCase() === 'password');
    if (!passwords.length) continue;
    const scripts = (html.match(/<script\b[^>]*>/gi) || []).filter(tag => refersTo(file, attr(tag, 'src'), js));
    const styles = (markup.match(/<link\b[^>]*>/gi) || []).filter(tag => /\bstylesheet\b/i.test(attr(tag, 'rel')) && refersTo(file, attr(tag, 'href'), css));
    assert.equal(scripts.length, 1, `Expected one visibility script in ${file}`);
    assert.equal(styles.length, 1, `Expected one visibility stylesheet in ${file}`);
    found.set(path.relative(web, file).split(path.sep).join('/'), passwords.map(input => attr(input, 'id')));
  }
  const expected = {
    'pages/login.html': ['password'],
    'pages/signup.html': ['password', 'confirm_password'],
    'pages/update-password.html': ['password', 'confirm_password'],
    'pages/profile.html': ['current-password-input', 'new-password-input'],
    'pages/method_ratio.html': ['adminPasswordInput', 'oldAdminPass', 'newAdminPass', 'confirmAdminPass'],
  };
  for (const [file, ids] of Object.entries(expected)) {
    for (const id of ids) assert(found.get(file)?.includes(id), `Expected masked input #${id} in ${file}`);
  }
  t.diagnostic(`${[...found.values()].reduce((n, ids) => n + ids.length, 0)} password fields on ${found.size} pages.`);
});
