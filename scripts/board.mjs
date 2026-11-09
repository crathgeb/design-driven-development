#!/usr/bin/env node
// Safe edits to a project's board.json, for Claude and its workers. Node built-ins only.
// When the project's server runs, edits go through it (POST /api/board), which applies them one at
// a time; otherwise the file is edited under a lock with an atomic write.
//
//   node board.mjs <project> show [--json]
//   node board.mjs <project> add-flow   --id <flow> --title "…" [--intent "…"] [--index N]
//   node board.mjs <project> add-screen --flow <flow> --id <screen> --title "…" [--intent "…"] [--device D] [--index N]
//   node board.mjs <project> add-state  --screen <screen> --id <state> --title "…" [--intent "…"] [--device D] [--file mocks/x.html] [--index N]
//   node board.mjs <project> update     (--flow <flow> | --screen <screen> [--state <state>]) [--title "…"] [--intent "…"] [--device D]
//   node board.mjs <project> remove-state --screen <screen> --state <state>
//   node board.mjs <project> remove-screen --screen <screen>      (mock files stay on disk)
//   node board.mjs <project> remove-flow --flow <flow>
//   node board.mjs <project> move --flow <flow> --index N
//   node board.mjs <project> move --screen <screen> [--to-flow <flow>] --index N
//   node board.mjs <project> move --screen <screen> --state <state> --index N
//
// <project> is the project folder or its slug. Ids are kebab-case. A state's file defaults to
// mocks/<screen>--<state>.html. A device (D) is phone, tablet, laptop, desktop or WxH (1366x768); it
// overrides the project's default for that screen or state, and `--device inherit` drops the override.

import { parseArgs } from 'node:util';
import { call, findServer } from '../lib/client.mjs';
import { isInherit, parseDevice } from '../lib/devices.mjs';
import { applyBoardOp, BOARD_OPS, describeBoard, loadBoard, loadProject, logEvent, resolveProject, saveBoard, withFileLock } from '../lib/project.mjs';

const USAGE = `usage: node board.mjs <project> <show|${BOARD_OPS.join('|')}> [--id ID] [--title T] [--intent I] [--flow F] [--screen S] [--state S] [--device D] [--file F] [--index N] [--to-flow F]`;

function fail(msg, code = 1) {
  console.error(`board: ${msg}`);
  process.exit(code);
}

let parsed;
try {
  parsed = parseArgs({
    allowPositionals: true,
    options: {
      id: { type: 'string' }, title: { type: 'string' }, intent: { type: 'string' }, flow: { type: 'string' }, screen: { type: 'string' },
      state: { type: 'string' }, file: { type: 'string' }, device: { type: 'string' }, index: { type: 'string' }, 'to-flow': { type: 'string' }, json: { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
    },
  });
} catch (err) {
  fail(`${err.message}\n${USAGE}`, 2);
}
const { values: o, positionals } = parsed;
if (o.help) {
  console.log(USAGE);
  process.exit(0);
}
const [projectArg, opName, extra] = positionals;
if (!projectArg || !opName) fail(USAGE, 2);
if (extra) fail(`unexpected argument ${extra} (put titles and intents in quotes)`, 2);

let dir;
try {
  dir = resolveProject(projectArg);
} catch (err) {
  fail(err.message);
}

if (opName === 'show') {
  const board = loadBoard(dir);
  console.log(o.json ? JSON.stringify(board, null, 2) : describeBoard(board, null, loadProject(dir)));
  process.exit(0);
}
if (!BOARD_OPS.includes(opName)) fail(`unknown op ${opName}\n${USAGE}`, 2);

const op = { op: opName };
for (const k of ['id', 'title', 'intent', 'flow', 'screen', 'state', 'file', 'device']) if (o[k] != null) op[k] = o[k];
if (o.device != null) {
  if (!['add-screen', 'add-state', 'update'].includes(opName)) fail(`--device goes with add-screen, add-state or update`, 2);
  if (!(opName === 'update' && isInherit(o.device))) {
    try {
      parseDevice(o.device);
    } catch (err) {
      fail(err.message, 2);
    }
  }
}
if (o.index != null) {
  if (!/^\d+$/.test(o.index)) fail('--index must be a whole number (0 is first)', 2);
  op.index = Number(o.index);
}
if (o['to-flow'] != null) op.toFlow = o['to-flow'];

const port = await findServer(dir);
if (port) {
  const { status, body } = await call(port, 'POST', '/api/board', op).catch((err) => fail(`the server didn't answer: ${err.message}`));
  if (status !== 200) fail(typeof body === 'string' ? body : JSON.stringify(body));
  console.log(`board: ${body.message}`);
} else {
  try {
    const message = await withFileLock(dir, () => {
      const board = loadBoard(dir);
      const msg = applyBoardOp(board, op);
      saveBoard(dir, board);
      logEvent(dir, { type: 'board', op: op.op, message: msg });
      return msg;
    });
    console.log(`board: ${message}`);
  } catch (err) {
    fail(err.message);
  }
}
