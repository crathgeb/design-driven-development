#!/usr/bin/env node
// Report on a job from the Claude Code session working it. Node built-ins only.
//
//   node job.mjs <project> start <job-id>                       before the worker changes files: snapshots the
//                                                               screen's mocks and board.json into history/
//   node job.mjs <project> done  <job-id> --summary "…" [--files mocks/a.html,mocks/b.html]
//                                                               the job's marks and asks become done
//   node job.mjs <project> fail  <job-id> --error "…"           its marks and asks go back to open
//   node job.mjs <project> list                                 every job and its status
//
// Goes through the project's server when it runs (so the board updates at once); otherwise edits
// the files directly.

import { parseArgs } from 'node:util';
import { call, findServer } from '../lib/client.mjs';
import { failJob, finishJob, loadJobs, startJob } from '../lib/jobs.mjs';
import { resolveProject, withFileLock } from '../lib/project.mjs';

const USAGE = 'usage: node job.mjs <project> <start|done|fail> <job-id> [--summary S] [--files a,b] [--error E]\n       node job.mjs <project> list';

function fail(msg, code = 1) {
  console.error(`job: ${msg}`);
  process.exit(code);
}

let parsed;
try {
  parsed = parseArgs({ allowPositionals: true, options: { summary: { type: 'string' }, files: { type: 'string' }, error: { type: 'string' }, help: { type: 'boolean', short: 'h' } } });
} catch (err) {
  fail(`${err.message}\n${USAGE}`, 2);
}
const { values: o, positionals: [projectArg, verb, id] } = parsed;
if (o.help) {
  console.log(USAGE);
  process.exit(0);
}
if (!projectArg || !verb) fail(USAGE, 2);
let dir;
try {
  dir = resolveProject(projectArg);
} catch (err) {
  fail(err.message);
}

if (verb === 'list') {
  const jobs = loadJobs(dir);
  if (!jobs.length) console.log('No jobs yet.');
  for (const j of jobs) console.log(`${j.id}  ${j.status.padEnd(7)}  ${j.screen || (j.kind === 'app' ? '(whole app)' : j.kind === 'flow' ? `(flow ${j.flow})` : '(ask)')}  ${j.marks.length} marks, ${j.asks.length} asks${j.summary ? `  — ${j.summary}` : ''}${j.error ? `  — ${j.error}` : ''}`);
  process.exit(0);
}
if (!['start', 'done', 'fail'].includes(verb)) fail(`unknown action ${verb}\n${USAGE}`, 2);
if (!id) fail(`which job? ${USAGE}`, 2);
if (verb === 'done' && !o.summary) console.error('job: no --summary; the board will show the job as done without one');

const body = verb === 'done' ? { summary: o.summary || '', files: o.files ? o.files.split(',').map((s) => s.trim()).filter(Boolean) : [] } : verb === 'fail' ? { error: o.error || '' } : {};

let job;
const port = await findServer(dir);
if (port) {
  const { status, body: out } = await call(port, 'POST', `/api/jobs/${id}/${verb}`, body).catch((err) => fail(`the server didn't answer: ${err.message}`));
  if (status !== 200) fail(typeof out === 'string' ? out : JSON.stringify(out));
  job = out;
} else {
  try {
    job = await withFileLock(dir, () => (verb === 'start' ? startJob(dir, id) : verb === 'done' ? finishJob(dir, id, body) : failJob(dir, id, body)));
  } catch (err) {
    fail(err.message);
  }
}
console.log(`job: ${job.id} is ${job.status}${job.summary ? `: ${job.summary}` : ''}${job.error ? `: ${job.error}` : ''}${verb === 'start' && job.history ? ` (snapshot in ${job.history})` : ''}`);
