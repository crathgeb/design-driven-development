# Changelog

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
