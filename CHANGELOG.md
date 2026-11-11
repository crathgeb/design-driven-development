# Changelog

## Unreleased

- **Full screen:** a mark's note card no longer stays open. It folds into the toolbar when you're done (Enter, its ×, or clicking elsewhere), and the toolbar's note button, with the count of marks on the state, shows it again. Its trash button deletes the mark if you change your mind before sending.

## 0.4.0 (2026-11-10): full screen, export from the board

- **Full screen in the focus view.** **F** (or the button beside the zoom) hides the top bar, sidebar, tool rail, strip and panel and fits the state to the window, which matters most for desktop states. A floating vertical toolbar, docked on the left, keeps marking up possible: the tools, Send to Claude with the count to send, and Exit. Drag it anywhere by its grip (it remembers where), double-click to dock it; the selected mark's note opens as a card beside it.
- **Export from the board.** The Export popover is a request box prefilled with "export the spec" that you can extend ("…and break the work into epics and stories") and send. It becomes an `export` job (`POST /api/ask` with `scope: "export"`), which covers no screen and runs alongside other jobs; its context pack says how to run `export.mjs`, write `spec.md`, and anything else asked for as its own file. The listener prints `export job <id>: …`, Activity lists it, and the pill says "Exporting the spec".
- A mark just drawn stays selected (the click ending the drag no longer deselects it).

## 0.3.0 (2026-11-09): devices

- **Not just phones.** A project is designed for a device: `phone` (390×844), `tablet` (820×1180), `laptop` (1280×800), `desktop` (1440×900) or any `WxH`. `ddd.mjs init --device`, `ddd.mjs set-device`; `board.mjs add-screen|add-state|update --device` gives a screen or a state its own (`inherit` drops it), so one board can hold a responsive design. A state's device beats its screen's, which beats the project's; projects from before keep the phone. `lib/devices.mjs` resolves it for everything.
- **Board:** frames are sized to each state's device, with a chrome to match (a phone, a tablet, a browser window with the state's title in its address bar, a plain frame), and scaled so wide frames sit tidily beside phones. The focus view fits any size and zooms (Fit, −, +, 100%), marks work at any size and scale, and the device is shown beside the zoom. Captions and the sidebar show a device when it isn't the project's.
- **Desktop kit:** `kit/desktop.css` (app shell, page header, grids, KPIs, tables, forms, toggles, tabs, toolbar and filters, menus, dialogs, toasts, split view, `.hover` states, responsive rules) on the same theme variables, with `kit/example-desktop.html`. Templates per device: `templates/mock-desktop.html`, `templates/mock-tablet.html`.
- **Everything else follows the device:** `shoot.mjs` renders each state at its viewport; the exported board shows the right frames and the spec skeleton names each state's device; context packs give every state's device, size and template; the skill picks the device from the product and `authoring.md` covers desktop layouts, density, hover states and responsive pairs.

## 0.2.0 (2026-11-09): renamed, public

- **Renamed** from design-first-spec to **design-driven-development**: plugin, marketplace, skill and `/design-driven-development`, server identity (`/api/health`), listener lines, page titles and docs. The CLI is `scripts/ddd.mjs`; `scripts/dfs.mjs` stays as a shim.
- **Project home** is `~/.design-driven-development/` (`DDD_HOME` overrides it). `~/.design-first-spec/` is still used while the new folder doesn't exist, with a one-time note on how to move it. `DFS_*` environment variables are read when the `DDD_*` ones aren't set, and a server started under the old name is recognised.
- **Export** goes to `<repo>/docs/design/<slug>/` (was `docs/design-first-specs/<slug>/`).
- **Screenshots**: `playwright-core` is an optionalDependency (`DDD_PLAYWRIGHT` points at another copy); without it, PNGs are skipped with the commands that install it. Any Chromium in playwright's cache (macOS, Linux, Windows) or a system Chrome is used when the matching one is missing. No machine-specific paths.
- The `/design-driven-development` command is now the skill itself (plugin skills are invocable by name), not a separate command file.
- The kit's stand-in keyboard is QWERTY by default (`data-layout="azerty"` for French); kit samples use a fictional cast.
- Public packaging: MIT license, README with screenshots, CI on Node 18 and 22 (ubuntu, macOS).

## 0.1.0

- First version as design-first-spec: board server, listener and jobs, board UI with drawing tools, sidebar, whole-app and flow requests with exclusive jobs, project `theme.css`, mock kit, export with a `spec.md` skeleton, the skill and its authoring guide.
