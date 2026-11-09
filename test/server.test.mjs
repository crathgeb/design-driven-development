// The server: serialized board edits, notes round trip, send → jobs, the listener, job start/done/fail.
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';
import { loadJobs } from '../lib/jobs.mjs';
import { loadBoard, loadNotes, PLUGIN_ROOT, saveNotes } from '../lib/project.mjs';
import { startServer } from '../lib/server.mjs';
import { announce, http, makeProject, mark, run, sandbox, spawnScript } from './helpers.mjs';

describe('server', () => {
  let sb, dir, srv, url;
  before(async () => {
    sb = sandbox();
    dir = makeProject(sb.repo);
    srv = await startServer({ dir, port: 0 });
    url = srv.url;
    announce(dir, srv.port);
  });
  after(() => srv?.close());

  test('health, project and static files', async () => {
    const h = await http(url + 'api/health');
    assert.deepEqual(h.json, { app: 'design-driven-development', dir });
    const p = await http(url + 'api/project');
    assert.equal(p.json.project.slug, 'threads-for-broad-questions');
    assert.equal(p.json.board.flows.length, 2);
    assert.equal(p.json.claude.connected, false);
    assert.match((await http(url)).text, /<title>Board/);
    assert.match((await http(url + 'mocks/thread-composer--empty.html')).text, /No pieces yet/);
    assert.equal((await http(url + 'mocks/../project.json')).status, 404);
    assert.equal((await http(url + 'ui/board.js')).status, 200);
  });

  test('concurrent board POSTs are serialized: none is lost', async () => {
    const ids = Array.from({ length: 25 }, (_, i) => `s${i}`);
    const results = await Promise.all(ids.map((id) => http(url + 'api/board', 'POST', { op: 'add-state', screen: 'history', id, title: id })));
    assert.ok(results.every((r) => r.status === 200), results.map((r) => r.text).join(' '));
    const states = loadBoard(dir).flows[1].screens[0].states.map((s) => s.id);
    for (const id of ids) assert.ok(states.includes(id), `missing ${id}`);
    const dup = await http(url + 'api/board', 'POST', { op: 'add-state', screen: 'history', id: 's1', title: 'again' });
    assert.equal(dup.status, 409);
    // board.mjs goes through the server when it runs
    const r = await run('board.mjs', [dir, 'remove-state', '--screen', 'history', '--state', 's1'], { env: sb.env });
    assert.equal(r.code, 0, r.stderr);
    assert.ok(!loadBoard(dir).flows[1].screens[0].states.some((s) => s.id === 's1'));
  });

  test('notes round trip, and the server keeps the statuses it owns', async () => {
    const notes = {
      general: 'Calm, not gamified',
      app: { note: 'Warm, paper-like, one accent' },
      screens: { 'thread-composer': { note: 'Screen note', states: { empty: { note: 'State note', marks: [mark('m_a', 1), mark('m_b', 2, { shape: 'pin', w: 0, h: 0 })] } } } },
      asks: [],
    };
    assert.equal((await http(url + 'api/notes', 'PUT', notes)).status, 204);
    const back = (await http(url + 'api/project')).json.notes;
    assert.deepEqual(back, notes);
    // a stale board can't flip a sent mark back to open
    const saved = loadNotes(dir);
    saved.screens['thread-composer'].states.empty.marks[0].status = 'sent';
    saved.screens['thread-composer'].states.empty.marks[0].job = 'j_x';
    saveNotes(dir, saved);
    await http(url + 'api/notes', 'PUT', notes);
    const after1 = loadNotes(dir).screens['thread-composer'].states.empty.marks[0];
    assert.equal(after1.status, 'sent');
    assert.equal(after1.job, 'j_x');
    // put it back for the next tests
    saved.screens['thread-composer'].states.empty.marks[0].status = 'open';
    saved.screens['thread-composer'].states.empty.marks[0].job = null;
    saveNotes(dir, saved);
    // a board from before the whole-app note keeps it
    const { app: _app, ...old } = notes;
    await http(url + 'api/notes', 'PUT', old);
    assert.equal(loadNotes(dir).app.note, 'Warm, paper-like, one accent');
    assert.equal((await http(url + 'api/notes', 'PUT', [1, 2])).status, 400);
  });

  test('send makes one job per screen with marks, one per unscoped ask; the listener gets them on connect', async () => {
    const notes = loadNotes(dir);
    notes.screens['piece-picker'] = { note: '', states: { default: { note: '', marks: [mark('m_c', 1, { shape: 'arrow', points: [[10, 10], [50, 60]] })] } } };
    notes.asks.push({ id: 'a_one', text: 'Add a state where nothing is learned yet', screen: null, status: 'open', job: null, createdAt: new Date().toISOString() });
    notes.asks.push({ id: 'a_two', text: 'Try a bottom sheet', screen: 'thread-composer', status: 'open', job: null, createdAt: new Date().toISOString() });
    saveNotes(dir, notes);

    const r = await http(url + 'api/send', 'POST', {});
    assert.equal(r.status, 200, r.text);
    const jobs = r.json.jobs;
    assert.equal(jobs.length, 3);
    const composer = jobs.find((j) => j.screen === 'thread-composer');
    assert.equal(composer.kind, 'marks');
    assert.equal(composer.marks.length, 2);
    assert.deepEqual(composer.asks.map((a) => a.id), ['a_two']);
    assert.equal(jobs.find((j) => j.screen === 'piece-picker').marks.length, 1);
    const loose = jobs.find((j) => j.screen === null);
    assert.equal(loose.kind, 'ask');
    assert.equal(loose.asks[0].id, 'a_one');
    assert.ok(jobs.every((j) => j.status === 'queued'), 'no listener yet: they wait');

    const after2 = loadNotes(dir);
    const m = after2.screens['thread-composer'].states.empty.marks;
    assert.ok(m.every((x) => x.status === 'sent' && x.job === composer.id));
    assert.ok(after2.asks.every((a) => a.status === 'sent'));
    assert.equal((await http(url + 'api/send', 'POST', {})).json.jobs.length, 0, 'nothing open is left');

    // the context pack
    const pack = readFileSync(join(dir, 'jobs', `${composer.id}.md`), 'utf8');
    assert.match(pack, new RegExp(`File: ${join(dir, 'mocks', 'thread-composer--empty.html').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
    assert.ok(pack.includes(join(PLUGIN_ROOT, 'skills', 'design-driven-development', 'authoring.md')));
    assert.ok(pack.includes(`node ${join(PLUGIN_ROOT, 'scripts', 'board.mjs')} ${dir}`));
    assert.match(pack, /1\. box from \(10, 20\), 100×40 on `main > \.card:nth-of-type\(2\) > \.btn` \("Done"\): "note 1"/);
    assert.match(pack, /2\. pin at \(10, 20\)/);
    assert.match(pack, /Try a bottom sheet/);
    assert.match(pack, /SUMMARY: /);
    assert.match(pack, /Don't touch .*notes\.json/);

    // a listener connecting now is offered all three
    const l = spawnScript('listen.mjs', [dir], { env: sb.env });
    try {
      await l.waitFor(/connected to "Threads for broad Questions" at http:\/\/127\.0\.0\.1:\d+\/ \(3 jobs waiting\)/);
      await l.waitFor(/job j_\w+ on "Thread composer" \(2 marks, 1 ask\)/);
      await l.waitFor(/job j_\w+ on "Piece picker" \(1 mark, 0 asks\)/);
      await l.waitFor(/the author asked "Add a state where nothing is learned yet" \(job j_\w+\)/);
      const out = l.output();
      assert.ok(out.includes(`Read ${join(dir, 'jobs', composer.id + '.md')} and do the job it describes.`));
      assert.ok(out.includes(`node ${join(PLUGIN_ROOT, 'scripts', 'job.mjs')} ${dir} start ${composer.id}`));
      const p = (await http(url + 'api/project')).json;
      assert.equal(p.claude.connected, true);
      assert.ok(p.jobs.every((j) => j.status === 'offered'));

      // a new job while connected arrives at once
      const ask = await http(url + 'api/ask', 'POST', { text: 'Show a streak', screen: null });
      assert.equal(ask.status, 200);
      await l.waitFor(/the author asked "Show a streak"/);
    } finally {
      l.stop();
    }
    await new Promise((r) => setTimeout(r, 150));
    // the listener left: its offers go back to the queue for the next session
    assert.ok(loadJobs(dir).every((j) => j.status === 'queued'));
  });

  test('job start snapshots to history; done resolves the marks; fail reopens them', async () => {
    const jobs = loadJobs(dir);
    const composer = jobs.find((j) => j.screen === 'thread-composer');
    const s = await run('job.mjs', [dir, 'start', composer.id], { env: sb.env });
    assert.equal(s.code, 0, s.stderr);
    const hist = readdirSync(join(dir, 'history'));
    assert.equal(hist.length, 1);
    assert.match(hist[0], new RegExp(`-${composer.id}$`));
    const h = join(dir, 'history', hist[0]);
    assert.ok(existsSync(join(h, 'board.json')));
    assert.deepEqual(readdirSync(join(h, 'mocks')).sort(), ['thread-composer--empty.html', 'thread-composer--two-pieces.html']);
    assert.equal(loadJobs(dir).find((j) => j.id === composer.id).status, 'running');

    const d = await run('job.mjs', [dir, 'done', composer.id, '--summary', 'SUMMARY: Made Done the primary action.', '--files', 'mocks/thread-composer--empty.html'], { env: sb.env });
    assert.equal(d.code, 0, d.stderr);
    const job = loadJobs(dir).find((j) => j.id === composer.id);
    assert.equal(job.status, 'done');
    assert.equal(job.summary, 'Made Done the primary action.');
    assert.deepEqual(job.files, ['mocks/thread-composer--empty.html']);
    const notes = loadNotes(dir);
    assert.ok(notes.screens['thread-composer'].states.empty.marks.every((m) => m.status === 'done'));
    assert.equal(notes.asks.find((a) => a.id === 'a_two').status, 'done');

    const picker = jobs.find((j) => j.screen === 'piece-picker');
    const f = await run('job.mjs', [dir, 'fail', picker.id, '--error', 'the mock is missing'], { env: sb.env });
    assert.equal(f.code, 0, f.stderr);
    const m = loadNotes(dir).screens['piece-picker'].states.default.marks[0];
    assert.equal(m.status, 'open');
    assert.equal(m.job, null);
    assert.equal(loadJobs(dir).find((j) => j.id === picker.id).error, 'the mock is missing');

    const log = readFileSync(join(dir, 'log.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l).type);
    for (const t of ['job created', 'job started', 'job done', 'job failed']) assert.ok(log.includes(t), t);
  });

  test('listen.mjs --state tells the board', async () => {
    const r = await run('listen.mjs', [dir, '--state', 'working', '--message', 'Updating 2 screens'], { env: sb.env });
    assert.equal(r.code, 0, r.stderr);
    const c = (await http(url + 'api/project')).json.claude;
    assert.equal(c.phase, 'working');
    assert.equal(c.message, 'Updating 2 screens');
  });

  test('the board stream reports changed mock files', async () => {
    const res = await fetch(url + 'api/stream');
    const reader = res.body.getReader();
    const { writeFileSync } = await import('node:fs');
    setTimeout(() => writeFileSync(join(dir, 'mocks', 'history--default.html'), '<p>changed</p>'), 100);
    let buf = '';
    const until = Date.now() + 4000;
    while (Date.now() < until && !buf.includes('"path":"mocks/history--default.html"')) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += new TextDecoder().decode(value);
    }
    reader.cancel();
    assert.ok(buf.includes('"type":"file"') && buf.includes('mocks/history--default.html'), buf);
  });
});
