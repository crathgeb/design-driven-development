// The job queue on disk and the context packs. Node built-ins only.
//
// A job is work handed to Claude: one per screen with open marks (or a screen-scoped ask),
// one per unscoped ask, and one per whole-app or flow request (kind "app" or "flow"), which is
// exclusive over the screens it covers (see jobCoverage and the server's runnable()). It lives in jobs/<id>.json; jobs/<id>.md is its context pack,
// everything a background worker needs to do it alone. These functions are synchronous and
// assume the caller serializes writers (the server's queue, or withFileLock in the scripts).

import { copyFileSync, existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { allScreens, describeBoard, findFlow, findScreen, loadBoard, loadNotes, loadProject, logEvent, newId, nowIso, paths, PLUGIN_ROOT, readJson, saveNotes, writeJsonAtomic } from './project.mjs';

export const STATUSES = ['queued', 'offered', 'running', 'done', 'failed'];
export const ACTIVE = new Set(['queued', 'offered', 'running']);

export const jobFile = (dir, id) => join(paths(dir).jobs, `${id}.json`);
export const packFile = (dir, id) => join(paths(dir).jobs, `${id}.md`);

export function loadJobs(dir) {
  const jdir = paths(dir).jobs;
  if (!existsSync(jdir)) return [];
  return readdirSync(jdir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => readJson(join(jdir, f)))
    .filter(Boolean)
    .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)) || String(a.id).localeCompare(String(b.id)));
}

export const loadJob = (dir, id) => (/^j_[a-z0-9]+$/.test(id) ? readJson(jobFile(dir, id)) : null);
export const saveJob = (dir, job) => writeJsonAtomic(jobFile(dir, job.id), job);

/** The scope of an ask: "app", "flow", "screen", or null (a loose ask: Claude decides where). */
export const askScope = (a) => (a.scope === 'app' || a.scope === 'flow' || a.scope === 'screen' ? a.scope : a.screen ? 'screen' : null);

/**
 * The screens a job may change, for exclusivity: { all, screens }. An app job covers every screen
 * (all: true, including screens added while it runs); a flow job its flow's screens; a screen job
 * its screen; a loose ask nothing (it runs alongside everything, as before).
 */
export function jobCoverage(board, job) {
  if (job.kind === 'app') return { all: true, screens: allScreens(board).map(({ screen }) => screen.id) };
  if (job.kind === 'flow') return { all: false, screens: (findFlow(board, job.flow)?.screens || []).map((s) => s.id) };
  if (job.screen) return { all: false, screens: [job.screen] };
  return { all: false, screens: [] };
}

/** Open marks of a screen in notes, as [{ state, mark }]. */
function openMarks(notes, screenId) {
  const out = [];
  for (const [state, s] of Object.entries(notes.screens[screenId]?.states || {})) for (const m of s.marks || []) if ((m.status || 'open') === 'open') out.push({ state, mark: m });
  return out;
}

/**
 * Turn open marks and asks into jobs (POST /api/send, /api/ask).
 *   screen   only this screen's marks and asks
 *   askIds   only these asks (and no marks)
 * One job per screen with open marks or a screen-scoped ask; one per unscoped ask.
 * Marks and asks become "sent" with their job id. Returns the new jobs.
 */
