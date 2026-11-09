// The project's HTTP server: serves the board UI, the kit and the mocks, keeps notes.json and
// board.json (every write goes through one queue, so parallel workers can't clobber each other),
// turns marks into jobs and offers them to a connected Claude Code session (scripts/listen.mjs).
// Node built-ins only. Loopback only.
//
//   GET  /                     the board (ui/board.html)      GET /ui/*, /kit/* (plugin), /mocks/*, /assets/* (project)
//   GET  /theme.css            the project's theme (an empty stylesheet when it has none)
//   GET  /api/health           { app: "design-driven-development", dir }
//   GET  /api/project          { project, board, notes, jobs, claude }
//   PUT  /api/notes            replace notes.json (marks' and asks' statuses stay the server's)
//   POST /api/board            { op, ... } a board edit (see applyBoardOp)
//   POST /api/send             { screen? } open marks and asks → jobs
//   POST /api/ask              { text, scope?: app|flow|screen, flow?, screen? } an ask, sent at once
//   POST /api/jobs/<id>/start | done { summary, files? } | fail { error }
//   GET  /api/claude/events    SSE for the listener: hello, then jobs
//   POST /api/claude/state     { phase, message }
//   GET  /api/stream           SSE for the board: file, jobs, claude, notes

import { existsSync, readFileSync, statSync, watch } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, relative, resolve, sep } from 'node:path';
import { ACTIVE, addAsk, createJobs, failJob, finishJob, jobCoverage, loadJob, loadJobs, packFile, saveJob, startJob, writePack } from './jobs.mjs';
import { allScreens, APP, applyBoardOp, env, FIRST_PORT, findFlow, findScreen, loadBoard, loadNotes, loadProject, logEvent, normalizeNotes, paths, PLUGIN_ROOT, PORT_TRIES, saveBoard, saveNotes } from './project.mjs';

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.webp': 'image/webp', '.avif': 'image/avif', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.otf': 'font/otf',
  '.mp4': 'video/mp4', '.txt': 'text/plain; charset=utf-8', '.md': 'text/markdown; charset=utf-8',
};
const MAX_BODY = 5 * 1024 * 1024;
const GRACE = () => Number(env('CLAUDE_GRACE_MS')) || 60_000;

/**
 * Start a server for a project folder.
 * @param {object} o
 * @param {string} o.dir      the project folder
 * @param {number} [o.port]   first port to try (default 4490; 0 for any free port)
 * @param {boolean} [o.watch] watch mocks/, assets/ and board.json (default true)
 * @returns {Promise<{ server, port, url, close(): Promise<void> }>}
 */
export async function startServer({ dir, port = FIRST_PORT, tries = PORT_TRIES, watch: watching = true, quiet = true } = {}) {
  const app = createApp({ dir, quiet });
  const server = createServer(app.handle);
  const p = await listen(server, port, tries);
  const url = `http://127.0.0.1:${p}/`;
  app.url = url;
  if (watching) app.watch();
  return {
    server,
    port: p,
    url,
    app,
    close: () =>
      new Promise((ok) => {
        app.stop();
        server.close(() => ok());
        server.closeAllConnections?.();
      }),
  };
}

function listen(server, port, tries) {
  return new Promise((ok, bad) => {
    const attempt = (p, left) => {
      const onErr = (err) => {
        server.off('listening', onListen);
        if (err.code === 'EADDRINUSE' && left > 1 && p !== 0) attempt(p + 1, left - 1);
        else bad(err);
      };
      const onListen = () => {
        server.off('error', onErr);
        ok(server.address().port);
      };
      server.once('error', onErr);
      server.once('listening', onListen);
      server.listen(p, '127.0.0.1');
    };
    attempt(port, tries);
  });
}

