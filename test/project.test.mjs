// Projects on disk: ddd.mjs init/path/list, and board edits (pure ops and board.mjs on the file).
import assert from 'node:assert/strict';
import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';
import { before, describe, test } from 'node:test';
import { applyBoardOp, isId, loadBoard, slugify } from '../lib/project.mjs';
import { makeProject, run, sandbox } from './helpers.mjs';

describe('ddd.mjs init, path, list', () => {
  let sb;
  before(() => (sb = sandbox()));

  test('init creates the project folder and prints its path', async () => {
    const r = await run('ddd.mjs', ['init', 'Threads for broad Questions', '--repo', sb.repo, '--goal', 'One line goal'], { env: sb.env });
    assert.equal(r.code, 0, r.stderr);
    const dir = r.stdout.trim();
    assert.equal(dir, join(sb.home, 'projects', 'product-app', 'threads-for-broad-questions'));
    const project = JSON.parse(readFileSync(join(dir, 'project.json'), 'utf8'));
    assert.equal(project.slug, 'threads-for-broad-questions');
    assert.equal(project.name, 'Threads for broad Questions');
    assert.equal(project.goal, 'One line goal');
    assert.equal(realpathSync(project.repo), realpathSync(sb.repo));
    assert.equal(project.device, 'phone');
    assert.ok(project.createdAt && project.updatedAt);
    assert.deepEqual(JSON.parse(readFileSync(join(dir, 'board.json'), 'utf8')), { flows: [] });
    assert.deepEqual(JSON.parse(readFileSync(join(dir, 'notes.json'), 'utf8')), { general: '', app: { note: '' }, screens: {}, asks: [] });
    assert.match(readFileSync(join(dir, 'theme.css'), 'utf8'), /overrides? the kit[\s\S]*:root \{/);
    assert.ok(statSync(join(dir, 'mocks')).isDirectory());
  });

  test('init from a subfolder uses the git root, and again returns the same project', async () => {
    const r = await run('ddd.mjs', ['init', 'Threads for broad Questions'], { env: sb.env, cwd: sb.repo });
    assert.equal(r.code, 0);
    assert.equal(basename(join(r.stdout.trim(), '..')), 'product-app');
    assert.match(r.stderr, /already exists/);
  });

  test('path and list find it by slug from the repo', async () => {
    const p = await run('ddd.mjs', ['path', 'threads-for-broad-questions'], { env: sb.env, cwd: sb.repo });
    assert.equal(p.code, 0, p.stderr);
    assert.ok(existsSync(join(p.stdout.trim(), 'project.json')));
    const l = await run('ddd.mjs', ['list'], { env: sb.env, cwd: sb.repo });
    assert.match(l.stdout, /threads-for-broad-questions\s+"Threads for broad Questions"/);
    const missing = await run('ddd.mjs', ['path', 'nope'], { env: sb.env, cwd: sb.repo });
    assert.equal(missing.code, 1);
  });
});

describe('board ops', () => {
  test('ids and slugs', () => {
    assert.ok(isId('thread-composer'));
    assert.ok(!isId('Thread'));
    assert.ok(!isId('a--b'));
    assert.ok(!isId('-a'));
    assert.equal(slugify('Threads for broad Questions!'), 'threads-for-broad-questions');
    assert.equal(slugify('Café déjà vu'), 'cafe-deja-vu');
  });

  test('add, update, move and remove', () => {
    const b = { flows: [] };
    applyBoardOp(b, { op: 'add-flow', id: 'f1', title: 'Flow one' });
    applyBoardOp(b, { op: 'add-flow', id: 'f0', title: 'Flow zero', index: 0 });
    assert.deepEqual(b.flows.map((f) => f.id), ['f0', 'f1']);
    applyBoardOp(b, { op: 'add-screen', flow: 'f1', id: 's1', title: 'S1' });
    applyBoardOp(b, { op: 'add-state', screen: 's1', id: 'empty', title: 'Empty', intent: 'why' });
    applyBoardOp(b, { op: 'add-state', screen: 's1', id: 'full', title: 'Full', file: 'mocks/custom.html' });
    assert.equal(b.flows[1].screens[0].states[0].file, 'mocks/s1--empty.html');
    assert.equal(b.flows[1].screens[0].states[1].file, 'mocks/custom.html');
    applyBoardOp(b, { op: 'update', screen: 's1', state: 'empty', intent: 'new why' });
    assert.equal(b.flows[1].screens[0].states[0].intent, 'new why');
    applyBoardOp(b, { op: 'update', flow: 'f1', title: 'Renamed' });
    assert.equal(b.flows[1].title, 'Renamed');
    applyBoardOp(b, { op: 'move', screen: 's1', state: 'full', index: 0 });
    assert.deepEqual(b.flows[1].screens[0].states.map((s) => s.id), ['full', 'empty']);
    applyBoardOp(b, { op: 'move', screen: 's1', toFlow: 'f0', index: 0 });
    assert.equal(b.flows[0].screens[0].id, 's1');
    applyBoardOp(b, { op: 'remove-state', screen: 's1', state: 'full' });
    assert.deepEqual(b.flows[0].screens[0].states.map((s) => s.id), ['empty']);
  });

  test('bad ids, duplicates and unknown targets are refused', () => {
    const b = { flows: [] };
    applyBoardOp(b, { op: 'add-flow', id: 'f', title: 'F' });
    applyBoardOp(b, { op: 'add-screen', flow: 'f', id: 's', title: 'S' });
    applyBoardOp(b, { op: 'add-flow', id: 'g', title: 'G' });
    assert.throws(() => applyBoardOp(b, { op: 'add-flow', id: 'Bad Id' }), /kebab-case/);
    assert.throws(() => applyBoardOp(b, { op: 'add-flow', id: 'f' }), /already/);
    assert.throws(() => applyBoardOp(b, { op: 'add-screen', flow: 'g', id: 's' }), /unique across the board/);
    assert.throws(() => applyBoardOp(b, { op: 'add-state', screen: 'nope', id: 'x' }), /no screen/);
    assert.throws(() => applyBoardOp(b, { op: 'add-state', screen: 's', id: 'x', file: '../etc/passwd' }), /mocks\//);
    assert.throws(() => applyBoardOp(b, { op: 'frobnicate' }), /unknown op/);
  });

  test('board.mjs edits the file when no server runs', async () => {
    const sb = sandbox();
    const dir = makeProject(sb.repo);
    const r = await run('board.mjs', [dir, 'add-state', '--screen', 'thread-composer', '--id', 'keyboard-up', '--title', 'Keyboard up', '--intent', 'Typing a note'], { env: sb.env });
    assert.equal(r.code, 0, r.stderr);
    assert.match(r.stdout, /added state thread-composer\/keyboard-up/);
    const st = loadBoard(dir).flows[0].screens[0].states.at(-1);
    assert.deepEqual(st, { id: 'keyboard-up', title: 'Keyboard up', intent: 'Typing a note', file: 'mocks/thread-composer--keyboard-up.html' });
    const bad = await run('board.mjs', [dir, 'add-state', '--screen', 'thread-composer', '--id', 'Keyboard Up', '--title', 'x'], { env: sb.env });
    assert.equal(bad.code, 1);
    assert.match(bad.stderr, /kebab-case/);
    const show = await run('board.mjs', [dir, 'show'], { env: sb.env });
    assert.match(show.stdout, /state keyboard-up: Keyboard up/);
  });
});