export function createJobs(dir, { screen = null, askIds = null } = {}) {
  const notes = loadNotes(dir);
  const board = loadBoard(dir);
  const at = nowIso();
  const byScreen = new Map(); // screen id → { marks, asks }
  const loose = [];
  const wide = []; // app and flow asks: one job each
  const slot = (id) => byScreen.get(id) || byScreen.set(id, { marks: [], asks: [] }).get(id);

  if (!askIds) {
    const screens = screen ? [screen] : Object.keys(notes.screens);
    for (const id of screens) {
      if (!findScreen(board, id)) continue; // marks on a screen no longer on the board wait
      const marks = openMarks(notes, id);
      if (marks.length) slot(id).marks.push(...marks);
    }
  }
  for (const ask of notes.asks) {
    if ((ask.status || 'open') !== 'open') continue;
    if (askIds && !askIds.includes(ask.id)) continue;
    const scope = askScope(ask);
    if (screen && (scope !== 'screen' || ask.screen !== screen)) continue;
    if (scope === 'app' || (scope === 'flow' && findFlow(board, ask.flow))) wide.push(ask);
    else if (scope === 'screen' && findScreen(board, ask.screen)) slot(ask.screen).asks.push(ask);
    else loose.push(ask);
  }

  const jobs = [];
  const make = (screenId, marks, asks, wideAsk = null) => {
    const kind = wideAsk ? askScope(wideAsk) : marks.length ? 'marks' : 'ask';
    const job = {
      id: newId('j'),
      kind,
      scope: wideAsk ? kind : screenId ? 'screen' : null,
      screen: screenId,
      flow: kind === 'flow' ? wideAsk.flow : null,
      status: 'queued',
      createdAt: at,
      startedAt: null,
      doneAt: null,
      summary: '',
      error: '',
      files: [],
      marks: marks.map(({ state, mark }) => ({ state, ...mark, status: 'sent' })),
      asks: asks.map((a) => ({ ...a, status: 'sent' })),
    };
    for (const { mark } of marks) Object.assign(mark, { status: 'sent', job: job.id });
    for (const a of asks) Object.assign(a, { status: 'sent', job: job.id });
    jobs.push(job);
  };
  for (const [id, { marks, asks }] of byScreen) make(id, marks, asks);
  for (const a of loose) make(null, [], [a]);
  for (const a of wide) make(null, [], [a], a);
  if (!jobs.length) return [];

  saveNotes(dir, notes);
  for (const job of jobs) {
    job.marks = job.marks.map((m) => ({ ...m, job: job.id }));
    job.asks = job.asks.map((a) => ({ ...a, job: job.id }));
    saveJob(dir, job);
    writePack(dir, job);
    logEvent(dir, { type: 'job created', job: job.id, kind: job.kind, screen: job.screen, flow: job.flow, marks: job.marks.length, asks: job.asks.length });
  }
  return jobs;
}

/**
 * Add an ask to notes.json; returns it.
 *   scope "app"            the whole app: every screen
 *   scope "flow" + flow    every screen in one flow
 *   screen                 one screen (scope "screen")
 *   neither                a loose ask: Claude decides where (new screens, new states…)
 */
export function addAsk(dir, { text, screen = null, flow = null, scope = null }) {
  const t = String(text || '').trim();
  if (!t) throw Object.assign(new Error('say what you want'), { status: 400 });
  const notes = loadNotes(dir);
  const board = loadBoard(dir);
  const sc = scope === 'app' ? 'app' : scope === 'flow' || (!scope && flow && !screen) ? 'flow' : screen ? 'screen' : null;
  if (sc === 'flow' && !findFlow(board, flow)) throw Object.assign(new Error(`no flow ${flow}`), { status: 404 });
  if (sc === 'screen' && !findScreen(board, screen)) throw Object.assign(new Error(`no screen ${screen}`), { status: 404 });
  const ask = {
    id: newId('a'),
    text: t.slice(0, 8000),
    scope: sc,
    flow: sc === 'flow' ? flow : null,
    screen: sc === 'screen' ? screen : null,
    status: 'open',
    job: null,
    createdAt: nowIso(),
  };
  notes.asks.push(ask);
  saveNotes(dir, notes);
  return ask;
}

/** Set every mark and ask of a job to a status in notes.json. */
function settle(dir, job, status) {
  const notes = loadNotes(dir);
  const markIds = new Set(job.marks.map((m) => m.id));
  const askIds = new Set(job.asks.map((a) => a.id));
  for (const s of Object.values(notes.screens)) {
    for (const st of Object.values(s.states)) {
      for (const m of st.marks) {
        if (!markIds.has(m.id) || m.job !== job.id) continue;
        m.status = status;
        if (status === 'open') m.job = null;
      }
    }
  }
  for (const a of notes.asks) {
    if (!askIds.has(a.id) || a.job !== job.id) continue;
    a.status = status;
    if (status === 'open') a.job = null;
  }
  saveNotes(dir, notes);
}

