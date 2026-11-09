// The plugin's old name (design-first-spec): DFS_* settings, the old home folder, and the dfs.mjs shim
// still work. Also: screenshots skip cleanly when playwright-core can't be found.
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import { env, homeNote, resolveHome } from '../lib/project.mjs';
import { makeProject, run, sandbox } from './helpers.mjs';

const fakeHome = () => mkdtempSync(join(tmpdir(), 'ddd-home-'));

describe('the old name', () => {
  test('DDD_* settings win, DFS_* are read when they are missing', () => {
    assert.equal(env('HOME', { DDD_HOME: '/a', DFS_HOME: '/b' }), '/a');
    assert.equal(env('HOME', { DFS_HOME: '/b' }), '/b');
    assert.equal(env('HOME', {}), undefined);
  });

  test('home: DDD_HOME, then DFS_HOME, then ~/.design-driven-development', () => {
    const home = fakeHome();
    assert.deepEqual(resolveHome({ vars: { DDD_HOME: '/x/y' }, home }), { dir: '/x/y', legacy: false });
    assert.deepEqual(resolveHome({ vars: { DFS_HOME: '/x/z' }, home }), { dir: '/x/z', legacy: false });
    assert.deepEqual(resolveHome({ vars: {}, home }), { dir: join(home, '.design-driven-development'), legacy: false });
    assert.equal(homeNote({ vars: {}, home }), null);
  });

  test('the old home is used while the new one does not exist, with a note shown once', () => {
    const home = fakeHome();
    mkdirSync(join(home, '.design-first-spec'));
    assert.deepEqual(resolveHome({ vars: {}, home }), { dir: join(home, '.design-first-spec'), legacy: true });
    const note = homeNote({ vars: {}, home });
    assert.match(note, /mv ~\/\.design-first-spec ~\/\.design-driven-development/);
    assert.equal(homeNote({ vars: {}, home }), null, 'only once');
    mkdirSync(join(home, '.design-driven-development'));
    assert.deepEqual(resolveHome({ vars: {}, home }), { dir: join(home, '.design-driven-development'), legacy: false });
  });

  test('dfs.mjs still runs the CLI', async () => {
    const sb = sandbox();
    const r = await run('dfs.mjs', ['init', 'Old name', '--repo', sb.repo], { env: sb.env });
    assert.equal(r.code, 0, r.stderr);
    assert.ok(existsSync(join(r.stdout.trim(), 'project.json')));
  });
});

test('shoot.mjs skips with install instructions when playwright-core is missing', async () => {
  const sb = sandbox();
  const dir = makeProject(sb.repo);
  // An empty folder as DDD_PLAYWRIGHT and NODE_PATH cleared: only a playwright-core in the plugin's own
  // node_modules could still be found, and then the shot may succeed, so accept either outcome.
  const r = await run('shoot.mjs', [dir, '--out', join(sb.base, 'shots')], { env: { ...sb.env, DDD_PLAYWRIGHT: join(sb.base, 'none') } });
  assert.equal(r.code, 0, r.stderr);
  if (/skipped/.test(r.stdout)) assert.match(r.stdout, /PNG screenshots skipped: .*npm install --prefix .* install --only-shell chromium/);
  else assert.match(r.stdout, /screenshot\(s\) in/);
});
