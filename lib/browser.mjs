// Finding a headless Chromium for screenshots (shoot.mjs, export.mjs).
// playwright-core is optional (an optionalDependency): resolved from $DDD_PLAYWRIGHT (a playwright-core
// folder) when set, then normally from the plugin's node_modules. Returns null when it isn't there, so
// callers skip screenshots and print MISSING_HELP.

import { existsSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { env, PLUGIN_ROOT } from './project.mjs';

/** What to tell the author when screenshots can't be taken. */
export const MISSING_HELP =
  `To get them, install playwright-core and a headless Chromium: ` +
  `npm install --prefix "${PLUGIN_ROOT}" && node "${join(PLUGIN_ROOT, 'node_modules', 'playwright-core', 'cli.js')}" install --only-shell chromium`;

/** playwright-core's chromium, or null. */
export async function loadChromium() {
  const dir = env('PLAYWRIGHT');
  if (dir) {
    try {
      const entry = createRequire(join(dir, 'package.json')).resolve(dir);
      const mod = await import(pathToFileURL(entry).href);
      const chromium = mod.chromium || mod.default?.chromium;
      if (chromium) return chromium;
    } catch {}
  }
  try {
    const mod = await import('playwright-core');
    return mod.chromium || mod.default?.chromium || null;
  } catch {
    return null;
  }
}

/** Playwright's browser cache: $PLAYWRIGHT_BROWSERS_PATH, else its per-platform default. */
function browserCache() {
  const set = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (set && set !== '0') return set;
  if (process.platform === 'darwin') return join(homedir(), 'Library', 'Caches', 'ms-playwright');
  if (process.platform === 'win32') return join(process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local'), 'ms-playwright');
  return join(process.env.XDG_CACHE_HOME || join(homedir(), '.cache'), 'ms-playwright');
}

/**
 * Chromium executables to try when the one matching playwright-core's version isn't installed: any other
 * Chromium or headless shell playwright downloaded before (newest first), then a system Chrome.
 */
function executables() {
  const out = [];
  if (process.env.CHROME_PATH) out.push(process.env.CHROME_PATH);
  const cache = browserCache();
  if (existsSync(cache)) {
    const rev = (d) => Number(d.split('-').pop());
    const dirs = readdirSync(cache).filter((d) => /^chromium(_headless_shell)?-\d+$/.test(d)).sort((a, b) => rev(b) - rev(a));
    for (const d of dirs) {
      const base = join(cache, d);
      for (const sub of existsSync(base) ? readdirSync(base) : []) {
        const p = join(base, sub);
        out.push(
          join(p, 'chrome-headless-shell'), join(p, 'chrome-headless-shell.exe'), // headless shell (mac, linux / windows)
          join(p, 'Google Chrome for Testing.app', 'Contents', 'MacOS', 'Google Chrome for Testing'),
          join(p, 'Chromium.app', 'Contents', 'MacOS', 'Chromium'),
          join(p, 'chrome'), join(p, 'chrome.exe'),
        );
      }
    }
  }
  if (process.platform === 'darwin') out.push('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Chromium.app/Contents/MacOS/Chromium');
  else if (process.platform === 'win32') {
    for (const root of [process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)'], process.env.LOCALAPPDATA].filter(Boolean)) {
      out.push(join(root, 'Google', 'Chrome', 'Application', 'chrome.exe'));
    }
  } else out.push('/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable');
  return out.filter((p) => existsSync(p));
}

/** A launched browser, or null when none can start. */
export async function launchBrowser(chromium) {
  if (!chromium) return null;
  try {
    return await chromium.launch({ headless: true });
  } catch {}
  for (const executablePath of executables()) {
    try {
      return await chromium.launch({ headless: true, executablePath });
    } catch {}
  }
  return null;
}