export function createApp({ dir, quiet = true }) {
  const say = (m) => !quiet && console.log(`design-driven-development: ${m}`);

  // ---------- one writer at a time ----------
  let chain = Promise.resolve();
  const serial = (fn) => {
    const p = chain.then(() => fn());
    chain = p.catch(() => {});
    return p;
  };

  // ---------- the board's live stream ----------
  const boards = new Set();
  const broadcast = (ev) => {
    const frame = `data: ${JSON.stringify(ev)}\n\n`;
    for (const r of boards) r.write(frame);
  };
  let lastNotes = readNotesText();
  function readNotesText() {
    try {
      return readFileSync(paths(dir).notes, 'utf8');
    } catch {
      return '';
    }
  }
  /** Tell the boards if notes.json changed, with who changed it (a board's client id, or null). */
  function notesChanged(from = null) {
    const now = readNotesText();
    if (now === lastNotes) return;
    lastNotes = now;
    broadcast({ type: 'notes', from, notes: loadNotes(dir) });
  }
  const jobsChanged = () => broadcast({ type: 'jobs', jobs: loadJobs(dir) });

  // ---------- Claude: listeners, offers, state ----------
  const listeners = new Map(); // res → Set of offered job ids
  let lastSeen = 0;
  let claudeState = { phase: 'idle', message: '' };
  const connected = () => listeners.size > 0 || (lastSeen > 0 && Date.now() - lastSeen < GRACE());
  const claude = () => ({ connected: connected(), listening: listeners.size > 0, ...claudeState });
  const claudeChanged = () => broadcast({ type: 'claude', claude: claude() });

  /**
   * Jobs that may be offered now, oldest first. A job holds the screens it covers (jobCoverage): one
   * screen, a flow's screens, or every screen for a whole-app job. A queued job that can't start yet
   * still reserves its screens, so later jobs on them wait behind it (an app job waits for the running
   * screen jobs, and screen jobs sent after it wait for it).
   */
  function runnable() {
    const jobs = loadJobs(dir);
    const board = loadBoard(dir);
    const taken = { all: false, screens: new Set() };
    const clashes = (c) => (c.all ? taken.all || taken.screens.size > 0 : c.screens.some((s) => taken.all || taken.screens.has(s)));
    const take = (c) => {
      if (c.all) taken.all = true;
      for (const s of c.screens) taken.screens.add(s);
    };
    for (const j of jobs) if (j.status === 'offered' || j.status === 'running') take(jobCoverage(board, j));
    const out = [];
    for (const j of jobs) {
      if (j.status !== 'queued') continue;
      const c = jobCoverage(board, j);
      if (!clashes(c)) out.push(j);
      take(c);
    }
    return out;
  }

  /** Offer what can run to the newest listener. */
  function kick() {
    const target = [...listeners.keys()].pop();
    if (!target) return;
    let any = false;
    for (const job of runnable()) {
      const pack = writePack(dir, job); // fresh: the board may have changed since the job was made
      job.status = 'offered';
      job.offeredAt = new Date().toISOString();
      saveJob(dir, job);
      listeners.get(target).add(job.id);
      target.write(`data: ${JSON.stringify(jobEvent(job, pack))}\n\n`);
      any = true;
    }
    if (any) jobsChanged();
  }

  function jobEvent(job, pack) {
    const board = loadBoard(dir);
    const hit = job.screen ? findScreen(board, job.screen) : null;
    const cover = jobCoverage(board, job);
    const ids = new Set(cover.screens);
    return {
      type: 'job',
      id: job.id,
      kind: job.kind,
      scope: job.scope || null,
      screen: job.screen,
      screenTitle: hit?.screen.title || job.screen || null,
      flow: job.flow || null,
      flowTitle: job.flow ? findFlow(board, job.flow)?.title || job.flow : null,
      screens: cover.screens.length,
      states: allScreens(board).filter(({ screen }) => ids.has(screen.id)).reduce((n, { screen }) => n + screen.states.length, 0),
      marks: job.marks.length,
      asks: job.asks.length,
      text: job.asks[0]?.text || null,
      pack,
      dir,
    };
  }

  function attachListener(req, res) {
    res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store', connection: 'keep-alive' });
    const project = loadProject(dir) || {};
    // A new session is offered everything waiting, including offers a session that left never started.
    serial(() => {
      for (const j of loadJobs(dir)) if (j.status === 'offered') saveJob(dir, { ...j, status: 'queued' });
      const waiting = loadJobs(dir).filter((j) => j.status === 'queued').length;
      res.write(`data: ${JSON.stringify({ type: 'hello', name: project.name, slug: project.slug, dir, url: app.url, queued: waiting })}\n\n`);
      listeners.set(res, new Set());
      lastSeen = Date.now();
      kick();
      claudeChanged();
    });
    req.on('close', () => {
      const offered = listeners.get(res) || new Set();
      listeners.delete(res);
      lastSeen = Date.now();
      serial(() => {
        // Offers this session never started go back to the queue for the next one.
        for (const id of offered) {
          const j = loadJob(dir, id);
          if (j?.status === 'offered') saveJob(dir, { ...j, status: 'queued' });
        }
        kick();
        jobsChanged();
        claudeChanged();
      });
      const t = setTimeout(claudeChanged, GRACE() + 50);
      t.unref?.();
    });
  }

  const ping = setInterval(() => {
    for (const r of [...boards, ...listeners.keys()]) r.write(': ping\n\n');
  }, 20_000);
  ping.unref?.();

  // ---------- watching files ----------
  const watchers = [];
  const timers = new Map();
  function emitFile(rel) {
    clearTimeout(timers.get(rel));
    timers.set(
      rel,
      setTimeout(() => {
        timers.delete(rel);
        broadcast({ type: 'file', path: rel });
      }, 120),
    );
  }
  function watchDir(abs, prefix) {
    if (!existsSync(abs)) return false;
    try {
      const w = watch(abs, (_ev, name) => {
        if (!name || /\.tmp$|^\.|~$/.test(name)) return;
        emitFile(prefix + String(name).split(sep).join('/'));
      });
      w.on('error', () => {});
      watchers.push(w);
      return true;
    } catch {
      return false;
    }
  }

  const app = {
    url: null,
    serial,
    kick,
    watch() {
      const p = paths(dir);
      watchDir(p.mocks, 'mocks/');
      let assets = watchDir(p.assets, 'assets/');
      try {
        const w = watch(dir, (_ev, name) => {
          if (name === 'board.json') emitFile('board.json');
          else if (name === 'theme.css') emitFile('theme.css');
          else if (name === 'notes.json') setTimeout(() => notesChanged(null), 60);
          else if (name === 'assets' && !assets) assets = watchDir(p.assets, 'assets/');
        });
        w.on('error', () => {});
        watchers.push(w);
      } catch {}
    },
    stop() {
      clearInterval(ping);
      for (const w of watchers) w.close();
      for (const t of timers.values()) clearTimeout(t);
      for (const r of [...boards, ...listeners.keys()]) r.end();
    },
    handle: async (req, res) => {
      try {
        await route(req, res);
      } catch (err) {
        const status = err.status || (err instanceof SyntaxError ? 400 : 500);
        if (!res.headersSent) send(res, status, String(err.message || err));
        else res.end();
      }
    },
  };

  async function route(req, res) {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/api/health') return json(res, 200, { app: APP, dir });
    // Only requests addressed to this machine by name (blocks DNS rebinding).
    const hostName = (req.headers.host || '').replace(/:\d+$/, '');
    if (!['127.0.0.1', 'localhost'].includes(hostName)) return send(res, 403, 'forbidden');
    const path = decodeURIComponent(url.pathname);
    const m = req.method;
    const body = async () => {
      if (!(req.headers['content-type'] || '').startsWith('application/json')) throw Object.assign(new Error('expected JSON'), { status: 415 });
      const text = await readBody(req);
      return text ? JSON.parse(text) : {};
    };

    // ---------- pages and files ----------
    if (m === 'GET' && (path === '/' || path === '/index.html')) return file(res, join(PLUGIN_ROOT, 'ui', 'board.html'));
    if (m === 'GET' && path.startsWith('/ui/')) return file(res, inside(join(PLUGIN_ROOT, 'ui'), path.slice(4)));
    if (m === 'GET' && path.startsWith('/kit/')) return file(res, inside(join(PLUGIN_ROOT, 'kit'), path.slice(5)));
    if (m === 'GET' && path.startsWith('/mocks/')) return file(res, inside(paths(dir).mocks, path.slice(7)));
    if (m === 'GET' && path.startsWith('/assets/')) return file(res, inside(paths(dir).assets, path.slice(8)));
    if (m === 'GET' && path === '/theme.css') {
      // Every mock links it, so it always answers: the project's theme, or an empty stylesheet.
      const t = paths(dir).theme;
      return send(res, 200, existsSync(t) && statSync(t).isFile() ? readFileSync(t) : '/* no theme.css in this project yet */\n', TYPES['.css']);
    }
    if (path === '/favicon.ico') return send(res, 204, '');

    // ---------- the board's API ----------
    if (m === 'GET' && path === '/api/project') {
      return json(res, 200, { project: loadProject(dir), board: loadBoard(dir), notes: loadNotes(dir), jobs: loadJobs(dir), claude: claude(), dir });
    }
    if (m === 'GET' && path === '/api/stream') {
      res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store', connection: 'keep-alive' });
      res.write(`data: ${JSON.stringify({ type: 'hello', claude: claude() })}\n\n`);
      boards.add(res);
      req.on('close', () => boards.delete(res));
      return;
    }
    if (m === 'PUT' && path === '/api/notes') {
      const incoming = await body();
      if (!incoming || typeof incoming !== 'object' || Array.isArray(incoming)) return send(res, 400, 'expected a JSON object');
      const from = String(req.headers['x-ddd-client'] || '') || null;
      await serial(() => {
        const current = loadNotes(dir);
        if (!('app' in incoming)) incoming.app = current.app; // a board from before the whole-app note
        saveNotes(dir, mergeNotes(current, normalizeNotes(incoming)));
        notesChanged(from);
      });
      return send(res, 204, '');
    }
    if (m === 'POST' && path === '/api/board') {
      const op = await body();
      const out = await serial(() => {
        const board = loadBoard(dir);
        const message = applyBoardOp(board, op);
        saveBoard(dir, board);
        logEvent(dir, { type: 'board', op: op.op, message });
        return { message, board };
      });
      emitFile('board.json');
      return json(res, 200, out);
    }
    if (m === 'POST' && path === '/api/send') {
      const { screen = null } = await body();
      const jobs = await serial(() => {
        const made = createJobs(dir, { screen: screen || null });
        notesChanged(null);
        kick();
        return made;
      });
      jobsChanged();
      say(`${jobs.length} job(s) queued`);
      return json(res, 200, { jobs: jobs.map((j) => loadJob(dir, j.id) || j), connected: connected() });
    }
    if (m === 'POST' && path === '/api/ask') {
      const { text, screen = null, flow = null, scope = null } = await body();
      const out = await serial(() => {
        const ask = addAsk(dir, { text, screen: screen || null, flow: flow || null, scope: scope || null });
        const made = createJobs(dir, { askIds: [ask.id] });
        notesChanged(null);
        kick();
        return { ask, jobs: made };
      });
      jobsChanged();
      return json(res, 200, { ...out, jobs: out.jobs.map((j) => loadJob(dir, j.id) || j), connected: connected() });
    }
    const jm = path.match(/^\/api\/jobs\/(j_[a-z0-9]+)\/(start|done|fail)$/);
    if (m === 'POST' && jm) {
      const [, id, verb] = jm;
      const b = await body();
      const job = await serial(() => {
        const j = verb === 'start' ? startJob(dir, id) : verb === 'done' ? finishJob(dir, id, b) : failJob(dir, id, b);
        for (const set of listeners.values()) if (verb !== 'start') set.delete(id);
        notesChanged(null);
        if (verb !== 'start') kick();
        return j;
      });
      jobsChanged();
      claudeChanged();
      return json(res, 200, job);
    }
    if (m === 'GET' && /^\/api\/jobs\/j_[a-z0-9]+$/.test(path)) {
      const job = loadJob(dir, path.split('/').pop());
      return job ? json(res, 200, { ...job, pack: packFile(dir, job.id) }) : send(res, 404, 'no such job');
    }

    // ---------- Claude ----------
    const local = /^(::ffff:)?127\.|^::1$/.test(req.socket.remoteAddress || '');
    if (m === 'GET' && path === '/api/claude/events') {
      if (!local) return send(res, 403, 'Claude connects from this machine only');
      return attachListener(req, res);
    }
    if (m === 'POST' && path === '/api/claude/state') {
      const { phase, message = '' } = await body();
      if (!['idle', 'working', 'ready', 'error'].includes(phase)) return send(res, 400, 'phase must be idle, working, ready or error');
      claudeState = { phase, message: String(message).slice(0, 300) };
      claudeChanged();
      return send(res, 204, '');
    }

    return send(res, 404, 'not found');
  }

  return app;
}

