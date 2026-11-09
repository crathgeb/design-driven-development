---
name: design-driven-development
description: Use when the user wants to design an experience before building it — "run design-driven-development <name>", "/design-driven-development <name>", "mock up …", "let's design the … experience", "show me screens for …", "resume the <name> design", "export the spec" — or when a design-driven-development listener prints a job. Writes HTML mocks of every screen and state onto a board the author marks up in the browser, works their marks with background subagents, and exports the result as a spec into the product's repo.
argument-hint: "<name of the experience>"
---

# Design-Driven Development

Design an experience that doesn't exist yet, as **mocks**: static HTML screens, one file per **state**, with real sample data, laid out on a **board** (flows → screens → states) in the browser. The author draws and pins notes on them and presses **Send to Claude**; you hand each screen's marks to a background subagent, and the board reloads as mocks change. When the experience is right, you **export** it into the product repo as a spec. Building it is a later session.

The contract (vocabulary, file formats, server API) is `${CLAUDE_PLUGIN_ROOT}/docs/design.md`. How to write a mock is `${CLAUDE_PLUGIN_ROOT}/skills/design-driven-development/authoring.md`: read it before you write or delegate any mock.

Scripts are in `${CLAUDE_PLUGIN_ROOT}/scripts/`. `<project>` below is the project's slug or folder. Run them from the product repo, so projects land under its name.

## 1. Start or resume

When run as `/design-driven-development <name>`: if this repo has a project with that name, resume it; otherwise start one. With no name, list this repo's projects and ask which to open (or what to design).

