#!/usr/bin/env node
// The link between a Claude Code session and a project's board server. Node built-ins only.
//
//   node listen.mjs <project> [--port N]
//       Connects to the project's server and prints one line per event: when connected, and for
//       each job the author sends (marks on a screen, or an ask). Meant for Claude Code's Monitor
//       tool: each line wakes Claude with the job. While it's connected, the board shows
//       "Claude connected", and jobs queued while no one listened are offered at once.
//       It reconnects if the server restarts, and exits after ~30 s with no server.
//
//   node listen.mjs <project> --state <idle|working|ready|error> [--message "…"]
//       Tells the board what Claude is doing.

import { get } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { call, findServer, HOST } from '../lib/client.mjs';
import { env, loadProject, resolveProject } from '../lib/project.mjs';

const SCRIPTS = dirname(fileURLToPath(import.meta.url));
const RETRY_MS = Number(env('LISTEN_RETRY_MS')) || 2000;
const GIVE_UP_AFTER = 15; // tries, about 30 seconds

function usage(msg) {
  if (msg) console.error(`listen: ${msg}`);
  console.error('usage: node listen.mjs <project> [--port N]\n       node listen.mjs <project> --state <idle|working|ready|error> [--message TEXT]');
  process.exit(2);
}

let parsed;
try {
  parsed = parseArgs({ allowPositionals: true, options: { port: { type: 'string' }, state: { type: 'string' }, message: { type: 'string' }, help: { type: 'boolean', short: 'h' } } });
} catch (err) {
  usage(err.message);
}
const { values: o, positionals: [projectArg] } = parsed;
if (o.help) usage();
if (!projectArg) usage('which project? pass its folder or slug');
let dir;
try {
  dir = resolveProject(projectArg);
} catch (err) {
  usage(err.message);
}
const port = o.port ? Number(o.port) : null;
const name = loadProject(dir)?.name || projectArg;

if (o.state) {
  const p = await findServer(dir, { port });
  if (!p) {
    console.error(`listen: no server is serving "${name}" (start it with ddd.mjs serve)`);
    process.exit(1);
  }
  const { status, body } = await call(p, 'POST', '/api/claude/state', { phase: o.state, message: o.message || '' }).catch((e) => ({ status: 0, body: e.message }));
  if (status === 204) console.log(`design-driven-development: told the board that Claude is ${o.state}${o.message ? `: ${o.message}` : ''}`);
  else console.error(`listen: the server refused (${status}${body ? `: ${body}` : ''})`);
  process.exit(status === 204 ? 0 : 1);
}

const oneLine = (s, n = 200) => {
  const t = String(s || '').replace(/\s+/g, ' ').trim();
  return t.length > n ? t.slice(0, n - 1) + '…' : t;
};
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

function describe(ev) {
  if (ev.type !== 'job') return `design-driven-development: ${ev.type}`;
  const job = `node ${join(SCRIPTS, 'job.mjs')} ${dir}`;
  const steps = `Run \`${job} start ${ev.id}\`, then start a background subagent with the prompt "Read ${ev.pack} and do the job it describes.", and when it finishes run \`${job} done ${ev.id} --summary "<its SUMMARY line>"\` (or \`${job} fail ${ev.id} --error "<why>"\`).`;
  if (ev.kind === 'app' || ev.kind === 'flow') {
    const what = ev.kind === 'app' ? 'a whole-app job: it applies to every screen' : `a flow job: it applies to every screen in "${ev.flowTitle || ev.flow}"`;
    const size = `${plural(ev.screens || 0, 'screen')}, ${plural(ev.states || 0, 'state')}`;
    const label = ev.kind === 'app' ? 'whole-app job' : `flow job on "${ev.flowTitle || ev.flow}"`;
    return `design-driven-development: ${label} ${ev.id}: the author asked "${oneLine(ev.text)}" (${size}). This is ${what}, and no other job touches those screens until it's done. ${steps} The pack tells the subagent to change the theme first and, if many mocks need edits, to split them by flow across its own subagents.`;
  }
  if (ev.kind === 'marks' || ev.screen) {
    return `design-driven-development: job ${ev.id} on "${ev.screenTitle || ev.screen}" (${plural(ev.marks, 'mark')}, ${plural(ev.asks, 'ask')}). ${steps}`;
  }
  return `design-driven-development: the author asked "${oneLine(ev.text)}" (job ${ev.id}). ${steps}`;
}

let misses = 0;
let announced = false;
for (;;) {
  const p = await findServer(dir, { port });
  if (!p) {
    misses++;
    if (misses >= GIVE_UP_AFTER) {
      console.log(`design-driven-development: the server for "${name}" has stopped; no longer listening. Start it again (ddd.mjs serve) and reconnect.`);
      process.exit(1);
    }
    await new Promise((r) => setTimeout(r, RETRY_MS));
    continue;
  }
  misses = 0;
  await new Promise((done) => {
    const req = get({ host: HOST, port: p, path: '/api/claude/events', headers: { accept: 'text/event-stream' } }, (res) => {
      if (res.statusCode !== 200) {
        console.log(`design-driven-development: the server for "${name}" refused the connection (${res.statusCode}).`);
        process.exit(1);
      }
      res.setEncoding('utf8');
      let buf = '';
      res.on('data', (chunk) => {
        buf += chunk;
        let i;
        while ((i = buf.indexOf('\n\n')) !== -1) {
          const frame = buf.slice(0, i);
          buf = buf.slice(i + 2);
          const data = frame
            .split('\n')
            .filter((l) => l.startsWith('data:'))
            .map((l) => l.slice(5).trim())
            .join('\n');
          if (!data) continue; // a keep-alive comment
          let ev;
          try {
            ev = JSON.parse(data);
          } catch {
            continue;
          }
          if (ev.type === 'hello') {
            // Say so once; a quiet reconnect after a server restart isn't news.
            if (!announced) console.log(`design-driven-development: connected to "${ev.name || name}" at http://${HOST}:${p}/ (${plural(ev.queued || 0, 'job')} waiting).`);
            announced = true;
          } else console.log(describe(ev));
        }
      });
      res.on('end', done);
      res.on('error', done);
    });
    req.on('error', done);
  });
  await new Promise((r) => setTimeout(r, RETRY_MS));
}
