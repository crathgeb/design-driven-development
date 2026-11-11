// Export from the board: an ask with scope "export" becomes an export job that covers no screen (it runs
// alongside screen and whole-app jobs), its context pack says how to write the spec and what else was
// asked for, it snapshots no mocks, and the listener says it's an export.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';
import { jobCoverage, loadJobs } from '../lib/jobs.mjs';
import { loadBoard, loadNotes } from '../lib/project.mjs';
import { startServer } from '../lib/server.mjs';
import { announce, http, makeProject, sandbox, spawnScript } from './helpers.mjs';

describe('export jobs', () => {
  let sb, dir, srv, url, events;
  const status = () => Object.fromEntries(loadJobs(dir).map((j) => [j.id, j.status]));
  const ask = async (body) => {
    const r = await http(url + 'api/ask', 'POST', body);
    assert.equal(r.status, 200, r.text);
    return r.json;
  };

  before(async () => {
    sb = sandbox();
    dir = makeProject(sb.repo);
    srv = await startServer({ dir, port: 0 });
    url = srv.url;
    announce(dir, srv.port);
    const res = await fetch(url + 'api/claude/events'); // a listener, so the server offers what may run
    events = res.body.getReader();
  });
  after(async () => {
    await events?.cancel().catch(() => {});
    await srv?.close();
  });

  test('an export ask becomes one export job that covers no screen, with a pack that says how to export', async () => {
    const text = 'export the spec and break the work into a series of epics and stories';
    const r = await ask({ text, scope: 'export' });
    assert.equal(r.ask.scope, 'export');
    assert.equal(r.jobs.length, 1);
    const job = r.jobs[0];
    assert.equal(job.kind, 'export');
    assert.equal(job.scope, 'export');
    assert.equal(job.screen, null);
    assert.deepEqual(jobCoverage(loadBoard(dir), job), { all: false, screens: [] });
    assert.equal(loadNotes(dir).asks.find((a) => a.id === r.ask.id).job, job.id);

    const pack = readFileSync(join(dir, 'jobs', `${job.id}.md`), 'utf8');
    assert.match(pack, /^# design-driven-development export job j_/);
    assert.ok(pack.includes(`> ${text}`), 'the request, word for word');
    assert.ok(pack.includes(`scripts/export.mjs ${dir}`), 'how to run the export');
    assert.match(pack, /Decisions settled/);
    assert.match(pack, /its own Markdown file in the export folder/);
    assert.ok(pack.includes(join(sb.repo, 'docs', 'design')), 'where it writes');

    const started = await http(url + `api/jobs/${job.id}/start`, 'POST', {});
    assert.equal(started.status, 200, started.text);
    assert.deepEqual(readdirSync(join(started.json.history, 'mocks')), [], 'an export changes no mock, so none are snapshotted');
    await http(url + `api/jobs/${job.id}/done`, 'POST', { summary: 'Wrote spec.md and plan.md' });
    assert.equal(loadNotes(dir).asks.find((a) => a.id === r.ask.id).status, 'done');
  });

  test('an export runs alongside a whole-app job', async () => {
    const app = (await ask({ text: 'Make it feel warmer', scope: 'app' })).jobs[0];
    const exp = (await ask({ text: 'export the spec', scope: 'export' })).jobs[0];
    const s = status();
    assert.equal(s[app.id], 'offered');
    assert.equal(s[exp.id], 'offered', 'not held back by the app job');
  });
});

describe('the listener line for an export job', () => {
  let sb, dir, srv;
  before(async () => {
    sb = sandbox();
    dir = makeProject(sb.repo);
    srv = await startServer({ dir, port: 0 });
    announce(dir, srv.port);
  });
  after(() => srv?.close());

  test('says it is an export that changes no screen, with the start, subagent and done steps', async () => {
    const l = spawnScript('listen.mjs', [dir], { env: sb.env });
    try {
      await l.waitFor(/connected to/);
      await http(srv.url + 'api/ask', 'POST', { text: 'export the spec', scope: 'export' });
      const out = await l.waitFor(/export job j_\w+: the author asked "export the spec"\. This is an export: it writes the spec .* and changes no screen\./);
      const id = out.match(/export job (j_\w+)/)[1];
      assert.ok(out.includes(`job.mjs ${dir} start ${id}`));
      assert.ok(out.includes(`"Read ${join(dir, 'jobs', id + '.md')} and do the job it describes."`));
      assert.ok(out.includes(`job.mjs ${dir} done ${id} --summary`));
    } finally {
      l.stop();
    }
  });
});