const err = (msg, status) => Object.assign(new Error(msg), { status });

/** A worker is about to change files: snapshot the mocks it covers, board.json and theme.css, mark it running. */
export function startJob(dir, id) {
  const job = loadJob(dir, id);
  if (!job) throw err(`no job ${id}`, 404);
  if (job.status === 'done' || job.status === 'failed') throw err(`job ${id} is already ${job.status}`, 409);
  const stamp = nowIso().replace(/[:.]/g, '-');
  const hdir = join(paths(dir).history, `${stamp}-${job.id}`);
  mkdirSync(join(hdir, 'mocks'), { recursive: true });
  const board = loadBoard(dir);
  if (existsSync(paths(dir).board)) copyFileSync(paths(dir).board, join(hdir, 'board.json'));
  if (existsSync(paths(dir).theme)) copyFileSync(paths(dir).theme, join(hdir, 'theme.css'));
  const cover = jobCoverage(board, job);
  const ids = cover.all || (!job.screen && job.kind !== 'flow') ? null : new Set(cover.screens);
  const files = allScreens(board)
    .filter(({ screen }) => !ids || ids.has(screen.id))
    .flatMap(({ screen }) => screen.states.map((s) => s.file));
  for (const f of files) {
    const src = join(dir, f);
    if (existsSync(src)) copyFileSync(src, join(hdir, 'mocks', basename(f)));
  }
  job.status = 'running';
  job.startedAt = job.startedAt || nowIso();
  job.history = hdir;
  saveJob(dir, job);
  logEvent(dir, { type: 'job started', job: id, history: hdir });
  return job;
}

export function finishJob(dir, id, { summary = '', files = [] } = {}) {
  const job = loadJob(dir, id);
  if (!job) throw err(`no job ${id}`, 404);
  if (job.status === 'done') return job;
  job.status = 'done';
  job.doneAt = nowIso();
  job.summary = String(summary || '').replace(/^SUMMARY:\s*/i, '').trim().slice(0, 500);
  job.files = (Array.isArray(files) ? files : String(files || '').split(',')).map((f) => String(f).trim()).filter(Boolean);
  job.error = '';
  saveJob(dir, job);
  settle(dir, job, 'done');
  logEvent(dir, { type: 'job done', job: id, summary: job.summary });
  return job;
}

/** A job failed: its marks and asks go back to open, so the author can send them again. */
export function failJob(dir, id, { error = '' } = {}) {
  const job = loadJob(dir, id);
  if (!job) throw err(`no job ${id}`, 404);
  job.status = 'failed';
  job.doneAt = nowIso();
  job.error = String(error || 'Claude couldn’t finish').trim().slice(0, 800);
  saveJob(dir, job);
  settle(dir, job, 'open');
  logEvent(dir, { type: 'job failed', job: id, error: job.error });
  return job;
}

// ---------- the context pack ----------

const round = (v) => Math.round(Number(v) || 0);
const quote = (s) => `"${String(s).replace(/\s+/g, ' ').trim()}"`;

/** One mark, in words a worker can act on. */
export function describeMark(m) {
  const x = round(m.x), y = round(m.y), w = round(m.w), h = round(m.h);
  let where;
  switch (m.shape) {
    case 'pin': where = `pin at (${x}, ${y})`; break;
    case 'box': where = `box from (${x}, ${y}), ${w}×${h}`; break;
    case 'ellipse': where = `ellipse around (${x}, ${y})–(${x + w}, ${y + h})`; break;
    case 'arrow': {
      const [a, b] = m.points || [[x, y], [x + w, y + h]];
      where = `arrow from (${round(a[0])}, ${round(a[1])}) pointing to (${round(b[0])}, ${round(b[1])})`;
      break;
    }
    case 'pen': where = `freehand stroke over (${x}, ${y})–(${x + w}, ${y + h})`; break;
    default: where = 'note on the whole state';
  }
  const t = m.target?.selector ? ` on \`${m.target.selector}\`${m.target.text ? ` (${quote(m.target.text)})` : ''}` : '';
  return `${m.n ?? '?'}. ${where}${t}: ${m.text ? quote(m.text) : '(no note: look at what it marks)'}`;
}

