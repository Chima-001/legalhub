// Local-only nav regression checks. No keys, accounts, database or package installation.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'),
  path = require('node:path'),
  vm = require('node:vm');
const pub = path.resolve(__dirname, '../../public');
const mod = import('../../public/scripts/academic/desk-nav.mjs');
const scope = { window: {} };
vm.runInNewContext(fs.readFileSync(path.join(pub, 'scripts/academic/term.js'), 'utf8'), scope);
const valid = scope.window.LegalHubTerm.validCalendar;
const ok = (admin) => ({ data: { today: '2026-11-18', term: null, can_manage: admin }, error: null });
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
function deferred() {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
async function setup(read) {
  const { createAdminLinkGate } = await mod;
  const state = { shown: false, visible: true, reads: 0 };
  const gate = createAdminLinkGate({
    read: () => {
      state.reads++;
      return read();
    },
    valid,
    visible: () => state.visible,
    show: (v) => {
      state.shown = v;
    },
  });
  return { state, gate };
}
test('One initially hidden, mount-safe Admin settings link alongside the original primary links', () => {
  const html = fs.readFileSync(path.join(pub, 'pages/semester.html'), 'utf8');
  const nav = html.match(/<nav\b[^>]*aria-label="Main navigation"[^>]*>([\s\S]*?)<\/nav>/)?.[1];
  assert(nav);
  assert.deepEqual(
    [...nav.matchAll(/<a\b[^>]*href="([^"]+)"/g)].map((m) => m[1]),
    [
      '../index.html',
      './semester.html',
      './pdf.html',
      './about.html',
      './admin-settings.html',
      './profile.html',
    ],
  );
  const tag = nav.match(/<a\b[^>]*id="desk-admin-link"[^>]*>/g);
  assert.equal(tag?.length, 1);
  assert.match(tag[0], /\shidden[\s>]/);
  for (const mount of ['/', '/public/', '/class/legalhub/public/']) {
    const from = 'https://example.invalid' + mount + 'pages/semester.html?level=200L&semester=first';
    assert.equal(
      new URL(tag[0].match(/href="([^"]+)"/)[1], from).pathname,
      mount + 'pages/admin-settings.html',
    );
  }
  assert(fs.existsSync(path.join(pub, 'pages/admin-settings.html')));
});
test('No identity: no read. Confirmed admin: link shown even before dates are published', async () => {
  const { state, gate } = await setup(() => ok(true));
  gate.refresh();
  await tick();
  assert.equal(state.reads, 0);
  assert.equal(state.shown, false);
  gate.session('a');
  assert.equal(state.reads, 0, 'SDK work is deferred outside the auth callback');
  await tick();
  assert.equal(state.reads, 1);
  assert.equal(state.shown, true);
});
test('Member, malformed flag/schedule, RPC error and rejected read all fail closed', async () => {
  for (const read of [
    () => ok(false),
    () => ok('true'),
    () => ({ data: { can_manage: true } }),
    () => ({ ...ok(true), error: { code: 'unavailable' } }),
    () => Promise.reject(Error('offline')),
  ]) {
    const { state, gate } = await setup(read);
    gate.session('member');
    await tick();
    assert.equal(state.reads, 1);
    assert.equal(state.shown, false);
  }
});
test('Late positive results cannot reveal the link after sign-out or an account change', async () => {
  for (const replacement of [null, 'reader-b']) {
    const held = deferred();
    let initial = true;
    const { state, gate } = await setup(() => {
      if (initial) {
        initial = false;
        return held.promise;
      }
      return ok(false);
    });
    gate.session('reader-a');
    await tick();
    gate.session(replacement);
    held.resolve(ok(true));
    await tick();
    assert.equal(state.shown, false);
    assert.equal(state.reads, replacement ? 2 : 1);
  }
});
test('Backgrounding invalidates the outstanding read; returning rechecks the role, including revocation', async () => {
  const hold = deferred();
  let answer = hold.promise;
  const { state, gate } = await setup(() => answer);
  gate.session('a');
  await tick();
  state.visible = false;
  gate.refresh();
  hold.resolve(ok(true));
  await tick();
  assert.equal(state.shown, false);
  assert.equal(state.reads, 1);
  answer = ok(true);
  state.visible = true;
  gate.refresh();
  await tick();
  assert.equal(state.shown, true);
  answer = ok(false);
  gate.refresh();
  await tick();
  assert.equal(state.shown, false);
});
test('Rapid session notifications coalesce; an unread or cancelled request does not reveal navigation', async () => {
  const { state, gate } = await setup(() => ok(true));
  gate.session('a');
  gate.session('a');
  gate.refresh();
  await tick();
  assert.equal(state.reads, 1);
  gate.refresh();
  gate.session(null);
  await tick();
  assert.equal(state.reads, 1);
  assert.equal(state.shown, false);
});
test('Foreground polling keeps an affirmed link steady, avoids overlapping reads, and hides on revocation or error', async () => {
  const hold = deferred();
  let answer = ok(true);
  const { state, gate } = await setup(() => answer);
  gate.session('a');
  await tick();
  assert.equal(state.shown, true);
  answer = hold.promise;
  gate.poll();
  gate.poll();
  await tick();
  gate.poll();
  assert.equal(state.reads, 2);
  assert.equal(state.shown, true);
  hold.resolve(ok(false));
  await tick();
  assert.equal(state.shown, false);
  answer = ok(true);
  gate.poll();
  await tick();
  assert.equal(state.shown, true);
  answer = { ...ok(true), error: { code: 'read failed' } };
  gate.poll();
  await tick();
  assert.equal(state.shown, false);
  state.visible = false;
  gate.poll();
  await tick();
  assert.equal(state.reads, 4);
});
