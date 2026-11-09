// Whole-app and flow work: the project theme (/theme.css), app and flow jobs, their exclusivity
// over the screens they cover, their context pack, and the listener's line for them.
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';
import { jobCoverage, loadJobs } from '../lib/jobs.mjs';
import { loadBoard, loadNotes, saveNotes } from '../lib/project.mjs';
import { startServer } from '../lib/server.mjs';
import { relativize } from '../scripts/export.mjs';
import { announce, http, makeProject, mark, run, sandbox, spawnScript } from './helpers.mjs';

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

describe('the project theme', () => {
  let sb, dir, srv, url;
  before(async () => {
    sb = sandbox();
    dir = makeProject(sb.repo);
    srv = await startServer({ dir, port: 0 });
    url = srv.url;
  });
  after(() => srv?.close());

  test('/theme.css is the project theme, and an empty stylesheet when there is none', async () => {
    const own = await http(url + 'theme.css');
    assert.equal(own.status, 200);
    assert.match(own.text, /:root \{/, 'init wrote a starter theme');
    rmSync(join(dir, 'theme.css'));
    const res = await fetch(url + 'theme.css');
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /^text\/css/);
    assert.doesNotMatch(await res.text(), /[{}]/);
    writeFileSync(join(dir, 'theme.css'), ':root { --accent: #B4532A; }\n');
    assert.match((await http(url + 'theme.css')).text, /#B4532A/);
  });

  test('a theme.css change reaches the board as a file event', async () => {
    const res = await fetch(url + 'api/stream');
    const reader = res.body.getReader();
    setTimeout(() => writeFileSync(join(dir, 'theme.css'), ':root { --accent: #2A6B4F; }\n'), 100);
    let buf = '';
    const until = Date.now() + 4000;
    while (Date.now() < until && !buf.includes('"path":"theme.css"')) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += new TextDecoder().decode(value);
    }
    reader.cancel();
    assert.ok(buf.includes('"type":"file"') && buf.includes('"path":"theme.css"'), buf);
  });

  test('the mock template links the kit, then the theme; export rewrites both and copies the theme', async () => {
    const tpl = readFileSync(join(import.meta.dirname || new URL('.', import.meta.url).pathname, '..', 'templates', 'mock.html'), 'utf8');
    assert.ok(tpl.indexOf('href="/kit/mock.css"') < tpl.indexOf('href="/theme.css"') && tpl.includes('href="/theme.css"'));
    assert.equal(relativize('<link href="/kit/mock.css"><link href="/theme.css">'), '<link href="../kit/mock.css"><link href="../theme.css">');
    writeFileSync(join(dir, 'mocks', 'history--default.html'), '<link rel="stylesheet" href="/kit/mock.css"><link rel="stylesheet" href="/theme.css"><p>History</p>');
    const out = join(sb.base, 'out');
    const r = await run('export.mjs', [dir, '--out', out, '--no-shots'], { env: sb.env });
    assert.equal(r.code, 0, r.stderr);
    assert.match(readFileSync(join(out, 'mocks', 'history--default.html'), 'utf8'), /href="\.\.\/theme\.css"/);
    assert.match(readFileSync(join(out, 'theme.css'), 'utf8'), /--accent/);
    rmSync(join(dir, 'theme.css'));
    const r2 = await run('export.mjs', [dir, '--out', join(sb.base, 'out2'), '--no-shots'], { env: sb.env });
    assert.equal(r2.code, 0, r2.stderr);
    assert.ok(existsSync(join(sb.base, 'out2', 'theme.css')), 'an export always has a theme.css for the links');
  });
});

