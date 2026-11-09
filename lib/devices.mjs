// Devices: the viewport a mock is designed for. Presets (phone, tablet, desktop, laptop) or a custom size.
// A project has a default device (project.json "device"); a screen or a state in board.json may override it
// ("device" on the screen or state). A state's beats its screen's, which beats the project's, so one board
// can hold a responsive design (a screen with a phone state and a desktop state).
//
// resolveDevice() is the one place a state's device is worked out; the server sends its results to the
// board UI (/api/project "devices"), export inlines them, and shoot, the context packs and describeBoard
// use it directly. Node built-ins only (none, in fact).

export const PRESETS = {
  phone: { width: 390, height: 844, label: 'Phone' },
  tablet: { width: 820, height: 1180, label: 'Tablet' },
  laptop: { width: 1280, height: 800, label: 'Laptop' },
  desktop: { width: 1440, height: 900, label: 'Desktop' },
};
export const PRESET_NAMES = Object.keys(PRESETS);
export const DEFAULT_DEVICE = 'phone';
/** Values that remove a screen's or state's override, so it inherits again. */
export const INHERIT = ['inherit', 'default', 'none'];

const MIN = 200;
const MAX = 4000;

export class DeviceError extends Error {
  constructor(msg) {
    super(msg);
    this.status = 400;
  }
}

const HELP = `a device is one of ${PRESET_NAMES.join(', ')}, or a size like 1366x768`;

/**
 * A device as it is stored: a preset name, or { width, height, label? }. Accepts a preset name, "WxH"
 * (also "W×H" and "W*H"), or an object. Throws a DeviceError on anything else.
 */
export function parseDevice(input) {
  if (typeof input === 'string') {
    const s = input.trim().toLowerCase();
    if (PRESETS[s]) return s;
    const m = s.match(/^(\d{2,5})\s*[x×*]\s*(\d{2,5})$/);
    if (m) return checkSize({ width: Number(m[1]), height: Number(m[2]) });
    throw new DeviceError(`unknown device ${JSON.stringify(input)}: ${HELP}`);
  }
  if (input && typeof input === 'object' && !Array.isArray(input)) {
    if (input.name && PRESETS[input.name] && input.width == null && input.height == null) return input.name;
    const out = checkSize({ width: Number(input.width), height: Number(input.height) });
    if (input.label != null && String(input.label).trim()) out.label = String(input.label).trim().slice(0, 40);
    return out;
  }
  throw new DeviceError(`no device given: ${HELP}`);
}

function checkSize({ width, height }) {
  for (const [k, v] of [['width', width], ['height', height]]) {
    if (!Number.isInteger(v) || v < MIN || v > MAX) throw new DeviceError(`a device's ${k} must be a whole number of CSS pixels from ${MIN} to ${MAX}, got ${v}`);
  }
  return { width, height };
}

/** True when a value asks to drop an override. */
export const isInherit = (v) => v === null || (typeof v === 'string' && INHERIT.includes(v.trim().toLowerCase()));

/**
 * A stored device (or nothing) as { name, label, width, height, kind }. name is the preset's, or "custom".
 * kind picks the board's frame: phone, tablet, browser (desktop, laptop) or plain (custom).
 * Anything unreadable falls back to the phone, so an odd board.json never breaks the board.
 */
export function describeDevice(stored) {
  let v;
  try {
    v = stored == null ? DEFAULT_DEVICE : parseDevice(stored);
  } catch {
    v = DEFAULT_DEVICE;
  }
  if (typeof v === 'string') {
    const p = PRESETS[v];
    return { name: v, label: p.label, width: p.width, height: p.height, kind: v === 'desktop' || v === 'laptop' ? 'browser' : v };
  }
  return { name: 'custom', label: v.label || 'Custom', width: v.width, height: v.height, kind: 'plain' };
}

/** The device a state is designed for: the state's, else its screen's, else the project's, else the phone. */
export function resolveDevice(project, screen, state) {
  const stored = state?.device ?? screen?.device ?? project?.device ?? DEFAULT_DEVICE;
  return describeDevice(stored);
}

/** "Desktop · 1440×900" */
export const deviceText = (d) => `${d.label} · ${d.width}×${d.height}`;

/** Two devices are the same viewport. */
export const sameDevice = (a, b) => a.width === b.width && a.height === b.height && a.name === b.name;

/** Which template a new mock for this device starts from (relative to the plugin root). */
export function templateFor(d) {
  if (d.name === 'desktop' || d.name === 'laptop' || (d.name === 'custom' && d.width >= 1024)) return 'templates/mock-desktop.html';
  if (d.name === 'tablet' || (d.name === 'custom' && d.width >= 600)) return 'templates/mock-tablet.html';
  return 'templates/mock.html';
}

/**
 * Every state's device, for the board UI and export:
 * { default: <the project's>, states: { "<screen>/<state>": <device> } }.
 */
export function boardDevices(project, board) {
  const out = { default: describeDevice(project?.device), states: {} };
  for (const flow of board?.flows || []) {
    for (const screen of flow.screens || []) {
      for (const state of screen.states || []) out.states[`${screen.id}/${state.id}`] = resolveDevice(project, screen, state);
    }
  }
  return out;
}