- **New:** `node "${CLAUDE_PLUGIN_ROOT}/scripts/ddd.mjs" init "<name>" --goal "<the design question, one line>"`. It prints the project folder (`~/.design-driven-development/projects/<repo>/<slug>/`). Name the project after the question ("Threads for broad Questions"), not the feature. If it prints a note about `~/.design-first-spec` (the plugin's old name), pass it on to the author once.
- **Resume:** `ddd.mjs list` shows this repo's projects; `ddd.mjs path <slug>` prints one's folder. Read its `board.json` and `notes.json`, then go to step 4. Don't re-author a board that exists.

## 2. Understand the experience

Read before you draw. The mocks must look like this product and speak its language.

- The conversation: what the author wants, what's decided, what's still open.
- The product repo: its README or agent instructions, glossary (name things with its terms), product plan and UX principles, status, and the screens that exist (code, screenshots). Take the product's colours, type and spacing and write them into the project's `theme.css` as kit variable overrides (light and dark), before any mock: every mock links it after the kit, and none hard-codes the brand.
- Real content: the product's own data, so sample data is true to it.

Ask only what blocks the first board, in one short message. Everything else, decide, and write the decision into the intent so the author sees it and can mark it.

## 3. Author the first board

1. **Outline it.** Flows (what the user goes through) → screens (places in the app) → states (each look of a screen). Cover the nuances of state, not just the happy path: empty, first-time vs returning, partial, in progress, error, long content, keyboard up, offline, done. Aim for 10–20 states on a first board. If the author is choosing between designs, add the alternative as its own clearly labelled screen.
2. **Pick the cast.** One user, one set of content, used on every screen (authoring.md, "The cast"). Write it down before you delegate, so every worker uses the same.
3. **Write the board** with `board.mjs` (never edit `board.json` by hand while a server runs):
   ```bash
   B="node ${CLAUDE_PLUGIN_ROOT}/scripts/board.mjs <project>"
   $B add-flow --id build-thread --title "Build a Thread" --intent "Why this flow exists."
   $B add-screen --flow build-thread --id thread-composer --title "Thread composer" --intent "What it's for and the key choice."
   $B add-state --screen thread-composer --id empty --title "No pieces yet" --intent "Why this state looks this way."
   $B show
   ```
   Every flow, screen and state gets an **intent**: the why, and what it decides. It's what the author reads beside the mock and what export turns into the spec.
4. **Write the mocks**, one file per state at `mocks/<screen-id>--<state-id>.html`, from `${CLAUDE_PLUGIN_ROOT}/templates/mock.html` and the kit (`${CLAUDE_PLUGIN_ROOT}/kit/README.md`).
   - **Big boards** (more than about 6 states): start a background subagent per screen, all at once. Brief each with the project folder, its screen and states with their intents, the cast, the path of `theme.css` (use its variables, don't edit it), and "Follow `<abs path>/authoring.md`. Write only these files. End with `SUMMARY:`". Write one screen yourself first if you can, so workers have a model to match.
5. **Look at them.** `node "${CLAUDE_PLUGIN_ROOT}/scripts/shoot.mjs" <project>` writes a PNG of each state (needs playwright-core; it says so if it's missing). Read the PNGs and fix what's off: overflow past 844, clipped text, a state that doesn't show what its intent says, sample data that disagrees between screens.

## 4. Serve and connect

1. **Serve**, in the background: `node "${CLAUDE_PLUGIN_ROOT}/scripts/ddd.mjs" serve <project>`. It opens the board and prints the URL (from port 4490). If it's already running, it prints the URL and exits.
2. **Connect** with the **Monitor** tool:
   - **command:** `node "${CLAUDE_PLUGIN_ROOT}/scripts/listen.mjs" <project>`
   - **description:** `design-driven-development: <project name>`
   - **timeout_ms:** `1800000`, the maximum

   While it runs, the board shows **Claude connected**. **Re-arm** the same Monitor whenever it expires, as long as the author is still working on the board. Jobs sent while nobody listened are offered as soon as you reconnect.
3. **Tell the author** the URL and how it works, in four lines:
   - Click a state to focus it; draw with Pin (P), Box (B), Ellipse (E), Arrow (A) or Pen (D), and type a note for each mark.
   - Write your own context for a screen or state in its note; Claude's intent is beside it.
   - **Send to Claude** hands over every open mark (one job per screen); **Ask Claude…** asks for anything else, for one screen, a flow, or the whole app ("make it feel warmer"). The sidebar (`[`) lists every flow and screen; **Whole app** in it holds the design direction for every screen.
   - Keep looking: screens reload as Claude changes them. Say "export the spec" when it's right.

## 5. Work jobs as they arrive

Each listener line is an event:

| Line | What to do |
|---|---|
| `connected to "<name>" … (n jobs waiting)` | Nothing; the waiting jobs follow, one line each. |
| `job <id> on "<screen>" (n marks, m asks). Run …` | Work it, as below. |
| `the author asked "<text>" …` | Work it, as below. |
| `whole-app job <id>: …` / `flow job on "<flow>" <id>: …` | Work it, as below: the same three steps. Its subagent changes `theme.css` first, then only the mocks that must change, and may split big edits by flow across its own subagents (the pack says how). |
| `the server for "<name>" has stopped` | Tell the author. Serve again and reconnect if they're still working. |

For each job:
1. **Claim it:** `node "${CLAUDE_PLUGIN_ROOT}/scripts/job.mjs" <project> start <id>`. This snapshots the screen's files into `history/` first.
2. **Start a background subagent** (Agent tool) with exactly the prompt `Read <pack path> and do the job it describes.` The pack (`jobs/<id>.md`) holds everything: the screen, its states and files, every mark with its target element, the asks, the rules. Don't add your own context: the pack is the contract.
3. **When it finishes,** take its `SUMMARY:` line and report: `job.mjs <project> done <id> --summary "<summary>"`. If it failed or needs the author's call: `job.mjs <project> fail <id> --error "<what's needed>"`.
4. **Tell the board what you're doing:** `node "${CLAUDE_PLUGIN_ROOT}/scripts/listen.mjs" <project> --state working --message "Updating 2 screens"` while jobs run, `--state ready --message "<what changed>"` when the last one is done, `--state error --message "…"` if you're stuck.

Jobs on different screens run in parallel: start one subagent per job as they arrive. The server gives each screen one job at a time, and a whole-app or flow job is **exclusive**: it is offered only when no job runs on the screens it covers, and jobs on those screens are offered only after it's done. So just work every line you get; the waiting is the server's. Don't do a job's work in this conversation yourself, except a one-line fix.

## 6. Export when asked

When the author says "export the spec" (or the board's Export points them here):

1. `node "${CLAUDE_PLUGIN_ROOT}/scripts/export.mjs" <project>`. It writes `<product repo>/docs/design/<slug>/`: a read-only board (`index.html`, opens from disk), the mocks and kit, `board.json`, `notes.json`, `screens/*.png`, and a `spec.md` skeleton with every flow, screen and state and its intent. If `spec.md` already exists, it writes `spec.skeleton.md` and keeps yours.
2. **Fill in `spec.md`.** Read the board, the mocks and the notes (resolved marks are the decisions made with the author). Write, under the skeleton's headings:
   - **The experience in words:** flow by flow, what the user does and sees; screen by screen, what's on it and why; state by state, when it happens and what changes.
   - **Decisions settled:** each with the reason, from the author's notes and resolved marks ("Connector slots show only their purpose on Answer: the author wanted a hint, not the word").
   - **Open questions:** what the author left unresolved, open marks, and anything you decided that they never confirmed.
   - Use the product's glossary terms. No implementation plan: that's the build session's job.
3. Tell the author the folder in their repo, and that a later session can build from `spec.md` and the mocks.

## Done means

The board covers the experience with every state's mock rendered and checked, every flow, screen and state has an intent, you're connected while the author works, and every job offered so far has been claimed and reported. After an export, `spec.md` is written, not left a skeleton.
