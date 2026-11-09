// export.mjs: the static board, copies with relative links, the spec skeleton (kept when it exists).
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { loadNotes, saveNotes } from '../lib/project.mjs';
import { relativize } from '../scripts/export.mjs';
import { makeProject, mark, run, sandbox } from './helpers.mjs';

test('relativize makes root links relative', () => {
  assert.equal(relativize('<link rel="stylesheet" href="/kit/mock.css"><img src=\'/assets/a.png\'>'), '<link rel="stylesheet" href="../kit/mock.css"><img src=\'../assets/a.png\'>');
  assert.equal(relativize('background: url(/assets/x.jpg)'), 'background: url(../assets/x.jpg)');
  assert.equal(relativize('<a href="https://x.com/kit/">'), '<a href="https://x.com/kit/">');
});

test('export writes the static board, copies and the spec skeleton', async () => {
  const sb = sandbox();
  const dir = makeProject(sb.repo);
  writeFileSync(join(dir, 'mocks', 'thread-composer--empty.html'), '<!doctype html><link rel="stylesheet" href="/kit/mock.css"><p>Empty</p>');
  const notes = loadNotes(dir);
  notes.general = 'Keep it calm.';
  notes.screens['thread-composer'] = { note: 'Primary action matters', states: { empty: { note: '', marks: [mark('m_d', 1, { status: 'done', text: 'make Done the primary action' })] } } };
  saveNotes(dir, notes);

  const out = join(sb.base, 'out');
  const r = await run('export.mjs', [dir, '--out', out, '--no-shots'], { env: sb.env });
  assert.equal(r.code, 0, r.stderr);
  for (const f of ['index.html', 'ui/board.js', 'ui/board.css', 'board.json', 'notes.json', 'spec.md', 'mocks/thread-composer--empty.html']) assert.ok(existsSync(join(out, f)), f);
  const index = readFileSync(join(out, 'index.html'), 'utf8');
  assert.match(index, /<script id="ddd-data" type="application\/json">/);
  assert.match(index, /href="ui\/board.css"/);
  assert.ok(!index.includes(sb.repo), 'no local repo path in the exported page');
  const data = JSON.parse(index.match(/<script id="ddd-data" type="application\/json">([\s\S]*?)<\/script>/)[1]);
  assert.equal(data.board.flows.length, 2);
  assert.equal(data.notes.general, 'Keep it calm.');
  assert.match(readFileSync(join(out, 'mocks', 'thread-composer--empty.html'), 'utf8'), /href="\.\.\/kit\/mock\.css"/);

  const spec = readFileSync(join(out, 'spec.md'), 'utf8');
  assert.match(spec, /^# Threads for broad Questions/);
  assert.match(spec, /## Flow: Build a Thread/);
  assert.match(spec, /### Screen: Thread composer \(`thread-composer`\)/);
  assert.match(spec, /#### State: No pieces yet \(`empty`\)/);
  assert.match(spec, /\*Intent:\* Invite the first pick\./);
  assert.match(spec, /Resolved mark 1\. box .*make Done the primary action/);
  assert.match(spec, /screens\/thread-composer--empty\.png/);

  // a second export keeps Claude's spec.md and writes the skeleton beside it
  writeFileSync(join(out, 'spec.md'), '# Written by Claude\n');
  const r2 = await run('export.mjs', [dir, '--out', out, '--no-shots'], { env: sb.env });
  assert.equal(r2.code, 0, r2.stderr);
  assert.equal(readFileSync(join(out, 'spec.md'), 'utf8'), '# Written by Claude\n');
  assert.ok(existsSync(join(out, 'spec.skeleton.md')));
  assert.match(r2.stdout, /spec\.md exists and was kept/);
});

test('export defaults into the product repo', async () => {
  const sb = sandbox();
  const dir = makeProject(sb.repo);
  const r = await run('export.mjs', [dir, '--no-shots'], { env: sb.env });
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /docs\/design\/threads-for-broad-questions/);
  const { realpathSync } = await import('node:fs');
  assert.ok(existsSync(join(realpathSync(sb.repo), 'docs', 'design', 'threads-for-broad-questions', 'index.html')));
});