export function writePack(dir, job) {
  const file = packFile(dir, job.id);
  mkdirSync(paths(dir).jobs, { recursive: true });
  writeFileSync(file, contextPack(dir, job));
  return file;
}

/** Everything a fresh subagent needs to do a job, with absolute paths throughout. */
export function contextPack(dir, job) {
  if (job.kind === 'app' || job.kind === 'flow') return widePack(dir, job);
  const project = loadProject(dir) || {};
  const board = loadBoard(dir);
  const notes = loadNotes(dir);
  const P = PLUGIN_ROOT;
  const boardCmd = `node ${join(P, 'scripts', 'board.mjs')} ${dir}`;
  const hit = job.screen ? findScreen(board, job.screen) : null;
  const L = [];

  L.push(`# design-driven-development job ${job.id}`);
  L.push('');
  L.push(`You are a background worker for design-driven-development. Claude writes **mocks**: static HTML screens, one file per screen *state*, with realistic sample data, laid out on a board the author marks up in the browser. The author ${job.kind === 'marks' ? 'marked up a screen and pressed "Send to Claude"' : 'asked Claude for something'}. Do this job on your own: no one can answer questions mid-job, so decide sensibly, and write anything only the author can decide into the affected state's intent as an open question ("Open question: …").`);
  L.push('');
  L.push('## The project');
  L.push('');
  L.push(`- Name: ${project.name || basename(dir)}`);
  if (project.goal) L.push(`- Goal: ${project.goal}`);
  L.push(`- Project folder: ${dir}`);
  L.push(`- Board (flows → screens → states): ${join(dir, 'board.json')}. Read it; change it only with the board commands below.`);
  if (project.repo) L.push(`- Product repo: ${project.repo}. Read it for context (domain terms, names, real copy, its glossary or product docs); don't change it.`);
  L.push(`- Device: ${project.device || 'phone'} (mocks are 390×844 CSS pixels).`);
  L.push('');
  L.push('Read these before you write anything:');
  L.push(`- How to write a mock: ${join(P, 'skills', 'design-driven-development', 'authoring.md')}`);
  L.push(`- The kit every mock uses: ${join(P, 'kit', 'README.md')} (styles in ${join(P, 'kit', 'mock.css')}, served to mocks as /kit/mock.css; example: ${join(P, 'kit', 'example.html')})`);
  L.push(`- The skeleton of one state: ${join(P, 'templates', 'mock.html')}`);
  L.push(`- The project's theme (its brand, loaded by every mock after the kit): ${paths(dir).theme}`);
  pushAuthorNotes(L, notes);
  L.push('');

  if (hit) {
    const { flow, screen } = hit;
    const sn = notes.screens[screen.id] || { note: '', states: {} };
    L.push(`## The screen: ${screen.title} (\`${screen.id}\`)`);
    L.push('');
    L.push(`- Flow: ${flow.title} (\`${flow.id}\`)${flow.intent ? `: ${flow.intent}` : ''}`);
    L.push(`- Intent (Claude's, from the board): ${screen.intent || '(none yet: write one)'}`);
    if (sn.note) L.push(`- The author's note on this screen: ${quote(sn.note)}`);
    L.push('');
    const marksByState = new Map();
    for (const m of job.marks) (marksByState.get(m.state) || marksByState.set(m.state, []).get(m.state)).push(m);
    for (const st of screen.states) {
      const stn = sn.states?.[st.id];
      L.push(`### State ${st.title} (\`${st.id}\`)`);
      L.push('');
      L.push(`- File: ${join(dir, st.file)}`);
      L.push(`- Intent: ${st.intent || '(none yet: write one)'}`);
      if (stn?.note) L.push(`- The author's note on this state: ${quote(stn.note)}`);
      const ms = marksByState.get(st.id) || [];
      if (ms.length) {
        L.push(`- Marks (coordinates are CSS pixels in the mock's own 390-wide document, y from the top of the page, scrolled content included):`);
        for (const m of ms.sort((a, b) => (a.n || 0) - (b.n || 0))) L.push(`  ${describeMark(m)}`);
      } else L.push('- No marks on this state.');
      L.push('');
    }
    const orphan = job.marks.filter((m) => !screen.states.some((s) => s.id === m.state));
    if (orphan.length) {
      L.push('Marks on states no longer on the board:');
      for (const m of orphan) L.push(`- (${m.state}) ${describeMark(m)}`);
      L.push('');
    }
  }

  if (job.asks.length) {
    L.push(hit ? '## The author also asked' : '## The author asked');
    L.push('');
    for (const a of job.asks) L.push(`- ${quote(a.text)}${a.screen && !hit ? ` (about screen ${a.screen})` : ''}`);
    L.push('');
    if (!hit) L.push('Work out what that needs: changes to existing states, new states, or new screens (add them to the board first with the commands below). Read the screens you touch and keep them consistent with the rest.\n');
  }

  L.push('## The rest of the board (read for consistency; files are absolute paths)');
  L.push('');
  L.push('```');
  L.push(describeBoard(board, dir));
  L.push('```');
  L.push('');

  L.push('## Rules');
  L.push('');
  if (hit) {
    L.push(`- Change only this screen's files (the states above), and add new state files for it when the job needs a new state. Read other screens' mocks to stay consistent; don't edit them.`);
  } else {
    L.push('- Change only the mocks the ask is about, and add screens or states it needs. Read the rest; don\'t edit what the ask doesn\'t touch.');
  }
  L.push(`- Edit the board only through \`${boardCmd} …\` (it keeps parallel workers from clobbering each other). Never write board.json yourself.`);
  L.push('- Every mark gets a response: change the mock, or (when you decide not to) say why in the state\'s intent. Marks refer to elements by selector and text; the coordinates show where on the page.');
  L.push('- Keep sample data realistic and consistent with the other screens (the same people, numbers and wording).');
  L.push('- When the design of a state changes, update its intent (and the screen\'s intent if the key design choice changed).');
  L.push(`- Don't touch ${join(dir, 'notes.json')} (the author's), jobs/, history/ or server.json. Don't start or stop servers: the board reloads changed mocks by itself.`);
  L.push('- Mocks link the kit as /kit/mock.css, then the theme as /theme.css (and /kit/mock.js), and images as /assets/<file> (put new images in ' + join(dir, 'assets') + ').');
  L.push(`- The brand (colours, fonts, radii) lives in ${paths(dir).theme} as kit variables: use the variables, never hard-code what the theme provides. theme.css is shared by every screen: don't change it in this job; if the brand itself should change, say so in your summary.`);
  L.push('');
  pushBoardCommands(L, boardCmd);
  L.push('## When you finish');
  L.push('');
  L.push('End your reply with one line: `SUMMARY: <what changed, one sentence for the author>`.');
  L.push('');
  return L.join('\n');
}

