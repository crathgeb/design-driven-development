// A design-driven-development project on disk: where projects live, reading and writing project.json,
// board.json and notes.json (atomically), ids, and the board edits (pure functions over the board).
// Node built-ins only.
//
// Projects live in $DDD_HOME/projects/<repo>/<slug>/ ($DDD_HOME defaults to ~/.design-driven-development),
// where <repo> is the basename of the git root of the directory Claude was started in.
//
// The plugin used to be called design-first-spec: its DFS_* environment variables are still read when the
// DDD_* ones aren't set, and its home (~/.design-first-spec) is used while ~/.design-driven-development
// doesn't exist yet (homeNote() says how to move it).

import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const PLUGIN_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const FIRST_PORT = 4490;
export const PORT_TRIES = 20;
export const APP = 'design-driven-development';
// A server started by the plugin under its old name serves the same project folders; scripts recognise it too.
export const LEGACY_APP = 'design-first-spec';

/** An environment setting: DDD_<name>, else the old DFS_<name>. */
export const env = (name, vars = process.env) => vars[`DDD_${name}`] || vars[`DFS_${name}`] || undefined;

export const HOME_DIR = '.design-driven-development';
export const LEGACY_HOME_DIR = '.design-first-spec';

/** Where projects live, and whether that is the old home: { dir, legacy }. */
export function resolveHome({ vars = process.env, home = homedir() } = {}) {
  const set = env('HOME', vars);
  if (set) return { dir: resolve(set), legacy: false };
  const dir = join(home, HOME_DIR);
  const old = join(home, LEGACY_HOME_DIR);
  if (!existsSync(dir) && existsSync(old)) return { dir: old, legacy: true };
  return { dir, legacy: false };
}

export const dddHome = () => resolveHome().dir;

/**
 * A one-time note when projects still live in the old home, or null. Shown once: a marker file in the
 * old home records that it was.
 */
export function homeNote(opts) {
  const { dir, legacy } = resolveHome(opts);
  if (!legacy) return null;
  const marker = join(dir, '.rename-noted');
  if (existsSync(marker)) return null;
  try {
    writeFileSync(marker, `${nowIso()}\n`);
  } catch {}
  return `note: projects are still in ~/${LEGACY_HOME_DIR} (from when this plugin was called design-first-spec). To move them: mv ~/${LEGACY_HOME_DIR} ~/${HOME_DIR}`;
}
export const projectsRoot = () => join(dddHome(), 'projects');
export const nowIso = () => new Date().toISOString();

// ---------- ids ----------

const ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const isId = (s) => typeof s === 'string' && s.length <= 60 && ID_RE.test(s);

export function slugify(name) {
  return String(name)
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/, '') || 'project';
}

/** A short random id with a prefix: j_k3j2x9, m_…, a_… */
export const newId = (prefix) => `${prefix}_${Math.random().toString(36).slice(2, 8)}${Date.now().toString(36).slice(-3)}`;

// ---------- files ----------

export function readJson(file, fallback = null) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

/** Write JSON through a temp file and a rename, so a reader never sees half a file. */
export function writeJsonAtomic(file, data) {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Math.random().toString(36).slice(2, 7)}.tmp`;
  writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n');
  renameSync(tmp, file);
}

export const paths = (dir) => ({
  project: join(dir, 'project.json'),
  board: join(dir, 'board.json'),
  notes: join(dir, 'notes.json'),
  server: join(dir, 'server.json'),
  log: join(dir, 'log.jsonl'),
  mocks: join(dir, 'mocks'),
  assets: join(dir, 'assets'),
  jobs: join(dir, 'jobs'),
  history: join(dir, 'history'),
  theme: join(dir, 'theme.css'),
});

export const emptyNotes = () => ({ general: '', app: { note: '' }, screens: {}, asks: [] });

/** What `ddd.mjs init` writes to a new project's theme.css. */
export const THEME_STARTER = `/* Project theme: the brand for every mock in this project. Served as /theme.css and linked by every
   mock right after /kit/mock.css, so whatever is here overrides the kit.
   Override the kit's CSS variables (kit/README.md, "Tokens"): colours, fonts, radii, spacing, and their
   dark values under :root[data-theme='dark'] and @media (prefers-color-scheme: dark).
   Mocks never hard-code what this file provides; whole-app requests ("make it feel warmer") change this
   file first, and mocks only where a variable can't. */
