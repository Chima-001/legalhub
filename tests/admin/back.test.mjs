import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { safeSource, mountReturn } from '../../public/scripts/academic/admin-return.mjs';
const host = 'https://local.example',
  here = host + '/public/pages/admin-settings.html',
  desk = host + '/public/pages/semester.html?level=300L&semester=second#courses',
  home = host + '/public/index.html#levels';
function setup(ref = '', prev = '', loc = here) {
  let click,
    back = 0;
  const link = {
    'aria-disabled': 'true',
    setAttribute(k, v) {
      this[k] = v;
    },
    removeAttribute(k) {
      delete this[k];
    },
    addEventListener(_, cb) {
      click = cb;
    },
  };
  const nav = { currentEntry: { index: prev ? 1 : 0 }, entries: () => [{ index: 0, url: prev }] };
  mountReturn(link, {
    location: { href: loc },
    document: { referrer: ref },
    navigation: nav,
    history: {
      back() {
        back++;
      },
    },
  });
  return {
    link,
    nav,
    get back() {
      return back;
    },
    click(opts = {}) {
      let cancelled = false;
      click?.({
        button: 0,
        preventDefault() {
          cancelled = true;
        },
        ...opts,
      });
      return cancelled;
    },
  };
}
test('Back retains the previous semester selection and fragment; native traversal only for the same entry', () => {
  const x = setup(desk.split('#')[0], desk);
  assert.equal(x.link.href, desk);
  assert.equal(x.link['aria-disabled'], undefined);
  assert.equal(x.click({ ctrlKey: true }), false);
  assert.equal(x.click(), true);
  assert.equal(x.back, 1);
  x.nav.currentEntry.index = 0;
  assert.equal(x.click(), false);
  assert.equal(x.back, 1);
});
test('Root and subfolder Home/desk/other page returns; new tab uses its real referrer', () => {
  for (const path of [home, desk, host + '/public/pages/pdf.html?level=200L']) {
    const x = setup(path);
    assert.equal(x.link.href, path);
    assert.equal(x.click(), false);
  }
  assert.equal(
    safeSource(host + '/pages/semester?level=200L&semester=first', host + '/pages/admin-settings/'),
    host + '/pages/semester?level=200L&semester=first',
  );
});
test('A real referring page wins over an unrelated older history entry', () => {
  const x = setup(desk.split('#')[0], home);
  assert.equal(x.link.href, desk.split('#')[0]);
  assert.equal(x.click(), false);
  assert.equal(x.back, 0);
});
test('Direct, cross-site, wrong-mount, self and credential-bearing sources do not create a second Home or a return link', () => {
  for (const s of [
    '',
    here + '?q=1',
    'https://other.example/public/index.html',
    'javascript:alert(0)',
    host + '/publicity/index.html',
    host + '/public/pages/login.html',
    host + '/public/pages/profile.html#access_token=private',
    host + '/public/index.html?code=private',
    'https://name@local.example/public/index.html',
  ])
    assert.equal(setup(s).link['aria-disabled'], 'true');
  assert.equal(setup('https://outside.example/', home).link['aria-disabled'], 'true');
  assert.equal(setup('', '', here + '?returnTo=' + encodeURIComponent(desk)).link.href, undefined);
});
test('Brand stays Home; Back starts disabled with no hard-coded Home destination', async () => {
  const html = await readFile(
    new URL('../../public/pages/admin-settings.html', import.meta.url),
    'utf8',
  );
  assert.match(html, /<a class="brand" href="\.\.\/index\.html"/);
  assert.match(
    html,
    /<a id="admin-back" class="back" role="link" aria-disabled="true"[^>]*>← Back<\/a>/,
  );
  assert(!html.includes('← Common room'));
});