describe('whole-app and flow jobs', () => {
  let sb, dir, srv, url, events;
  const status = () => Object.fromEntries(loadJobs(dir).map((j) => [j.id, j.status]));
  const ask = async (body) => {
    const r = await http(url + 'api/ask', 'POST', body);
    assert.equal(r.status, 200, r.text);
    return r.json.jobs[0];
  };
  const markScreen = async (screen, state, id) => {
    const notes = loadNotes(dir);
    notes.screens[screen] ||= { note: '', states: {} };
    notes.screens[screen].states[state] ||= { note: '', marks: [] };
    notes.screens[screen].states[state].marks.push(mark(id, notes.screens[screen].states[state].marks.length + 1));
    saveNotes(dir, notes);
    const r = await http(url + 'api/send', 'POST', { screen });
    assert.equal(r.status, 200, r.text);
    return r.json.jobs[0];
  };
  const job = (verb, id, body = {}) => http(url + `api/jobs/${id}/${verb}`, 'POST', body);

  before(async () => {
    sb = sandbox();
    dir = makeProject(sb.repo);
    srv = await startServer({ dir, port: 0 });
    url = srv.url;
    announce(dir, srv.port);
    // A listener, so the server offers what may run.
    const res = await fetch(url + 'api/claude/events');
    events = res.body.getReader();
  });
  after(async () => {
    await events?.cancel().catch(() => {});
    await srv?.close();
  });

  test('an app ask becomes one app job covering every screen; a flow ask one flow job', async () => {
    const notes = loadNotes(dir);
    notes.app.note = 'Warm, paper-like, one terracotta accent.';
    notes.screens.history = { note: 'Keep the dates', states: {} };
    saveNotes(dir, notes);

    const app = await ask({ text: 'Make it feel warmer', scope: 'app' });
    assert.equal(app.kind, 'app');
    assert.equal(app.scope, 'app');
    assert.equal(app.screen, null);
    assert.deepEqual(jobCoverage(loadBoard(dir), app), { all: true, screens: ['thread-composer', 'piece-picker', 'history'] });
    const a = loadNotes(dir).asks.find((x) => x.job === app.id);
    assert.equal(a.scope, 'app');
    assert.equal(a.status, 'sent');

    const pack = readFileSync(join(dir, 'jobs', `${app.id}.md`), 'utf8');
    assert.match(pack, /whole-app job/);
    assert.match(pack, /> Make it feel warmer/);
    assert.match(pack, /Warm, paper-like, one terracotta accent\./);
    assert.ok(pack.includes(join(dir, 'theme.css')), 'names the theme');
    for (const f of ['thread-composer--empty', 'thread-composer--two-pieces', 'piece-picker--default', 'history--default']) {
      assert.match(pack, new RegExp(esc(join(dir, 'mocks', `${f}.html`))), f);
    }
    assert.match(pack, /4 states/);
    assert.match(pack, /Keep the dates/);
    assert.match(pack, /Theme first/);
    assert.match(pack, /If more than ~8 mocks need edits, split by flow across subagents, then verify/);
    assert.match(pack, /Keep intents current/);
    assert.match(pack, /SUMMARY: /);

    const flow = await ask({ text: 'Tighter spacing in every Build screen', scope: 'flow', flow: 'build-thread' });
    assert.equal(flow.kind, 'flow');
    assert.equal(flow.flow, 'build-thread');
    assert.deepEqual(jobCoverage(loadBoard(dir), flow), { all: false, screens: ['thread-composer', 'piece-picker'] });
    const fpack = readFileSync(join(dir, 'jobs', `${flow.id}.md`), 'utf8');
    assert.match(fpack, /flow job/);
    assert.ok(fpack.includes(join(dir, 'mocks', 'piece-picker--default.html')));
    assert.ok(!fpack.includes(`State Default (\`default\`): ${join(dir, 'mocks', 'history--default.html')}`), 'other flows are context, not work');
    assert.match(fpack, /don't change it for a flow request/);

    assert.equal((await http(url + 'api/ask', 'POST', { text: 'x', scope: 'flow', flow: 'nope' })).status, 404);
    // the app job was offered at once; the flow job waits behind it
    assert.equal(status()[app.id], 'offered');
    assert.equal(status()[flow.id], 'queued');
    // finish both so the next test starts clean
    await job('start', app.id);
    const hist = readdirSync(join(dir, 'history')).find((h) => h.endsWith(app.id));
    assert.equal(readdirSync(join(dir, 'history', hist, 'mocks')).length, 4, 'an app job snapshots every mock');
    assert.ok(existsSync(join(dir, 'history', hist, 'theme.css')), 'and the theme');
    await job('done', app.id, { summary: 'SUMMARY: Warmer theme.' });
    assert.equal(status()[flow.id], 'offered');
    await job('start', flow.id);
    await job('done', flow.id, { summary: 'Tighter.' });
    assert.equal(loadNotes(dir).asks.find((x) => x.job === app.id).status, 'done');
  });

  test('an app job waits for running screen jobs, and screen jobs sent after it wait for it', async () => {
    const a = await markScreen('thread-composer', 'empty', 'm_x1');
    assert.equal(status()[a.id], 'offered');
    await job('start', a.id);
    const app = await ask({ text: 'Try a bolder type scale', scope: 'app' });
    assert.equal(status()[app.id], 'queued', 'a screen job is running');
    const b = await markScreen('history', 'default', 'm_x2');
    assert.equal(status()[b.id], 'queued', 'a screen job sent after the app job waits for it');
    const loose = await ask({ text: 'Add an onboarding flow' });
    assert.equal(loose.kind, 'ask');
    assert.equal(status()[loose.id], 'offered', 'a loose ask holds no screens');

    await job('done', a.id, { summary: 'done' });
    assert.equal(status()[app.id], 'offered');
    assert.equal(status()[b.id], 'queued');
    await job('start', app.id);
    const c = await markScreen('piece-picker', 'default', 'm_x3');
    assert.equal(status()[c.id], 'queued', 'nothing starts on any screen while the app job runs');
    await job('done', app.id, { summary: 'Bolder.' });
    assert.equal(status()[b.id], 'offered');
    assert.equal(status()[c.id], 'offered');
    for (const j of [b, c, loose]) await job('done', j.id, { summary: 'ok' });
  });

  test('a flow job holds only its flow', async () => {
    const pick = await markScreen('piece-picker', 'default', 'm_y1');
    await job('start', pick.id);
    const review = await ask({ text: 'Rename History to Past answers everywhere in Review', scope: 'flow', flow: 'review' });
    assert.equal(status()[review.id], 'offered', 'another flow is free');
    const build = await ask({ text: 'Rounder cards in Build', scope: 'flow', flow: 'build-thread' });
    assert.equal(status()[build.id], 'queued', 'its flow has a running screen job');
    const hist = await markScreen('history', 'default', 'm_y2');
    assert.equal(status()[hist.id], 'queued', 'the review flow job holds History');
    await job('done', review.id, { summary: 'Renamed.' });
    assert.equal(status()[hist.id], 'offered');
    await job('done', pick.id, { summary: 'ok' });
    assert.equal(status()[build.id], 'offered');
    for (const j of [build, hist]) await job('done', j.id, { summary: 'ok' });
  });
});

describe('the listener line for app and flow jobs', () => {
  let sb, dir, srv;
  before(async () => {
    sb = sandbox();
    dir = makeProject(sb.repo);
    srv = await startServer({ dir, port: 0 });
    announce(dir, srv.port);
  });
  after(() => srv?.close());

  test('says it is a whole-app or flow job, with the start, subagent and done steps', async () => {
    const l = spawnScript('listen.mjs', [dir], { env: sb.env });
    try {
      await l.waitFor(/connected to/);
      await http(srv.url + 'api/ask', 'POST', { text: 'Make it feel warmer', scope: 'app' });
      const out = await l.waitFor(/whole-app job j_\w+: the author asked "Make it feel warmer" \(3 screens, 4 states\)\. This is a whole-app job: it applies to every screen/);
      const id = out.match(/whole-app job (j_\w+)/)[1];
      assert.ok(out.includes(`job.mjs ${dir} start ${id}`));
      assert.ok(out.includes(`"Read ${join(dir, 'jobs', id + '.md')} and do the job it describes."`));
      assert.ok(out.includes(`job.mjs ${dir} done ${id} --summary`));
      assert.match(out, /split them by flow across its own subagents/);
      await http(srv.url + `api/jobs/${id}/done`, 'POST', { summary: 'ok' });
      await http(srv.url + 'api/ask', 'POST', { text: 'Calmer Review', scope: 'flow', flow: 'review' });
      await l.waitFor(/flow job on "Review" j_\w+: the author asked "Calmer Review" \(1 screen, 1 state\)\. This is a flow job: it applies to every screen in "Review"/);
    } finally {
      l.stop();
    }
  });
});
