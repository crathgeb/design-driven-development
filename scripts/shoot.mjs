#!/usr/bin/env node
// A PNG of each state of a project's board, at its device's size (lib/devices.mjs: a phone is 390×844,
// a desktop 1440×900, …), 2× pixels up to tablet width and 1× for wider viewports.
// Uses playwright-core when it can be found (see lib/browser.mjs); otherwise says how to install it and skips.
//
//   node shoot.mjs <project> [--out <dir>] [--full]
//       --out   where the PNGs go (default <project>/screens/)
//       --full  the whole scrolled page, not just the first screenful
//
// Serves the project itself on a free port for the duration (no need for a running server).

import { mkdirSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { launchBrowser, loadChromium, MISSING_HELP } from '../lib/browser.mjs';
import { resolveDevice } from '../lib/devices.mjs';
import { allScreens, loadBoard, loadProject, resolveProject } from '../lib/project.mjs';
import { startServer } from '../lib/server.mjs';

/** What to shoot: [{ file, path, viewport: { width, height }, scale, device }], one per state, in board order. */
export function shotPlan(dir, out) {
  const project = loadProject(dir) || {};
  const plan = [];
  for (const { screen } of allScreens(loadBoard(dir))) {
    for (const state of screen.states) {
      const device = resolveDevice(project, screen, state);
      plan.push({
        file: join(out, basename(state.file).replace(/\.html$/, '.png')),
        path: state.file,
        viewport: { width: device.width, height: device.height },
        scale: device.width > 1024 ? 1 : 2,
        device,
      });
    }
  }
  return plan;
}

/** Shoot every state into out. Resolves { shot: [files], skipped: reason | null, help: what to install | null }. */
export async function shoot({ dir, out, full = false }) {
  const chromium = await loadChromium();
  if (!chromium) return { shot: [], skipped: 'playwright-core is not installed', help: MISSING_HELP };
  const browser = await launchBrowser(chromium);
  if (!browser) return { shot: [], skipped: 'no Chromium could be started', help: MISSING_HELP };
  const srv = await startServer({ dir, port: 0, watch: false });
  const shot = [];
  try {
    mkdirSync(out, { recursive: true });
    const pages = new Map(); // one page per viewport and scale
    for (const p of shotPlan(dir, out)) {
      const key = `${p.viewport.width}x${p.viewport.height}@${p.scale}`;
      if (!pages.has(key)) pages.set(key, await browser.newPage({ viewport: p.viewport, deviceScaleFactor: p.scale }));
      const page = pages.get(key);
      const res = await page.goto(srv.url + p.path, { waitUntil: 'load' });
      if (!res || !res.ok()) continue;
      await page.evaluate(() => document.fonts?.ready);
      await page.screenshot({ path: p.file, fullPage: full });
      shot.push(p.file);
    }
  } finally {
    await browser.close();
    await srv.close();
  }
  return { shot, skipped: null, help: null };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let parsed;
  try {
    parsed = parseArgs({ allowPositionals: true, options: { out: { type: 'string' }, full: { type: 'boolean' } } });
  } catch (err) {
    console.error(`shoot: ${err.message}\nusage: node shoot.mjs <project> [--out <dir>] [--full]`);
    process.exit(2);
  }
  const { values: o, positionals: [arg] } = parsed;
  try {
    const dir = resolveProject(arg);
    const out = resolve(o.out || join(dir, 'screens'));
    const r = await shoot({ dir, out, full: !!o.full });
    if (r.skipped) console.log(`shoot: PNG screenshots skipped: ${r.skipped}.${r.help ? ` ${r.help}` : ''}`);
    else console.log(`shoot: ${r.shot.length} screenshot(s) in ${out}`);
  } catch (err) {
    console.error(`shoot: ${err.message}`);
    process.exit(1);
  }
}
