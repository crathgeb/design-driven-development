#!/usr/bin/env node
// The design-driven-development CLI: create, serve, list and find projects. Node built-ins only.
//
//   node ddd.mjs init "<name>" [--repo <path>] [--goal "<line>"] [--device phone|tablet|laptop|desktop|WxH]
//                                                                  create a project; prints its folder
//   node ddd.mjs set-device <slug|path> <device>                   change the project's default device
//   node ddd.mjs serve <slug|path> [--no-open] [--port N]          serve its board (stays in the foreground)
//   node ddd.mjs list [--all]                                      projects for this repo (or every repo)
//   node ddd.mjs path <slug>                                       print a project's folder
//
// Projects live in ~/.design-driven-development/projects/<repo>/<slug>/ ($DDD_HOME overrides it; lib/project.mjs has the fallbacks to the old name).

import { spawn } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import { basename } from 'node:path';
import { parseArgs } from 'node:util';
import { findServer } from '../lib/client.mjs';
import { deviceText, PRESET_NAMES } from '../lib/devices.mjs';
import { FIRST_PORT, homeNote, initProject, listProjects, loadProject, paths, readJson, repoRoot, resolveProject, setProjectDevice, writeJsonAtomic } from '../lib/project.mjs';
import { startServer } from '../lib/server.mjs';

const USAGE = `usage:
  ddd.mjs init "<name>" [--repo <path>] [--goal "<line>"] [--device <device>]
  ddd.mjs set-device <slug|path> <device>
  ddd.mjs serve <slug|path> [--no-open] [--port N]
  ddd.mjs list [--all]
  ddd.mjs path <slug>
<device> is ${PRESET_NAMES.join(', ')} or a size like 1366x768 (default phone).`;

function fail(msg, code = 1) {
  console.error(`ddd: ${msg}`);
  process.exit(code);
}

let args;
try {
  args = parseArgs({
    allowPositionals: true,
    options: {
      repo: { type: 'string' },
      goal: { type: 'string' },
      device: { type: 'string' },
      port: { type: 'string' },
      'no-open': { type: 'boolean' },
      all: { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
    },
  });
} catch (err) {
  fail(`${err.message}\n${USAGE}`, 2);
}
const { values: o, positionals: [cmd, arg, arg2] } = args;
if (o.help || !cmd) {
  console.log(USAGE);
  process.exit(cmd || o.help ? 0 : 2);
}

const note = homeNote();
if (note) console.error(`ddd: ${note}`);

try {
  if (cmd === 'init') {
    if (!arg) fail(`init needs a name\n${USAGE}`, 2);
    const { dir, created } = initProject({ name: arg, repo: o.repo, goal: o.goal || '', device: o.device });
    if (!created) console.error(`ddd: a project with that slug already exists; using it${o.device ? ' (its device is unchanged: use set-device)' : ''}`);
    console.log(dir);
  } else if (cmd === 'set-device') {
    if (!arg || !arg2) fail(`set-device needs a project and a device\n${USAGE}`, 2);
    const dir = resolveProject(arg);
    const d = setProjectDevice(dir, arg2);
    console.log(`ddd: ${basename(dir)} is designed for ${deviceText(d)} (screens and states with their own device keep it)`);
  } else if (cmd === 'path') {
    console.log(resolveProject(arg));
  } else if (cmd === 'list') {
    const repoName = o.all ? null : basename(repoRoot());
    const all = listProjects({ repoName });
    if (!all.length) console.log(o.all ? 'No projects yet.' : `No projects for ${repoName} yet (--all lists every repo).`);
    for (const p of all) {
      const s = readJson(paths(p.dir).server);
      const port = s?.port ? await findServer(p.dir, { port: s.port }) : null;
      const name = p.project?.name || basename(p.dir);
      console.log(`${o.all ? `${p.repoName}/` : ''}${basename(p.dir)}  "${name}"${port ? `  serving at http://127.0.0.1:${port}/` : ''}\n    ${p.dir}`);
    }
  } else if (cmd === 'serve') {
    await serve(resolveProject(arg));
  } else fail(`unknown command ${cmd}\n${USAGE}`, 2);
} catch (err) {
  fail(err.message);
}

async function serve(dir) {
  const project = loadProject(dir) || {};
  const running = await findServer(dir);
  if (running) {
    console.log(`design-driven-development: "${project.name}" is already served at http://127.0.0.1:${running}/`);
    process.exit(0);
  }
  const first = o.port ? Number(o.port) : FIRST_PORT;
  if (!Number.isInteger(first) || first < 0) fail('--port must be a number', 2);
  const srv = await startServer({ dir, port: first, tries: o.port ? 1 : 20, quiet: false });
  const file = paths(dir).server;
  writeJsonAtomic(file, { port: srv.port, pid: process.pid, startedAt: new Date().toISOString(), url: srv.url });
  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    // Only remove server.json if it is still ours.
    if (readJson(file)?.pid === process.pid) rmSync(file, { force: true });
    await Promise.race([srv.close(), new Promise((r) => setTimeout(r, 500))]);
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  process.on('SIGHUP', stop);
  process.on('exit', () => {
    if (existsSync(file) && readJson(file)?.pid === process.pid) rmSync(file, { force: true });
  });
  console.log(`design-driven-development: "${project.name}" → ${srv.url}`);
  console.log(`design-driven-development: project folder ${dir}`);
  if (!o['no-open']) openBrowser(srv.url);
}

function openBrowser(url) {
  const [bin, ...rest] = process.platform === 'darwin' ? ['open'] : process.platform === 'win32' ? ['cmd', '/c', 'start', ''] : ['xdg-open'];
  try {
    const child = spawn(bin, [...rest, url], { stdio: 'ignore', detached: true });
    child.on('error', () => {});
    child.unref();
  } catch {}
}
