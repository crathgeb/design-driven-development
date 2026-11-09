// Devices: presets and custom sizes, the project → screen → state precedence, the CLI (init --device,
// set-device, board.mjs --device), board ops, the context pack, export with mixed devices, the shoot plan.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import { boardDevices, describeDevice, parseDevice, resolveDevice, templateFor } from '../lib/devices.mjs';
import { createJobs, contextPack } from '../lib/jobs.mjs';
import { applyBoardOp, describeBoard, loadBoard, loadNotes, loadProject, saveBoard, saveNotes, setProjectDevice } from '../lib/project.mjs';
import { shotPlan } from '../scripts/shoot.mjs';
import { makeProject, mark, run, sandbox } from './helpers.mjs';

describe('device model', () => {
  test('presets, sizes and labels', () => {
    assert.deepEqual(describeDevice('phone'), { name: 'phone', label: 'Phone', width: 390, height: 844, kind: 'phone' });
    assert.deepEqual(describeDevice('tablet'), { name: 'tablet', label: 'Tablet', width: 820, height: 1180, kind: 'tablet' });
    assert.deepEqual(describeDevice('desktop'), { name: 'desktop', label: 'Desktop', width: 1440, height: 900, kind: 'browser' });
    assert.deepEqual(describeDevice('laptop'), { name: 'laptop', label: 'Laptop', width: 1280, height: 800, kind: 'browser' });
    assert.deepEqual(describeDevice({ width: 1024, height: 768, label: 'Kiosk' }), { name: 'custom', label: 'Kiosk', width: 1024, height: 768, kind: 'plain' });
    assert.equal(describeDevice(undefined).name, 'phone', 'no device is a phone (projects from before devices)');
    assert.equal(describeDevice('nonsense').name, 'phone', 'an unreadable device falls back to the phone');
  });

  test('parseDevice accepts names, WxH and objects, and rejects the rest', () => {
    assert.equal(parseDevice('Desktop'), 'desktop');
    assert.deepEqual(parseDevice('1366x768'), { width: 1366, height: 768 });
    assert.deepEqual(parseDevice('1366×768'), { width: 1366, height: 768 });
    assert.deepEqual(parseDevice({ width: 600, height: 960, label: '  Reader ' }), { width: 600, height: 960, label: 'Reader' });
    assert.equal(parseDevice({ name: 'tablet' }), 'tablet');
    for (const bad of ['watch', '100x100', '5000x900', '1440', '', { width: 'x', height: 900 }, [], 42]) assert.throws(() => parseDevice(bad), /device/, JSON.stringify(bad));
  });

  test("a state's device beats its screen's, which beats the project's", () => {
    const project = { device: 'desktop' };
    const screen = { id: 's', device: 'tablet' };
    assert.equal(resolveDevice(project, {}, {}).name, 'desktop');
    assert.equal(resolveDevice(project, screen, {}).name, 'tablet');
    assert.equal(resolveDevice(project, screen, { device: 'phone' }).name, 'phone');
    assert.equal(resolveDevice({}, {}, {}).name, 'phone');
    assert.equal(resolveDevice(project, {}, { device: { width: 1920, height: 1080 } }).width, 1920);
  });

  test('templates by device', () => {
    assert.equal(templateFor(describeDevice('phone')), 'templates/mock.html');
    assert.equal(templateFor(describeDevice('tablet')), 'templates/mock-tablet.html');
    assert.equal(templateFor(describeDevice('desktop')), 'templates/mock-desktop.html');
    assert.equal(templateFor(describeDevice('laptop')), 'templates/mock-desktop.html');
    assert.equal(templateFor(describeDevice({ width: 1920, height: 1080 })), 'templates/mock-desktop.html');
    assert.equal(templateFor(describeDevice({ width: 360, height: 740 })), 'templates/mock.html');
  });

  test('board ops store, change and drop device overrides', () => {
    const b = { flows: [] };
    applyBoardOp(b, { op: 'add-flow', id: 'f', title: 'F' });
    applyBoardOp(b, { op: 'add-screen', flow: 'f', id: 'dash', title: 'Dashboard', device: 'desktop' });
    applyBoardOp(b, { op: 'add-state', screen: 'dash', id: 'wide', title: 'Wide' });
    applyBoardOp(b, { op: 'add-state', screen: 'dash', id: 'narrow', title: 'Narrow', device: 'phone' });
    const screen = b.flows[0].screens[0];
    assert.equal(screen.device, 'desktop');
    assert.equal(screen.states[0].device, undefined);
    assert.equal(screen.states[1].device, 'phone');
    applyBoardOp(b, { op: 'update', screen: 'dash', state: 'wide', device: '1366x768' });
    assert.deepEqual(screen.states[0].device, { width: 1366, height: 768 });
    applyBoardOp(b, { op: 'update', screen: 'dash', state: 'wide', device: 'inherit' });
    assert.ok(!('device' in screen.states[0]));
    applyBoardOp(b, { op: 'update', screen: 'dash', device: 'inherit' });
    assert.ok(!('device' in screen));
    assert.throws(() => applyBoardOp(b, { op: 'add-state', screen: 'dash', id: 'x', title: 'X', device: 'watch' }), /unknown device/);
    assert.throws(() => applyBoardOp(b, { op: 'update', flow: 'f', device: 'desktop' }), /screen or a state/);
    assert.equal(b.flows[0].screens[0].states.length, 2, 'a failed add leaves the board alone');

    const devices = boardDevices({ device: 'laptop' }, b);
    assert.equal(devices.default.name, 'laptop');
    assert.equal(devices.states['dash/wide'].name, 'laptop');
    assert.equal(devices.states['dash/narrow'].name, 'phone');
    assert.match(describeBoard(b, null, { device: 'laptop' }), /state narrow: Narrow \[Phone · 390×844\]/);
    assert.doesNotMatch(describeBoard(b, null, { device: 'laptop' }), /state wide: Wide \[/);
  });
});

describe('device CLI', () => {
  test('init --device, set-device, and their validation', async () => {
    const sb = sandbox();
    const r = await run('ddd.mjs', ['init', 'Admin console', '--repo', sb.repo, '--device', 'desktop'], { env: sb.env });
    assert.equal(r.code, 0, r.stderr);
    const dir = r.stdout.trim();
    assert.equal(loadProject(dir).device, 'desktop');

    const custom = await run('ddd.mjs', ['init', 'Kiosk', '--repo', sb.repo, '--device', '1080x1920'], { env: sb.env });
    assert.equal(custom.code, 0, custom.stderr);
    assert.deepEqual(loadProject(custom.stdout.trim()).device, { width: 1080, height: 1920 });

    const bad = await run('ddd.mjs', ['init', 'Watch app', '--repo', sb.repo, '--device', 'watch'], { env: sb.env });
    assert.equal(bad.code, 1);
    assert.match(bad.stderr, /unknown device "watch"/);

    const set = await run('ddd.mjs', ['set-device', dir, 'laptop'], { env: sb.env });
    assert.equal(set.code, 0, set.stderr);
    assert.match(set.stdout, /Laptop · 1280×800/);
    assert.equal(loadProject(dir).device, 'laptop');
    const setBad = await run('ddd.mjs', ['set-device', dir, '10x10'], { env: sb.env });
    assert.equal(setBad.code, 1);
    assert.equal(loadProject(dir).device, 'laptop');
    const setNone = await run('ddd.mjs', ['set-device', dir], { env: sb.env });
    assert.equal(setNone.code, 2);
  });

  test('board.mjs --device on add-screen, add-state and update', async () => {
    const sb = sandbox();
    const dir = makeProject(sb.repo);
    const ok = async (...args) => {
      const r = await run('board.mjs', [dir, ...args], { env: sb.env });
      assert.equal(r.code, 0, r.stderr);
      return r;
    };
    await ok('add-screen', '--flow', 'review', '--id', 'report', '--title', 'Report', '--device', 'desktop');
    await ok('add-state', '--screen', 'report', '--id', 'wide', '--title', 'Wide');
    await ok('add-state', '--screen', 'report', '--id', 'phone', '--title', 'On a phone', '--device', 'phone');
    await ok('update', '--screen', 'history', '--state', 'default', '--device', '1024x768');
    let s = loadBoard(dir).flows[1].screens;
    assert.equal(s.find((x) => x.id === 'report').device, 'desktop');
    assert.equal(s.find((x) => x.id === 'report').states[1].device, 'phone');
    assert.deepEqual(s.find((x) => x.id === 'history').states[0].device, { width: 1024, height: 768 });
    await ok('update', '--screen', 'history', '--state', 'default', '--device', 'inherit');
    s = loadBoard(dir).flows[1].screens;
    assert.ok(!('device' in s.find((x) => x.id === 'history').states[0]));

    const show = await ok('show');
    assert.match(show.stdout, /screen report: Report \[Desktop · 1440×900\]/);

    const bad = await run('board.mjs', [dir, 'add-state', '--screen', 'report', '--id', 'x', '--title', 'X', '--device', 'fridge'], { env: sb.env });
    assert.equal(bad.code, 2);
    assert.match(bad.stderr, /unknown device/);
    const wrongOp = await run('board.mjs', [dir, 'add-flow', '--id', 'z', '--title', 'Z', '--device', 'desktop'], { env: sb.env });
    assert.equal(wrongOp.code, 2);
  });
});

describe('devices downstream', () => {
  function mixedProject() {
    const sb = sandbox();
    const dir = makeProject(sb.repo);
    setProjectDevice(dir, 'desktop');
    const board = loadBoard(dir);
    applyBoardOp(board, { op: 'update', screen: 'thread-composer', state: 'two-pieces', device: 'phone' });
    applyBoardOp(board, { op: 'update', screen: 'history', device: 'tablet' });
    saveBoard(dir, board);
    return { sb, dir };
  }

  test("the context pack states each state's device and size", () => {
    const { dir } = mixedProject();
    const notes = loadNotes(dir);
    notes.screens['thread-composer'] = { note: '', states: { 'two-pieces': { note: '', marks: [mark('m_a', 1)] } } };
    saveNotes(dir, notes);
    const [job] = createJobs(dir, {});
    const pack = contextPack(dir, job);
    assert.match(pack, /- Device: Desktop · 1440×900 CSS pixels: every mock is designed for this viewport/);
    assert.match(pack, /### State No pieces yet[\s\S]*?- Device: Desktop · 1440×900 CSS pixels\. Design for this viewport \(template .*mock-desktop\.html\)/);
    assert.match(pack, /### State Two pieces picked[\s\S]*?- Device: Phone · 390×844 CSS pixels\. Design for this viewport \(template .*templates\/mock\.html\)/);
    assert.match(pack, /mock's own 390-wide document/);
    assert.match(pack, /screen history: History \[Tablet · 820×1180\]/);
    assert.doesNotMatch(pack, /390×844 CSS pixels\)\./);
  });

  test('export inlines every state device and the spec says which differ', async () => {
    const { sb, dir } = mixedProject();
    const out = join(sb.base, 'out');
    const r = await run('export.mjs', [dir, '--out', out, '--no-shots'], { env: sb.env });
    assert.equal(r.code, 0, r.stderr);
    const index = readFileSync(join(out, 'index.html'), 'utf8');
    const data = JSON.parse(index.match(/<script id="ddd-data" type="application\/json">([\s\S]*?)<\/script>/)[1]);
    assert.equal(data.devices.default.name, 'desktop');
    assert.deepEqual(
      Object.fromEntries(Object.entries(data.devices.states).map(([k, d]) => [k, `${d.width}x${d.height}`])),
      { 'thread-composer/empty': '1440x900', 'thread-composer/two-pieces': '390x844', 'piece-picker/default': '1440x900', 'history/default': '820x1180' },
    );
    const spec = readFileSync(join(out, 'spec.md'), 'utf8');
    assert.match(spec, /Designed for: Desktop · 1440×900 CSS pixels \(states designed for another device say so\)/);
    assert.match(spec, /#### State: Two pieces picked[\s\S]*?\*Device:\* Phone · 390×844/);
  });

  test("shoot plans each state at its device's viewport", () => {
    const { dir } = mixedProject();
    const plan = shotPlan(dir, '/tmp/out');
    const by = Object.fromEntries(plan.map((p) => [p.path, p]));
    assert.deepEqual(by['mocks/thread-composer--empty.html'].viewport, { width: 1440, height: 900 });
    assert.equal(by['mocks/thread-composer--empty.html'].scale, 1);
    assert.deepEqual(by['mocks/thread-composer--two-pieces.html'].viewport, { width: 390, height: 844 });
    assert.equal(by['mocks/thread-composer--two-pieces.html'].scale, 2);
    assert.deepEqual(by['mocks/history--default.html'].viewport, { width: 820, height: 1180 });
    assert.equal(by['mocks/history--default.html'].file, join('/tmp/out', 'history--default.png'));
  });
});