/**
 * The board saves the whole notes.json; the server owns the status (and job) of every mark and
 * ask it already knows, and keeps asks the board hasn't seen. Everything else (texts, notes, new
 * or deleted marks) is the board's. New marks and asks from the board start open.
 */
export function mergeNotes(server, incoming) {
  const out = incoming;
  const serverMarks = new Map();
  for (const s of Object.values(server.screens)) for (const st of Object.values(s.states)) for (const mk of st.marks) serverMarks.set(mk.id, mk);
  const own = (item, was) => {
    item.status = was ? was.status || 'open' : 'open';
    item.job = was ? was.job ?? null : null;
  };
  for (const s of Object.values(out.screens)) for (const st of Object.values(s.states)) for (const mk of st.marks) own(mk, serverMarks.get(mk.id));
  const serverAsks = new Map(server.asks.map((a) => [a.id, a]));
  const seen = new Set();
  for (const a of out.asks) {
    seen.add(a.id);
    own(a, serverAsks.get(a.id));
  }
  for (const a of server.asks) if (!seen.has(a.id) && a.status !== 'open') out.asks.push(a);
  return out;
}

// ---------- helpers ----------

function inside(root, rel) {
  const f = resolve(root, '.' + '/' + rel);
  if (!f.startsWith(root + sep)) return null;
  if (relative(root, f).split(sep).some((s) => s.startsWith('.'))) return null;
  return f;
}

function file(res, f) {
  if (!f || !existsSync(f) || !statSync(f).isFile()) return send(res, 404, 'not found');
  send(res, 200, readFileSync(f), TYPES[extname(f).toLowerCase()] || 'application/octet-stream');
}

function readBody(req) {
  return new Promise((ok, bad) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        bad(Object.assign(new Error('too large'), { status: 413 }));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => ok(Buffer.concat(chunks).toString('utf8')));
    req.on('error', bad);
  });
}

function send(res, status, body, type = 'text/plain; charset=utf-8') {
  res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
  res.end(body);
}
const json = (res, status, obj) => send(res, status, JSON.stringify(obj), TYPES['.json']);

export { ACTIVE };
