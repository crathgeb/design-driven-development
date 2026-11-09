#!/usr/bin/env node
// Write a project's spec into the product repo. Node built-ins only (screenshots need playwright-core).
//
//   node export.mjs <project> [--out <dir>] [--no-shots]
//
// Default <dir>: <product repo>/docs/design/<slug>/. Writes:
//   index.html   a read-only board that opens from disk (the board UI with the data inlined)
//   ui/          the board's CSS and JS
//   mocks/, kit/, assets/, theme.css   copies (absolute /kit/, /assets/, /mocks/, /theme.css links made relative)
//   board.json, notes.json
//   spec.md      a skeleton with every flow, screen and state and its intent, for Claude to fill in
//                (spec.skeleton.md instead when spec.md already exists, so Claude's text is kept)
//   screens/*.png  when playwright-core is available

import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { describeMark, loadJobs } from '../lib/jobs.mjs';
import { loadBoard, loadNotes, loadProject, logEvent, paths, PLUGIN_ROOT, resolveProject } from '../lib/project.mjs';
import { shoot } from './shoot.mjs';

/** Make a mock's root-relative links work from disk, one folder down from the export root. */
export const relativize = (html) => html.replace(/(["'(=]\s*)\/(kit|assets|mocks)\//g, '$1../$2/').replace(/(["'(=]\s*)\/theme\.css\b/g, '$1../theme.css');

function copyTree(src, dest, transform = null) {
  if (!existsSync(src)) return 0;
  mkdirSync(dest, { recursive: true });
  let n = 0;
  for (const name of readdirSync(src)) {
    if (name.startsWith('.')) continue;
    const s = join(src, name);
    const d = join(dest, name);
    if (statSync(s).isDirectory()) n += copyTree(s, d, transform);
    else {
      if (transform && /\.(html|css)$/i.test(name)) writeFileSync(d, transform(readFileSync(s, 'utf8')));
      else copyFileSync(s, d);
      n++;
    }
  }
  return n;
}

/** The read-only board: ui/board.html with the project's data in a script tag. */
export function staticBoard({ project, board, notes, jobs }) {
  const shell = readFileSync(join(PLUGIN_ROOT, 'ui', 'board.html'), 'utf8');
  const data = JSON.stringify({ project, board, notes, jobs }).replace(/</g, '\\u003c');
  return shell.replace('<script src="ui/board.js"></script>', `<script id="ddd-data" type="application/json">${data}</script>\n  <script src="ui/board.js"></script>`);
}

export function specSkeleton({ project, board, notes }) {
  const L = [];
  const q = (s) => String(s || '').trim();
  L.push(`# ${project.name}`);
  L.push('');
  if (project.goal) L.push(`${project.goal}`, '');
  L.push('<!-- Skeleton written by design-driven-development export.mjs. Claude fills in each section: the experience in words, flow by flow,');
  L.push('     screen by screen, state by state (intent, what is on screen, decisions settled with the author). Replace every TODO;');
  L.push('     the "Material" lists are raw input from the author (resolved marks and notes): fold them into the text, then delete them. -->');
  L.push('');
  L.push('Open `index.html` for the board (every state as a live mock, read-only). Screenshots are in `screens/`.');
  L.push('');
  if (q(notes.general)) L.push('## Context from the author', '', q(notes.general), '');
  if (q(notes.app?.note)) L.push('## Design direction (the author)', '', q(notes.app.note), '');
  L.push('The brand every mock shares (colours, type, radii) is in `theme.css`, on top of the kit in `kit/`.', '');
  L.push('## Overview', '', 'TODO: the experience in a paragraph: who it is for, what they do, and the key design choices.', '');
  for (const flow of board.flows) {
    L.push(`## Flow: ${flow.title}`, '');
    L.push(flow.intent ? `*Intent:* ${flow.intent}` : '*Intent:* TODO', '');
    for (const screen of flow.screens) {
      const sn = notes.screens[screen.id] || { note: '', states: {} };
      L.push(`### Screen: ${screen.title} (\`${screen.id}\`)`, '');
      L.push(screen.intent ? `*Intent:* ${screen.intent}` : '*Intent:* TODO', '');
      if (q(sn.note)) L.push(`*The author:* ${q(sn.note)}`, '');
      for (const state of screen.states) {
        const stn = sn.states?.[state.id] || { note: '', marks: [] };
        const png = state.file.replace(/^mocks\//, 'screens/').replace(/\.html$/, '.png');
        L.push(`#### State: ${state.title} (\`${state.id}\`)`, '');
        L.push(state.intent ? `*Intent:* ${state.intent}` : '*Intent:* TODO', '');
        L.push(`![${screen.title}: ${state.title}](${png}) · [mock](${state.file})`, '');
        L.push("**What's on screen:** TODO", '');
        L.push('**Decisions settled:** TODO', '');
        const material = [];
        if (q(stn.note)) material.push(`- Author's note: ${q(stn.note)}`);
        for (const m of (stn.marks || []).filter((x) => x.status === 'done')) material.push(`- Resolved mark ${describeMark(m)}`);
        if (material.length) L.push('Material:', '', ...material, '');
      }
    }
  }
  L.push('## Open questions', '', 'TODO: anything still undecided.', '');
  return L.join('\n');
}

export async function exportProject({ dir, out = null, shots = true }) {
  const project = loadProject(dir);
  if (!project) throw new Error(`${dir} is not a project folder`);
  const dest = resolve(out || join(project.repo || process.cwd(), 'docs', 'design', project.slug));
  mkdirSync(dest, { recursive: true });
  const board = loadBoard(dir);
  const notes = loadNotes(dir);
  const jobs = loadJobs(dir).filter((j) => j.status === 'done');

  const mocks = copyTree(paths(dir).mocks, join(dest, 'mocks'), relativize);
  copyTree(join(PLUGIN_ROOT, 'kit'), join(dest, 'kit'));
  copyTree(paths(dir).assets, join(dest, 'assets'));
  // Every mock links the theme; an export without one still gets the file, so the link resolves.
  const theme = paths(dir).theme;
  writeFileSync(join(dest, 'theme.css'), existsSync(theme) ? readFileSync(theme, 'utf8').replace(/(["'(]\s*)\/(kit|assets)\//g, '$1$2/') : '/* no project theme */\n'); // it sits at the root, beside kit/ and assets/
  mkdirSync(join(dest, 'ui'), { recursive: true });
  for (const f of ['board.css', 'board.js']) copyFileSync(join(PLUGIN_ROOT, 'ui', f), join(dest, 'ui', f));
  writeFileSync(join(dest, 'board.json'), JSON.stringify(board, null, 2) + '\n');
  writeFileSync(join(dest, 'notes.json'), JSON.stringify(notes, null, 2) + '\n');
  const { repo: _repo, ...publicProject } = project; // the author's local path doesn't belong in the repo
  writeFileSync(join(dest, 'index.html'), staticBoard({ project: publicProject, board, notes, jobs }));

  const specPath = join(dest, 'spec.md');
  const skeletonPath = existsSync(specPath) ? join(dest, 'spec.skeleton.md') : specPath;
  writeFileSync(skeletonPath, specSkeleton({ project, board, notes }));

  let screens = { shot: [], skipped: 'not asked for' };
  if (shots) screens = await shoot({ dir, out: join(dest, 'screens') });
  logEvent(dir, { type: 'export', out: dest, mocks, screens: screens.shot.length });
  return { dest, mocks, spec: skeletonPath, screens };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let parsed;
  try {
    parsed = parseArgs({ allowPositionals: true, options: { out: { type: 'string' }, 'no-shots': { type: 'boolean' } } });
  } catch (err) {
    console.error(`export: ${err.message}\nusage: node export.mjs <project> [--out <dir>] [--no-shots]`);
    process.exit(2);
  }
  const { values: o, positionals: [arg] } = parsed;
  try {
    const dir = resolveProject(arg);
    const r = await exportProject({ dir, out: o.out, shots: !o['no-shots'] });
    const rel = (p) => relative(r.dest, p) || '.';
    console.log(`export: wrote ${r.dest}`);
    console.log(`  index.html (open it from disk), ${r.mocks} mock file(s), board.json, notes.json`);
    console.log(`  ${rel(r.spec)}${r.spec.endsWith('skeleton.md') ? ' (spec.md exists and was kept; merge the skeleton into it)' : ' (a skeleton: fill it in)'}`);
    console.log(r.screens.skipped ? `  PNG screenshots skipped: ${r.screens.skipped}.${r.screens.help ? ` ${r.screens.help}` : ''}` : `  ${r.screens.shot.length} screenshot(s) in screens/`);
  } catch (err) {
    console.error(`export: ${err.message}`);
    process.exit(1);
  }
}
