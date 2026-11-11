# design-driven-development: design

Rapid UX iteration with Claude. Claude writes **mocks**: static HTML screens for a phone, a tablet, a desktop browser or any size, one file per screen *state*, with realistic sample data. They are laid out on a **board** in the browser: every screen and every state side by side. The author marks them up (draws, pins notes, writes intent), presses **Send to Claude**, and background workers revise the mocks while the author keeps looking. When the experience is right, Claude **exports** the spec into the product's repo (`docs/design/<slug>/`). How to build it is a later session's problem.

Different from plan-maker, which reviews documents, and from tools that annotate screenshots of an app that exists: this is for an experience that doesn't exist yet, and for explaining the intent behind it.

## Vocabulary

- **Project**: one design question ("Threads for broad Questions"). Lives in `~/.design-driven-development/projects/<repo>/<slug>/` (`$DDD_HOME` replaces `~/.design-driven-development`), where `<repo>` is the basename of the git root of the directory Claude was started in (or of cwd).
- **Board**: flows → screens → states (`board.json`).
- **Flow**: a sequence the user goes through ("Build a Thread").
- **Screen**: one place in the app ("Thread composer").
- **State**: one look of a screen ("empty", "two pieces picked", "keyboard up"). One HTML file each: `mocks/<screen-id>--<state-id>.html`.
- **Device**: the viewport a state is designed for: a preset (`phone` 390×844, `tablet` 820×1180, `laptop` 1280×800, `desktop` 1440×900) or a custom size. The project has a default; a screen or a state may override it (see "Devices").
- **Intent**: Claude's *why* for a screen or state (in `board.json`), shown beside the mock. The author's own context goes in **notes** (`notes.json`).
- **Mark**: something the author drew or pinned on a state, with a note: pin, box, ellipse, arrow, pen (freehand), or a plain note with no drawing.
- **Ask** (a request): free-form text for Claude, with a **scope**: the **whole app** (every screen), one **flow** (every screen in it), one **screen**, none (something new: Claude decides where), or **export** (the board's Export: write the spec, plus whatever else the text asks for).
- **Job**: work handed to Claude: one per screen with open marks (and its screen asks), one per unscoped ask, one per whole-app or flow ask (kind `app` or `flow`, exclusive over the screens it covers), and one per export request (kind `export`: it writes the spec into the product repo and covers no screen). Each job has a **context pack** (`jobs/<id>.md`) a background worker can act on alone.
- **Kit**: `kit/mock.css` (+ optional `kit/mock.js`), the shared look every mock uses, so workers produce consistent screens.
- **Theme**: the project's `theme.css`, its brand: overrides of the kit's variables, loaded by every mock after the kit. Mocks never hard-code what it provides.
- **Design direction**: the author's note on the whole app (brand, tone, type, colour), in `notes.json` as `app.note`; every whole-app and flow pack carries it.

## Repo layout (a Claude Code plugin, Node ≥ 18, no required dependencies)

```
.claude-plugin/plugin.json, marketplace.json
package.json, package-lock.json  type: module; scripts: test; optionalDependency playwright-core (screenshots only)
README.md, CHANGELOG.md, LICENSE
docs/design.md                    this file
skills/design-driven-development/SKILL.md      the one skill, also /design-driven-development "<name>": start or resume
                                               a project, author mocks, serve, connect, work jobs, export
skills/design-driven-development/authoring.md  how to write a mock: the kit, states, sample data, intent
kit/mock.css, kit/mock.js, kit/README.md, kit/example.html
kit/desktop.css, kit/example-desktop.html   the web-app kit (shell, tables, forms, menus, dialogs) and its gallery
templates/mock.html, mock-tablet.html, mock-desktop.html   skeleton of one state, per device
lib/devices.mjs                   device presets, parsing, resolveDevice (state > screen > project)
lib/project.mjs                   paths, read/write board.json, notes.json, project.json, ids
lib/jobs.mjs                      job queue on disk, context packs
lib/server.mjs                    HTTP server
lib/client.mjs                    finding a project's server, calling its API
lib/browser.mjs                   finding playwright-core and a Chromium for screenshots
scripts/ddd.mjs                   CLI: init, set-device, serve, list, path (scripts/dfs.mjs: the old name, a shim)
scripts/board.mjs                 safe board edits (add/rename screens and states, set intent)
scripts/listen.mjs                Claude's listener (Monitor tool) and --state
scripts/job.mjs                   start | done | fail a job
scripts/export.mjs                write the spec into the repo
scripts/shoot.mjs                 PNG of each state (playwright-core if installed; skipped otherwise)
ui/board.html, ui/board.css, ui/board.js   the web app
test/*.test.mjs                   node --test (no playwright needed)
.github/workflows/test.yml        npm test on Node 18 and 22, ubuntu and macOS
```

## Settings and the old name

The plugin was called design-first-spec before 0.2.0. Environment settings are read as `DDD_<name>`, falling back to `DFS_<name>`:

- `DDD_HOME`: where projects live (default `~/.design-driven-development`). When it isn't set, the new folder doesn't exist and `~/.design-first-spec` does, the old folder is used, and `ddd.mjs` prints once how to move it.
- `DDD_PLAYWRIGHT`: a `playwright-core` folder to use for screenshots, before the plugin's own `node_modules`.
- `DDD_CLAUDE_GRACE_MS`, `DDD_LISTEN_RETRY_MS`: timings, for tests.

Scripts also recognise a server whose `/api/health` says `design-first-spec`, so a board served under the old name isn't served twice.

## Screenshots

`lib/browser.mjs` loads `playwright-core` (from `DDD_PLAYWRIGHT`, else the plugin's `node_modules`, an optionalDependency) and launches its headless Chromium; if that version's browser isn't downloaded, it tries any Chromium or headless shell in playwright's cache (`PLAYWRIGHT_BROWSERS_PATH`, else the per-platform default), then a system Chrome (`CHROME_PATH` first). Without either, `shoot.mjs` and `export.mjs` skip PNGs and print the two commands that install them.

## Project folder

```
~/.design-driven-development/projects/<repo>/<slug>/
  project.json   { slug, name, goal, repo: "<abs path of the product repo>", createdAt, updatedAt, device: "phone" | "tablet" | "laptop" | "desktop" | { width, height, label? } }
  board.json     see below
  notes.json     see below
  theme.css      the brand: kit variable overrides for every mock (created by init; served as /theme.css)
  mocks/*.html
  assets/        images a mock uses (optional)
  jobs/<id>.json, jobs/<id>.md
  history/<iso-timestamp>-<job-id>/   copies of the files a job changed, taken before it changed them
  server.json    { port, pid, startedAt } while a server runs
  log.jsonl      one line per event (job created/started/done, export)
```

### board.json

```json
{
  "flows": [
    {
      "id": "build-thread",
      "title": "Build a Thread",
      "intent": "Why this flow exists, in a sentence or two.",
      "screens": [
        {
          "id": "thread-composer",
          "title": "Thread composer",
          "intent": "What the screen is for and the key design choice.",
          "states": [
            { "id": "empty", "title": "No pieces yet", "intent": "Why this state looks this way.", "file": "mocks/thread-composer--empty.html" }
          ]
        }
      ]
    }
  ]
}
```

Ids are kebab-case, unique (screen ids unique across the board; state ids unique within a screen). The order in the file is the order on the board.

Any screen or state may carry a `device` (same values as `project.json`'s), e.g. `{ "id": "overview", …, "states": [{ "id": "desktop", … }, { "id": "phone", "device": "phone", … }] }`.

### Devices

| Preset | CSS pixels | Board frame |
|---|---|---|
| `phone` | 390×844 | a rounded phone screen |
| `tablet` | 820×1180 | a squarer, thinner-edged screen |
| `laptop` | 1280×800 | a browser window: title bar, three dots, an address bar with the state's title |
| `desktop` | 1440×900 | the same browser window |
| `{ "width": W, "height": H, "label"?: "…" }` | W×H (200–4000 each) | a plain rounded frame |

**Precedence:** a state's `device` beats its screen's, which beats the project's; a project without one (from before devices) is a phone. So a responsive design is one screen with a phone state and a desktop state. `resolveDevice(project, screen, state)` in `lib/devices.mjs` is the only place this is worked out, returning `{ name, label, width, height, kind }` (`name` is the preset or `custom`; `kind` is the frame: `phone`, `tablet`, `browser`, `plain`). The server sends every state's (`GET /api/project` → `devices: { default, states: { "<screen>/<state>": … } }`), export inlines the same, and shoot, the context packs, `describeBoard` and the spec skeleton call it.

**Setting it:** `ddd.mjs init "<name>" --device desktop` (or `phone`, `tablet`, `laptop`, `1366x768`; default `phone`); `ddd.mjs set-device <project> <device>` changes the default; `board.mjs add-screen|add-state … --device <device>` and `update --screen <s> [--state <st>] --device <device>` set an override (`--device inherit` drops it). Unknown names and sizes outside 200–4000 are refused.

**Templates:** `templates/mock.html` for a phone, `mock-tablet.html` for a tablet, `mock-desktop.html` for a laptop or desktop; a custom size uses the desktop one from 1024 wide, the tablet one from 600, else the phone one (`templateFor()`).

### notes.json (the author's input)

```json
{
  "general": "free text about the whole project",
  "app": { "note": "design direction for the whole app: brand, tone, type, colour" },
  "screens": {
    "<screen-id>": {
      "note": "context or intent the author adds for the screen",
      "states": {
        "<state-id>": {
          "note": "",
          "marks": [
            {
              "id": "m_k3j2", "n": 1,
              "shape": "pin | box | ellipse | arrow | pen | note",
              "x": 0, "y": 0, "w": 0, "h": 0,
              "points": [[0, 0]],
              "text": "make this the primary action",
              "target": { "selector": "main > .card:nth-of-type(2) .btn", "text": "Keep going", "rect": [0, 0, 0, 0] },
              "status": "open | sent | done",
              "job": "j_…",
              "createdAt": "ISO"
            }
          ]
        }
      }
    }
  },
  "asks": [
    {
      "id": "a_…", "text": "make it feel warmer",
      "scope": "app | flow | screen | export | null", "flow": "<flow-id when scope is flow>", "screen": "<screen-id when scope is screen>",
      "status": "open|sent|done", "job": null, "createdAt": "ISO"
    }
  ]
}
```

**Decision: one `asks` list with a `scope`**, not a separate `app.asks`. Every request, whatever it covers, is one list the board shows in the Whole app panel and the server turns into jobs the same way; `app` holds only the design-direction note. An ask without `scope` (from before scopes) is a screen ask if it has a `screen`, otherwise a loose ask (`scope: null`). A board that saves notes without an `app` key (an older tab) keeps the server's `app`.

Coordinates are CSS pixels in the mock's own coordinate space (the unscaled viewport of the state's device, e.g. 390×844 or 1440×900, scrolled content included: y is from the top of the document). `n` numbers marks per state, for the worker to refer to. `target` is the element under the mark's anchor point (a pin's point, a box's centre, an arrow's head), found by the UI with `elementFromPoint` inside the same-origin iframe; `text` is its trimmed textContent (≤ 120 chars).

## Server (lib/server.mjs, started by `ddd.mjs serve <project-dir|slug>`)

- Listens on 127.0.0.1, first free port from **4490**. Writes `server.json`; removes it on exit. If a server already serves this project, print its URL and exit 0. `--no-open` skips opening the browser.
- Static: `/` → `ui/board.html`; `/ui/*`; `/kit/*` (from the plugin); `/mocks/*` and `/assets/*` (from the project); `/theme.css` (the project's `theme.css`, or an empty `text/css` 200 when it has none, so mocks can always link it). Mocks reference the kit as `/kit/mock.css`, then `/theme.css`.
- `GET /api/health` → `{ app: "design-driven-development", dir }`.
- `GET /api/project` → `{ project, board, devices, notes, jobs, claude: { connected, phase, message } }` (`devices`: see "Devices").
- `PUT /api/notes` → replace notes.json (the UI saves debounced; the server writes atomically).
- `POST /api/board` with `{ op, ... }` → serialized board edits (used by `board.mjs` when a server runs, so parallel workers don't clobber each other). Ops: `add-flow`, `add-screen`, `add-state`, `update` (title/intent of a flow, screen or state), `remove-state`, `move`.
- `POST /api/send` `{ screen?: id }` → turns open marks (all screens, or one) and open asks into jobs: **one job per screen** that has open marks or a screen-scoped ask, and **one job per unscoped ask**. Marks/asks become `sent` with their job id. Returns the jobs.
- `POST /api/ask` `{ text, scope?: "app"|"flow"|"screen"|"export", flow?, screen? }` → adds an ask and sends it at once (404 for an unknown flow or screen). Without a scope: a screen ask if `screen` is given, a flow ask if only `flow`, else a loose ask. `scope: "export"` is the board's Export: an export job.
- `POST /api/send` leaves open app and flow asks out when it's scoped to one screen.
- Jobs: `POST /api/jobs/<id>/start`, `/done` `{ summary, files? }`, `/fail` `{ error }`. On done, the job's marks and asks become `done`.
- `GET /api/claude/events` (SSE, for the listener): `hello` on connect, then queued jobs not yet offered, then each new job as `{ type: "job", ... }`. A connected listener makes `claude.connected` true (with a 60 s grace after it drops).
- `POST /api/claude/state` `{ phase: idle|working|ready|error, message }`.
- `GET /api/stream` (SSE, for the board): `file` `{ path }` when anything in `mocks/`, `assets/`, `board.json`, `project.json` (its device) or `theme.css` changes (`theme.css` and `assets/` reload every mock) (fs.watch, debounced), `jobs` (the list), `claude` (connection and state), `notes` (when changed by someone else).
- Before a job's worker changes a file, `job.mjs start` snapshots the mock files it covers (a screen's, a flow's, or all of them for app and loose jobs), board.json and theme.css into `history/`.

## Jobs and the context pack

`jobs/<id>.json`: `{ id, kind: "marks"|"ask"|"app"|"flow"|"export", scope: "screen"|"app"|"flow"|"export"|null, screen, flow, status: queued|offered|running|done|failed, createdAt, startedAt, doneAt, summary, error, marks: [...], asks: [...] }`. An app or flow job has one ask, no marks, `screen: null`.

### Exclusivity

A job **covers** screens (`jobCoverage` in `lib/jobs.mjs`): a screen job its screen; a flow job every screen in its flow (as the board is when it's offered); an app job every screen, including ones added while it runs; a loose ask and an export none (an export reads the board and changes no screen, so it runs alongside everything, and `job.mjs start` snapshots no mocks for it). The server offers jobs oldest first, and a job is offered only when nothing it covers is covered by an offered or running job. A queued job that can't start still **reserves** what it covers, so later jobs wait behind it: an app job waits until no screen job is running, and screen jobs sent after it wait until it's done. Two flow jobs on different flows, or screen jobs on different screens, run in parallel; loose asks run alongside anything (as before).

`jobs/<id>.md` is everything a worker needs, self-contained:
1. The project (name, goal, path, product repo) and a pointer to `authoring.md` (absolute path) and the kit README.
2. The project's default device, and the screen: its flow, title, intent, author note, every state with its file (absolute path), its device and size with the template to start from ("design for this viewport"), and intent. The board outline marks screens and states whose device differs from the project's.
3. The marks, numbered per state, each with shape, coordinates, the target element and text, and the note.
4. Asks.
5. Rules: the brand is theme.css's (use the variables, don't change theme.css from a screen job); change only this screen's files (and add new state files for it); edit the board only through `node <plugin>/scripts/board.mjs <project> …`; keep sample data realistic and consistent with other screens (read them, don't edit them); update the state's intent when the design changes; don't touch notes.json. End with one line `SUMMARY: <what changed, one sentence>`.

The pack of an **app or flow job** instead holds: the request; the author's design direction (`app.note`) and project note; the project and **theme.css** (absolute path); every affected flow, screen and state with absolute file paths, intents and the author's notes (a flow job also gets the rest of the board as read-only context); and how to work: change **theme.css** (and the shared vocabulary: board titles and intents, words in the mocks) before editing mocks one by one; "if more than ~8 mocks need edits, split by flow across subagents, then verify" (one background subagent per flow when the worker can start them, otherwise flow by flow); render and check a sample from every flow; keep intents current; end with `SUMMARY:`. A flow job doesn't change theme.css (other flows share it).

## Listener (scripts/listen.mjs, run by Claude under the Monitor tool)

`node listen.mjs <project>` finds the server (server.json, then ports 4490–4509 by `/api/health`), connects to `/api/claude/events`, prints one line per event, reconnects on drop, exits after ~30 s with no server. Lines:

- `design-driven-development: connected to "<name>" at http://127.0.0.1:<port>/ (<n> jobs waiting).`
- `design-driven-development: job <id> on "<screen title>" (<n> marks, <m> asks). Run \`node <plugin>/scripts/job.mjs <project> start <id>\`, then start a background subagent with the prompt "Read <pack path> and do the job it describes.", and when it finishes run \`node <plugin>/scripts/job.mjs <project> done <id> --summary "<its SUMMARY line>"\` (or \`fail <id> --error "<why>"\`).`
- `design-driven-development: the author asked "<text>" …` same shape, for asks.
- `design-driven-development: whole-app job <id>: the author asked "<text>" (<n> screens, <m> states). This is a whole-app job: it applies to every screen, and no other job touches those screens until it's done. Run … start …, then start a background subagent …, and when it finishes run … done … The pack tells the subagent to change the theme first and, if many mocks need edits, to split them by flow across its own subagents.`
- `design-driven-development: flow job on "<flow title>" <id>: …` the same for a flow (`This is a flow job: it applies to every screen in "<flow>"`).
- `design-driven-development: export job <id>: the author asked "<text>". This is an export: it writes the spec (and whatever else the request asks for) into the product repo and changes no screen. Run … start …, then start a background subagent …, and when it finishes run … done …`

`node listen.mjs <project> --state working|ready|idle|error --message "…"` posts to `/api/claude/state`.

## The board UI (ui/)

One page, no framework, no build step.

- **Top bar**: sidebar toggle; project name; Claude pill (connected / working "Updating 2 screens" / offline); **Send to Claude** (count of open marks + asks; disabled at 0); **Ask Claude…** (opens the Whole app panel, scoped to the focused screen in the focus view, else the whole app); **Activity** (jobs: queued, running, done with summary, failed); **Export**, a popover with a request box prefilled with "export the spec" that the author can extend ("…and break the work into epics and stories"), the folder it writes to, and **Send to Claude** (⌘↵): an `export` ask, so an export job. While only an export runs, the pill says "Exporting the spec".
- **Sidebar** (left, 268 px, collapsible with the top-bar button or `[`; open/closed kept in localStorage, closed by default under 900 px wide, where it floats over the board): the project name and goal; a **Whole app** item (opens the Whole app panel; says when an app request is waiting or running); a "Find a screen" filter; every flow (foldable, fold state remembered, screen count) with its screens nested, each with its state count, a small device icon for each device its states use other than the project's, an open-marks badge (open marks + open screen asks), and a pulsing dot while a job covers it. Clicking a flow scrolls the board to it; clicking a screen scrolls to it and highlights it briefly. The screen most in view (IntersectionObserver on the board) and its flow are highlighted as you scroll, and kept in view in the sidebar. In the focus view the sidebar stays; clicking a screen (or flow) opens its first state.
- **Whole app panel** (a drawer on the right): the **design direction** note (`app.note`, autosaved); a **request** box with **Applies to**: Whole app (every screen), one flow, one screen, or "Something new · Claude decides where", with a line on what that scope means; and every request so far with its scope, status (Waiting for Claude / Claude is working / Done / Failed) and the job's summary. Each flow's heading on the board has "Ask about this flow…" (opens the panel scoped to it). Esc closes it.
- **Board view** (default): flows as sections (title + intent). Each screen is a column group: title, intent, author note; its states side by side as frames (iframes of the mocks at their device's size, scaled with a transform), each with the state title, its device when it isn't the project's ("Phone · 390×844"), and intent under it, and a badge with its open marks count. Each frame fits a box of zoom × 900×844, so a phone shows at the zoom (~0.55) and a desktop smaller, and screens mixing devices stay tidy. The frame's chrome follows the device (see "Devices"). A zoom control (0.35–1). Frames reload when their file changes, with a brief highlight (all of them when theme.css changes); states being worked on show a "Claude is updating" shimmer, on every screen a running app or flow job covers; a waiting screen job shows "Waiting for Claude".
- **Focus view** (click a frame): the state fitted to the room (width and height; never above 100%) and centred, with **Fit**, **−**, **+** and **100%** (keys `0`, `-`, `=`, `1`; the choice is kept), scrolling around a zoomed-in frame, and the device and size beside them ("Desktop · 1440×900"); a strip of the screen's other states to switch; arrow keys move between states; Esc back to the board.
  - Tools: **Select**, **Pin (P)**, **Box (B)**, **Ellipse (E)**, **Arrow (A)**, **Pen (D)**; drawn on an SVG overlay over the iframe in the mock's own CSS pixels at any device size and scale (the overlay scrolls with the mock: marks are stored in document coordinates).
  - A new mark gets a number and opens its note field at once. Marks list in the right panel: number, note, status; click to highlight; delete.
  - Right panel also: Claude's intent for the screen and the state; the author's note for the screen and for the state; "Send this screen to Claude".
  - Done marks fade and fold into "Resolved (n)".
  - **Full screen** (**F**, or the button beside the zoom): the top bar, sidebar, tool rail, stage head, strip and panel step aside and the state is fitted to the window (16 px margin; zoom is always Fit). One floating toolbar, a vertical strip of icons: the grip (its tooltip names the screen and state), the tools, **Send to Claude** (this screen, with the count to send on it) and **Exit**. It docks at the left edge, centred top to bottom; drag it anywhere by its grip (kept in localStorage, inside the window), double-click the grip to dock it. A mark's note is a card beside the toolbar (on its left when the toolbar sits in the right half), so notes are still written off the canvas. It opens for a new mark or a mark clicked on the mock, and folds back into the toolbar when the author is done (Enter, its ×, or clicking elsewhere); the toolbar's note button (with the count of marks on the state) shows it again, for the selected mark or else the latest. Esc deselects, then leaves full screen; arrows still move between states.
- Autosave to `PUT /api/notes` (debounced 400 ms); everything restores on reload.
- Works when Claude is offline: marks still save; Send queues jobs until a listener connects.

## Export (scripts/export.mjs)

`node export.mjs <project> [--out <dir>]`, default `<product repo>/docs/design/<slug>/`:
- `index.html`: a static, read-only board (the mocks embedded, intent beside each, the author's notes), opening from disk.
- `mocks/`, `kit/` copies, `theme.css` (an empty one when the project has none, so the mocks' links resolve; mocks' `/theme.css` becomes `../theme.css`), `board.json`, `notes.json`.
- `spec.md`: the experience in words, flow by flow, screen by screen, state by state: intent, what's on screen, decisions settled with the author (from resolved marks and notes). This part is written by Claude (the skill says how); `export.mjs` writes a skeleton with every flow/screen/state heading and its intent, for Claude to fill in.
- `screens/*.png` when playwright-core and a Chromium are available (`shoot.mjs`: each state at its device's viewport, 2× up to 1024 wide, 1× wider).
- The spec skeleton says the project's device and, under each state designed for another, `*Device:* …`.
