// Shared test helpers: a temp DDD_HOME and repo, a small project with mocks, running the scripts,
// and HTTP calls to an in-process server.
import { execFile, execFileSync, spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyBoardOp, initProject, loadBoard, saveBoard, writeJsonAtomic } from '../lib/project.mjs';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const script = (name) => join(ROOT, 'scripts', name);

/** A fresh $DDD_HOME and a git repo to own the project. Sets process.env.DDD_HOME. */
export function sandbox() {
  const base = mkdtempSync(join(tmpdir(), 'ddd-test-'));
  const home = join(base, 'home');
  const repo = join(base, 'product-app');
  mkdirSync(repo, { recursive: true });
  execFileSync('git', ['init', '-q'], { cwd: repo });
  process.env.DDD_HOME = home;
  process.env.DDD_CLAUDE_GRACE_MS = '200';
  return { base, home, repo, env: { ...process.env, DDD_HOME: home, DDD_LISTEN_RETRY_MS: '200', DDD_CLAUDE_GRACE_MS: '200' } };
}

const mock = (title) => `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title></head>
<body style="margin:0;font-family:system-ui"><main><h1 id="title">${title}</h1><div class="card"><button class="btn">Keep going</button></div><div class="card"><button class="btn primary">Done</button></div></main></body></html>\n`;

/** A project with two flows, three screens and four states, each with a mock file. */
export function makeProject(repo) {
  const { dir } = initProject({ name: 'Threads for broad Questions', repo, goal: 'Let learners build a Thread from pieces.' });
  const board = loadBoard(dir);
  const ops = [
    { op: 'add-flow', id: 'build-thread', title: 'Build a Thread', intent: 'Pick pieces and order them.' },
    { op: 'add-flow', id: 'review', title: 'Review', intent: 'Look back.' },
    { op: 'add-screen', flow: 'build-thread', id: 'thread-composer', title: 'Thread composer', intent: 'Where pieces come together.' },
    { op: 'add-screen', flow: 'build-thread', id: 'piece-picker', title: 'Piece picker', intent: 'Choose a piece.' },
    { op: 'add-screen', flow: 'review', id: 'history', title: 'History', intent: 'Past threads.' },
    { op: 'add-state', screen: 'thread-composer', id: 'empty', title: 'No pieces yet', intent: 'Invite the first pick.' },
    { op: 'add-state', screen: 'thread-composer', id: 'two-pieces', title: 'Two pieces picked', intent: 'Show order.' },
    { op: 'add-state', screen: 'piece-picker', id: 'default', title: 'Default', intent: 'A list.' },
    { op: 'add-state', screen: 'history', id: 'default', title: 'Default', intent: 'A list of threads.' },
  ];
  for (const op of ops) applyBoardOp(board, op);
  saveBoard(dir, board);
  for (const f of board.flows) for (const s of f.screens) for (const st of s.states) writeFileSync(join(dir, st.file), mock(`${s.title}: ${st.title}`));
  return dir;
}

/** A mark as the board would store it. */
export const mark = (id, n, extra = {}) => ({
  id, n, shape: 'box', x: 10, y: 20, w: 100, h: 40, points: [], text: `note ${n}`,
  target: { selector: 'main > .card:nth-of-type(2) > .btn', text: 'Done', rect: [16, 120, 80, 36] },
  status: 'open', job: null, createdAt: new Date().toISOString(), ...extra,
});

export function run(name, args, { env, cwd } = {}) {
  return new Promise((ok) => {
    execFile(process.execPath, [script(name), ...args], { env, cwd, encoding: 'utf8' }, (err, stdout, stderr) => ok({ code: err ? err.code ?? 1 : 0, stdout, stderr }));
  });
}

export function spawnScript(name, args, { env } = {}) {
  const proc = spawn(process.execPath, [script(name), ...args], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  proc.stdout.on('data', (d) => (out += d));
  proc.stderr.on('data', (d) => (out += d));
  return {
    proc,
    output: () => out,
    waitFor: (re, ms = 5000) =>
      new Promise((ok, bad) => {
        const until = Date.now() + ms;
        const tick = () => {
          if (re.test(out)) return ok(out);
          if (Date.now() > until) return bad(new Error(`timed out waiting for ${re}; got:\n${out}`));
          setTimeout(tick, 25);
        };
        tick();
      }),
    stop: () => proc.kill(),
  };
}

/** Let the scripts find an in-process server, as ddd.mjs serve would. */
export const announce = (dir, port) => writeJsonAtomic(join(dir, 'server.json'), { port, pid: process.pid, startedAt: new Date().toISOString() });

export async function http(url, method = 'GET', body) {
  const res = await fetch(url, { method, headers: body === undefined ? {} : { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {}
  return { status: res.status, json, text };
}