function pushAuthorNotes(L, notes) {
  if (notes.app?.note?.trim()) {
    L.push('');
    L.push('The author\'s design direction for the whole app (brand, tone, type, colour):');
    L.push('');
    L.push(notes.app.note.trim().split('\n').map((l) => `> ${l}`).join('\n'));
  }
  if (notes.general?.trim()) {
    L.push('');
    L.push('The author\'s note on the whole project:');
    L.push('');
    L.push(notes.general.trim().split('\n').map((l) => `> ${l}`).join('\n'));
  }
}

function pushBoardCommands(L, boardCmd) {
  L.push('## Board commands');
  L.push('');
  L.push('```sh');
  L.push(`${boardCmd} show`);
  L.push(`${boardCmd} add-state --screen <screen-id> --id <state-id> --title "<title>" --intent "<why it looks this way>"   # file: mocks/<screen-id>--<state-id>.html`);
  L.push(`${boardCmd} update --screen <screen-id> [--state <state-id>] [--title "<title>"] [--intent "<intent>"]`);
  L.push(`${boardCmd} update --flow <flow-id> [--title "<title>"] [--intent "<intent>"]`);
  L.push(`${boardCmd} add-screen --flow <flow-id> --id <screen-id> --title "<title>" --intent "<intent>"`);
  L.push(`${boardCmd} remove-state --screen <screen-id> --state <state-id>`);
  L.push(`${boardCmd} move --screen <screen-id> --state <state-id> --index <n>   # 0 is first`);
  L.push('```');
  L.push('');
  L.push('Ids are kebab-case. Write the new state\'s HTML file, then add the state to the board.');
  L.push('');
}