:root {
}
`;

export const loadProject = (dir) => readJson(paths(dir).project);
export const loadBoard = (dir) => normalizeBoard(readJson(paths(dir).board, { flows: [] }));
export const loadNotes = (dir) => normalizeNotes(readJson(paths(dir).notes, emptyNotes()));
export const saveBoard = (dir, board) => {
  writeJsonAtomic(paths(dir).board, board);
  touchProject(dir);
};
export const saveNotes = (dir, notes) => writeJsonAtomic(paths(dir).notes, normalizeNotes(notes));

export function touchProject(dir) {
  const p = loadProject(dir);
  if (p) writeJsonAtomic(paths(dir).project, { ...p, updatedAt: nowIso() });
}

export function normalizeBoard(b) {
  const board = b && typeof b === 'object' ? b : {};
  board.flows = Array.isArray(board.flows) ? board.flows : [];
  for (const f of board.flows) {
    f.screens = Array.isArray(f.screens) ? f.screens : [];
    for (const s of f.screens) s.states = Array.isArray(s.states) ? s.states : [];
  }
  return board;
}

export function normalizeNotes(n) {
  const notes = n && typeof n === 'object' && !Array.isArray(n) ? n : {};
  if (typeof notes.general !== 'string') notes.general = '';
  if (!notes.screens || typeof notes.screens !== 'object') notes.screens = {};
  if (!Array.isArray(notes.asks)) notes.asks = [];
  if (!notes.app || typeof notes.app !== 'object' || Array.isArray(notes.app)) notes.app = { note: '' };
  if (typeof notes.app.note !== 'string') notes.app.note = '';
  for (const s of Object.values(notes.screens)) {
    if (typeof s.note !== 'string') s.note = '';
    if (!s.states || typeof s.states !== 'object') s.states = {};
    for (const st of Object.values(s.states)) {
      if (typeof st.note !== 'string') st.note = '';
      if (!Array.isArray(st.marks)) st.marks = [];
    }
  }
  return notes;
}

/** One line in log.jsonl. */
export function logEvent(dir, event) {
  try {
    appendFileSync(paths(dir).log, JSON.stringify({ at: nowIso(), ...event }) + '\n');
  } catch {}
}

/** A lock for writers outside the server (board.mjs, job.mjs with no server): a directory made atomically. */
export async function withFileLock(dir, fn) {
  const lock = join(dir, '.lock');
  const until = Date.now() + 5000;
  for (;;) {
    try {
      mkdirSync(lock);
      break;
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
      // A lock older than 10 s belongs to a process that died.
      try {
        if (Date.now() - statSync(lock).mtimeMs > 10_000) rmSync(lock, { recursive: true, force: true });
      } catch {}
      if (Date.now() > until) throw new Error(`the project is locked (${lock}); try again`);
      await new Promise((r) => setTimeout(r, 25));
    }
  }
  try {
    return await fn();
  } finally {
    rmSync(lock, { recursive: true, force: true });
  }
}

// ---------- repos and projects ----------

/** The product repo for a directory: its git root, or the directory itself. */
export function repoRoot(from = process.cwd()) {
  try {
    return execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: from, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || resolve(from);
  } catch {
    return resolve(from);
  }
}

export const isProjectDir = (dir) => existsSync(join(dir, 'project.json'));

/** Create a project. Returns { dir, project, created }. An existing project with that slug is returned as is. */
export function initProject({ name, repo, goal = '', home } = {}) {
  if (!name || !String(name).trim()) throw new Error('the project needs a name');
  const repoPath = repoRoot(repo || process.cwd());
  const slug = slugify(name);
  const dir = join(home ? join(home, 'projects') : projectsRoot(), basename(repoPath), slug);
  if (isProjectDir(dir)) return { dir, project: loadProject(dir), created: false };
  const p = paths(dir);
  mkdirSync(p.mocks, { recursive: true });
  const at = nowIso();
  const project = { slug, name: String(name).trim(), goal, repo: repoPath, createdAt: at, updatedAt: at, device: 'phone' };
  writeJsonAtomic(p.project, project);
  writeJsonAtomic(p.board, { flows: [] });
  writeJsonAtomic(p.notes, emptyNotes());
  writeFileSync(p.theme, THEME_STARTER);
  logEvent(dir, { type: 'project created', slug });
  return { dir, project, created: true };
}

/** Every project, newest first: [{ dir, repoName, project }]. */
export function listProjects({ repoName = null } = {}) {
  const root = projectsRoot();
  if (!existsSync(root)) return [];
  const out = [];
  for (const r of readdirSync(root)) {
    if (repoName && r !== repoName) continue;
    const rdir = join(root, r);
    if (!statSync(rdir).isDirectory()) continue;
    for (const s of readdirSync(rdir)) {
      const dir = join(rdir, s);
      if (isProjectDir(dir)) out.push({ dir, repoName: r, project: loadProject(dir) });
    }
  }
  return out.sort((a, b) => String(b.project?.updatedAt).localeCompare(String(a.project?.updatedAt)));
}

/**
 * A project folder from what the user typed: a path to it, a slug in the current repo,
 * or a slug that is unique across all repos.
 */
export function resolveProject(arg, { cwd = process.cwd() } = {}) {
  if (!arg) throw new Error('which project? pass its slug or folder');
  const asPath = resolve(cwd, arg);
  if (isProjectDir(asPath)) return asPath;
  const here = join(projectsRoot(), basename(repoRoot(cwd)), arg);
  if (isProjectDir(here)) return here;
  const any = listProjects().filter((p) => basename(p.dir) === arg);
  if (any.length === 1) return any[0].dir;
  if (any.length > 1) throw new Error(`more than one project is called ${arg}: ${any.map((p) => p.dir).join(', ')}; pass the folder`);
  throw new Error(`no project ${arg} (looked in ${here})`);
}

// ---------- the board ----------

export function findScreen(board, id) {
  for (const flow of board.flows) {
    const screen = flow.screens.find((s) => s.id === id);
    if (screen) return { flow, screen };
  }
  return null;
}

export function findState(board, screenId, stateId) {
  const hit = findScreen(board, screenId);
  const state = hit?.screen.states.find((s) => s.id === stateId);
  return state ? { ...hit, state } : null;
}

export const allScreens = (board) => board.flows.flatMap((flow) => flow.screens.map((screen) => ({ flow, screen })));

/** The flow with this id, or null. */
export const findFlow = (board, id) => board.flows.find((f) => f.id === id) || null;

export const stateFile = (screen, state) => `mocks/${screen}--${state}.html`;

class BoardError extends Error {
  constructor(msg, status = 400) {
    super(msg);
    this.status = status;
  }
}

const needId = (v, what) => {
  if (!isId(v)) throw new BoardError(`${what} must be a kebab-case id (a-z, 0-9, dashes), got ${JSON.stringify(v ?? null)}`);
  return v;
};
const insertAt = (arr, item, index) => {
  const i = index == null || index === '' || Number.isNaN(Number(index)) ? arr.length : Math.max(0, Math.min(arr.length, Number(index)));
  arr.splice(i, 0, item);
};
const text = (v) => (v == null ? '' : String(v));

export const BOARD_OPS = ['add-flow', 'add-screen', 'add-state', 'update', 'remove-state', 'remove-screen', 'remove-flow', 'move'];

/**
 * Apply one edit to a board, in place. Returns a short description of what changed.
 * Ops (fields):
 *   add-flow     id, title, intent?, index?
 *   add-screen   flow, id, title, intent?, index?
 *   add-state    screen, id, title, intent?, file? (default mocks/<screen>--<id>.html), index?
 *   update       flow | screen [+ state], title?, intent?
 *   remove-state screen, state (or id)
 *   remove-screen screen (or id)               with its states (their mock files stay on disk)
 *   remove-flow  flow (or id)                  with its screens
 *   move         flow, index                     a flow
 *                screen, [toFlow], index         a screen (to another flow)
 *                screen, state, index            a state within its screen
 */
export function applyBoardOp(board, op) {
  normalizeBoard(board);
  const o = op || {};
  switch (o.op) {
    case 'add-flow': {
      needId(o.id, 'the flow id');
      if (board.flows.some((f) => f.id === o.id)) throw new BoardError(`there is already a flow ${o.id}`, 409);
      insertAt(board.flows, { id: o.id, title: text(o.title) || o.id, intent: text(o.intent), screens: [] }, o.index);
      return `added flow ${o.id}`;
    }
    case 'add-screen': {
      needId(o.flow, 'the flow');
      needId(o.id, 'the screen id');
      const flow = board.flows.find((f) => f.id === o.flow);
      if (!flow) throw new BoardError(`no flow ${o.flow}`, 404);
      if (findScreen(board, o.id)) throw new BoardError(`there is already a screen ${o.id} (screen ids are unique across the board)`, 409);
      insertAt(flow.screens, { id: o.id, title: text(o.title) || o.id, intent: text(o.intent), states: [] }, o.index);
      return `added screen ${o.id} to ${o.flow}`;
    }
    case 'add-state': {
      needId(o.screen, 'the screen');
      needId(o.id, 'the state id');
      const hit = findScreen(board, o.screen);
      if (!hit) throw new BoardError(`no screen ${o.screen}`, 404);
      if (hit.screen.states.some((s) => s.id === o.id)) throw new BoardError(`screen ${o.screen} already has a state ${o.id}`, 409);
      const file = o.file ? String(o.file) : stateFile(o.screen, o.id);
      if (!/^mocks\/[^/\\]+\.html$/.test(file)) throw new BoardError(`a state's file must be mocks/<name>.html, got ${file}`);
      insertAt(hit.screen.states, { id: o.id, title: text(o.title) || o.id, intent: text(o.intent), file }, o.index);
      return `added state ${o.screen}/${o.id}`;
    }
    case 'update': {
      if (o.title == null && o.intent == null) throw new BoardError('update needs a title or an intent');
      let target;
      if (o.screen) {
        needId(o.screen, 'the screen');
        const hit = findScreen(board, o.screen);
        if (!hit) throw new BoardError(`no screen ${o.screen}`, 404);
        target = hit.screen;
        if (o.state) {
          needId(o.state, 'the state');
          target = hit.screen.states.find((s) => s.id === o.state);
          if (!target) throw new BoardError(`screen ${o.screen} has no state ${o.state}`, 404);
        }
      } else if (o.flow) {
        needId(o.flow, 'the flow');
        target = board.flows.find((f) => f.id === o.flow);
        if (!target) throw new BoardError(`no flow ${o.flow}`, 404);
      } else throw new BoardError('update needs a flow, or a screen (and optionally a state)');
      if (o.title != null) target.title = text(o.title);
      if (o.intent != null) target.intent = text(o.intent);
      return `updated ${o.screen ? o.screen + (o.state ? '/' + o.state : '') : o.flow}`;
    }
    case 'remove-state': {
      const id = o.state || o.id;
      needId(o.screen, 'the screen');
      needId(id, 'the state');
      const hit = findScreen(board, o.screen);
      if (!hit) throw new BoardError(`no screen ${o.screen}`, 404);
      const i = hit.screen.states.findIndex((s) => s.id === id);
      if (i < 0) throw new BoardError(`screen ${o.screen} has no state ${id}`, 404);
      hit.screen.states.splice(i, 1);
      return `removed state ${o.screen}/${id}`;
    }
    case 'remove-screen': {
      const id = o.screen || o.id;
      needId(id, 'the screen');
      const hit = findScreen(board, id);
      if (!hit) throw new BoardError(`no screen ${id}`, 404);
      hit.flow.screens.splice(hit.flow.screens.indexOf(hit.screen), 1);
      return `removed screen ${id}`;
    }
    case 'remove-flow': {
      const id = o.flow || o.id;
      needId(id, 'the flow');
      const i = board.flows.findIndex((f) => f.id === id);
      if (i < 0) throw new BoardError(`no flow ${id}`, 404);
      board.flows.splice(i, 1);
      return `removed flow ${id}`;
    }
    case 'move': {
      if (o.index == null || o.index === '' || Number.isNaN(Number(o.index))) throw new BoardError('move needs an index (0 is first)');
      if (o.screen && o.state) {
        const hit = findScreen(board, o.screen);
        if (!hit) throw new BoardError(`no screen ${o.screen}`, 404);
        const i = hit.screen.states.findIndex((s) => s.id === o.state);
        if (i < 0) throw new BoardError(`screen ${o.screen} has no state ${o.state}`, 404);
        const [st] = hit.screen.states.splice(i, 1);
        insertAt(hit.screen.states, st, o.index);
        return `moved state ${o.screen}/${o.state}`;
      }
      if (o.screen) {
        const hit = findScreen(board, o.screen);
        if (!hit) throw new BoardError(`no screen ${o.screen}`, 404);
        const to = o.toFlow ? board.flows.find((f) => f.id === o.toFlow) : hit.flow;
        if (!to) throw new BoardError(`no flow ${o.toFlow}`, 404);
        hit.flow.screens.splice(hit.flow.screens.indexOf(hit.screen), 1);
        insertAt(to.screens, hit.screen, o.index);
        return `moved screen ${o.screen}`;
      }
      if (o.flow) {
        const i = board.flows.findIndex((f) => f.id === o.flow);
        if (i < 0) throw new BoardError(`no flow ${o.flow}`, 404);
        const [f] = board.flows.splice(i, 1);
        insertAt(board.flows, f, o.index);
        return `moved flow ${o.flow}`;
      }
      throw new BoardError('move needs a flow, a screen, or a screen and a state');
    }
    default:
      throw new BoardError(`unknown op ${JSON.stringify(o.op ?? null)}; one of ${BOARD_OPS.join(', ')}`);
  }
}

/** The board as an indented outline, for people and workers. */
export function describeBoard(board, dir = null) {
  const lines = [];
  for (const f of board.flows) {
    lines.push(`flow ${f.id}: ${f.title}${f.intent ? ` — ${f.intent}` : ''}`);
    for (const s of f.screens) {
      lines.push(`  screen ${s.id}: ${s.title}${s.intent ? ` — ${s.intent}` : ''}`);
      for (const st of s.states) lines.push(`    state ${st.id}: ${st.title} (${dir ? join(dir, st.file) : st.file})${st.intent ? ` — ${st.intent}` : ''}`);
    }
  }
  return lines.join('\n') || '(the board is empty)';
}