/** The pack for a whole-app or flow job: every affected screen and state, the theme, and how to split the work. */
function widePack(dir, job) {
  const project = loadProject(dir) || {};
  const board = loadBoard(dir);
  const notes = loadNotes(dir);
  const P = PLUGIN_ROOT;
  const boardCmd = `node ${join(P, 'scripts', 'board.mjs')} ${dir}`;
  const theme = paths(dir).theme;
  const isApp = job.kind === 'app';
  const flow = isApp ? null : findFlow(board, job.flow);
  const flows = isApp ? board.flows : flow ? [flow] : [];
  const nScreens = flows.reduce((n, f) => n + f.screens.length, 0);
  const nStates = flows.reduce((n, f) => n + f.screens.reduce((m, s) => m + s.states.length, 0), 0);
  const where = isApp ? 'every screen of the app' : `every screen in the flow "${flow?.title || job.flow}"`;
  const L = [];

  L.push(`# design-driven-development ${isApp ? 'whole-app' : 'flow'} job ${job.id}`);
  L.push('');
  L.push(`You are a background worker for design-driven-development. Claude writes **mocks**: static HTML screens, one file per screen *state*, with realistic sample data, laid out on a board the author marks up in the browser. The author made a request that applies to ${where}, not to one screen. While this job runs it has ${isApp ? 'the whole board' : 'these screens'} to itself: no other job changes ${isApp ? 'any screen' : 'them'} until you finish. Do it on your own: no one can answer questions mid-job, so decide sensibly, and write anything only the author can decide into the affected intent as an open question ("Open question: …").`);
  L.push('');
  L.push('## The request');
  L.push('');
  for (const a of job.asks) L.push(a.text.split('\n').map((l) => `> ${l}`).join('\n'));
  pushAuthorNotes(L, notes);
  L.push('');
  L.push('## The project');
  L.push('');
  L.push(`- Name: ${project.name || basename(dir)}`);
  if (project.goal) L.push(`- Goal: ${project.goal}`);
  L.push(`- Project folder: ${dir}`);
  L.push(`- Board (flows → screens → states): ${join(dir, 'board.json')}. Read it; change it only with the board commands below.`);
  if (project.repo) L.push(`- Product repo: ${project.repo}. Read it for context (domain terms, its glossary, real copy, its brand); don't change it.`);
  L.push(`- Device: ${project.device || 'phone'} (mocks are 390×844 CSS pixels).`);
  L.push(`- **The theme: ${theme}**${existsSync(theme) ? '' : ' (not there yet: create it)'}. Every mock links /kit/mock.css and then /theme.css, so this file is the brand of every screen at once.`);
  L.push('');
  L.push('Read these before you change anything:');
  L.push(`- How to write a mock: ${join(P, 'skills', 'design-driven-development', 'authoring.md')}`);
  L.push(`- The kit and its variables (the "Tokens" table): ${join(P, 'kit', 'README.md')} (styles in ${join(P, 'kit', 'mock.css')})`);
  L.push('');
  L.push('## How to do a request for many screens');
  L.push('');
  L.push(`1. **Theme first.** Most look-and-feel requests (colour, warmth, type scale, radii, density, dark mode) are a change to ${theme}: override the kit's variables there (light, and dark under \`:root[data-theme='dark']\` and \`@media (prefers-color-scheme: dark)\`). Prefer that to editing every mock. If the kit has no variable for what you need, add a rule to theme.css that targets the kit class (\`.card { … }\`), still on variables.`);
  L.push('2. **Shared vocabulary.** A rename ("call Drill Practice everywhere") changes the board too: flow, screen and state titles and intents through the board commands, and the words in every mock that shows them. Keep one word for one thing across all screens.');
  L.push('3. **Then the mocks that must change.** Search the files below for what the request touches (a hard-coded colour, a word, a component) and change only those. Remove brand values a mock hard-codes when the theme now provides them.');
  L.push('4. **If more than ~8 mocks need edits, split by flow across subagents, then verify.** Start one background subagent per flow (if you can start subagents; otherwise work through the flows one by one), each with: this pack\'s path, its flow\'s files, exactly what to change, and "change only these files; end with SUMMARY:". Do the theme.css change yourself first, so they build on it. When they finish, check their work.');
  L.push(`5. **Verify.** Render the mocks (\`node ${join(P, 'scripts', 'shoot.mjs')} ${dir} --out <a temp folder>\` writes a PNG of every state) and look at a sample from every flow: nothing overflows 390, text isn't clipped, every screen reads as the same app.`);
  L.push('6. **Keep intents current.** Where a screen\'s or state\'s design changed in a way its intent describes, update the intent (board commands). If the request changes what the app is about, update the flow intents.');
  L.push('');
  L.push(`## The screens this covers (${nScreens} screens, ${nStates} states; files are absolute paths)`);
  L.push('');
  if (!flows.length) L.push(`(The flow \`${job.flow}\` is no longer on the board. Tell the author in your summary.)`);
  for (const f of flows) {
    L.push(`### Flow ${f.title} (\`${f.id}\`)${f.intent ? `: ${f.intent}` : ''}`);
    L.push('');
    for (const sc of f.screens) {
      const sn = notes.screens[sc.id];
      L.push(`- Screen **${sc.title}** (\`${sc.id}\`)${sc.intent ? `: ${sc.intent}` : ''}`);
      if (sn?.note?.trim()) L.push(`  - The author's note: ${quote(sn.note)}`);
      for (const st of sc.states) {
        const stn = sn?.states?.[st.id];
        L.push(`  - State ${st.title} (\`${st.id}\`): ${join(dir, st.file)}${st.intent ? ` — ${st.intent}` : ''}`);
        if (stn?.note?.trim()) L.push(`    - The author's note: ${quote(stn.note)}`);
      }
    }
    L.push('');
  }
  if (!isApp) {
    L.push('## The rest of the board (read for consistency; don\'t edit)');
    L.push('');
    L.push('```');
    L.push(describeBoard({ flows: board.flows.filter((f) => f.id !== job.flow) }, dir));
    L.push('```');
    L.push('');
  }
  L.push('## Rules');
  L.push('');
  if (isApp) L.push(`- You may change ${theme}, any mock above, and the board's titles and intents. Add states or screens only if the request asks for them.`);
  else L.push(`- Change only the mocks above (this flow's). ${theme} is shared by every screen of the app: don't change it for a flow request; if the request needs a new shared style, put it in these mocks on the kit's variables and say in your summary that it could move to the theme.`);
  L.push('- Mocks never hard-code brand colours, fonts or radii the theme provides: they use the variables (`var(--accent)`, `var(--font)`, `var(--r-lg)`).');
  L.push(`- Edit the board only through \`${boardCmd} …\`. Never write board.json yourself.`);
  L.push('- Keep sample data as it is unless the request is about it: the same people, numbers and wording on every screen.');
  L.push(`- Don't touch ${join(dir, 'notes.json')} (the author's), jobs/, history/ or server.json. Don't start or stop servers: the board reloads every mock when theme.css changes, and each mock when its file changes.`);
  L.push('');
  pushBoardCommands(L, boardCmd);
  L.push('## When you finish');
  L.push('');
  L.push('End your reply with one line: `SUMMARY: <what changed, one sentence for the author>`, e.g. "Warmer theme: cream background, terracotta accent, rounder cards; 3 mocks lost hard-coded blues".');
  L.push('');
  return L.join('\n');
}
