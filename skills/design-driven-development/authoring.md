# Writing and revising mocks

How a worker writes a mock for a design-driven-development board, or revises one from the author's marks. A mock is one **state** of one **screen**: a static HTML page rendered at its **device**'s size in the author's board (a phone 390×844, a tablet 820×1180, a laptop 1280×800, a desktop 1440×900, or a custom size; the context pack says which for each state). The author judges the design by looking at it, so it must look like the real app with real content, and show exactly what its intent says.

## The files

- One file per state: `<project>/mocks/<screen-id>--<state-id>.html`. Start a new one from the template for its device (beside this skill's plugin root): `templates/mock.html` (phone), `templates/mock-tablet.html` (tablet), `templates/mock-desktop.html` (laptop, desktop; a custom size from 1024 wide).
- Link the kit as `/kit/mock.css` (and `/kit/desktop.css` after it for a tablet or desktop), then the project theme as `/theme.css`, and `/kit/mock.js`; images as `/assets/<file>` (put new images in `<project>/assets/`). Export rewrites these links; don't make them relative.
- The page is self-contained: no build step, no frameworks, no external fonts or scripts.
- The page itself scrolls; don't use `position: fixed` or inner scrolling areas. The author's marks are stored in page coordinates, and they must stay on what they point at. Most states should fit in the device's height (844 on a phone, 900 on a desktop); a long list may scroll, and then the extra content is part of the design.

## The kit

`kit/README.md` lists every class with an example; `kit/example.html` shows the phone kit and `kit/example-desktop.html` the desktop one. Build every mock from them: on a phone, status bar, nav bar, cards, the deck with peeking neighbours, lists, chips, buttons, segmented control, mic, word chips, banners, sheets, keyboard; on a desktop, the app shell (side nav, top bar), page header with breadcrumbs and actions, grids and cards, tables, forms, tabs, toolbars and filters, menus, dialogs, toasts, the split view. Kit classes are why mocks from different workers look like one app.

- **Product look:** lives in the project's `theme.css` (`<project>/theme.css`, linked after the kit), which overrides the kit's variables for every mock at once. **Never hard-code brand colours, fonts or radii in a mock**, and don't copy theme overrides into a mock's `<style>`: use the variables (`var(--accent)`, `var(--font)`, `var(--r-lg)`). A screen job doesn't change `theme.css` (it's shared); whole-app requests do.
- **Your own CSS:** only for what the kit lacks, in the mock's `<style>`, built on the kit's variables (`var(--surface)`, `var(--s3)`, `var(--r-lg)`). If another mock on the board already styles the same thing, copy its rules rather than inventing new ones.
- **Not part of the product:** label alternatives and concept sketches with `.mock-label` ("Alternative B · not proposed") so no one mistakes them for the proposal.

## Devices

Design for the state's device; never shrink a phone design onto a desktop or stretch one across it.

- **Desktop and laptop** (a web app): the app shell (`.app` with `.sidenav`, `.topbar`, `.page`), a page header with breadcrumbs and the page's actions on the right, content in a grid or a table, forms with labels beside the fields. Use the width: a table instead of a list of cards, a split view instead of a drill-down, the detail beside the list. Desktop density: 14 px text, 36 px controls, 44 px rows (`kit/desktop.css` sets them). Keep a readable measure: long text in `.page.narrow` or a card, not 1400 px wide.
- **Hover and pointer states** are part of a desktop design, and mocks are static: show a hovered row, button or menu item with `.hover`, an open dropdown by putting its `.menu` in the page, a tooltip with `.tooltip`. Give them their own states when they matter ("Row actions on hover").
- **Dialogs and toasts** are absolute, not fixed: `.modal-backdrop` last in `<body>` covers the page; `.toast-stack` sits bottom right.
- **Tablet**: touch sizes (`<html class="touch">`), the phone kit's bars and controls, with the room used: two columns, a split view in landscape-like layouts, sheets as centred cards.
- **Responsive pairs**: when the author wants a screen on several devices, each device is its own state on the same screen (`--device phone` on the phone state). Prefer one markup that reflows (`kit/desktop.css` collapses the nav, stacks grids and form rows, and turns dialogs into sheets under 600 px), and say in each state's intent what changes between them and why.
- **Check the size:** nothing overflows the device's width; the first screenful (the device's height) shows what the state is about.

## The cast

Every mock on a board uses the same sample world: the same user, the same content, the same numbers. If the profile screen says Léa is 34 and has two children, every other screen agrees, and a count of "5 of 7" on one screen matches the 7 rows on the next.

- **Read the other screens' mocks before writing** (the pack lists them). Reuse their names, wording and figures. Don't edit them.
- **Real content, never lorem ipsum.** Write in the product's language, with the product's terms (its glossary), at the length real content has. A language app shows correct sentences with their translations; a finance app shows plausible amounts that add up.
- **Make the data do work.** Pick content that exposes the design's hard parts: a long name that might wrap, a list long enough to need its limit, a number at its edge.

## The states

A screen is only designed once its hard states are. When you add or are asked for states, think through: empty, first-time vs returning, partial, in progress, error and recovery, long content, keyboard up, offline, done. Each is its own file and its own row on the board. Show the state's moment precisely: mid-recording means the mic is listening and the words said so far are lit, not a generic screen with a caption.

## Intent

Every screen and state on the board has an intent: why it looks like this and what it decides. It sits beside the mock, and export turns it into the spec.

- Write it as the reason, not a description of pixels: "Keep is disabled until the blank is filled, so a half Sentence can't be saved", not "a grey button at the bottom".
- Name the decision when there is one, so the author can mark it: "Decision to check: a full stop is a valid join."
- When you change a state's design, update its intent in the same job. If a mark asks for something you decide not to do, say why in the intent.

## Board changes

Use `board.mjs`; never write `board.json` yourself (other workers are editing it at the same time).

```sh
node <plugin>/scripts/board.mjs <project> show
node <plugin>/scripts/board.mjs <project> add-state --screen <screen-id> --id <state-id> --title "<title>" --intent "<why>"
node <plugin>/scripts/board.mjs <project> update --screen <screen-id> --state <state-id> --intent "<new intent>"
```

Write the new state's HTML file first, then add it to the board. Ids are kebab-case.

## Revising from marks

The context pack lists each mark: its number, its shape (pin, box, ellipse, arrow, pen, or a note with no drawing), its coordinates in the mock's page, the **target** (a CSS selector and the text of the element under the mark), and the author's note.

- **Find what the mark points at** by its target selector and text first; the coordinates confirm where. An arrow points from one place to another: its head is the target. A box or ellipse covers an area: everything inside it. A mark with no note means "look at this": decide what's wrong there, or say in the intent that you couldn't tell.
- **Every mark gets a response:** a change to the mock, or a reason in the intent.
- **Respect the author's notes.** The screen and state notes are their context and decisions; follow them even when you'd design it differently, and say so in the intent if you think they should know something.
- **Change only your screen's files** (and new states for it). If a mark implies a change on another screen ("this count should match the hub"), mention it in your summary instead.
- **Never edit `notes.json`**, `jobs/`, `history/` or `server.json`. Don't start or stop servers; the board reloads changed files by itself.

## Requests for the whole app or a flow

Some jobs aren't about one screen: "make it feel warmer", "try a bolder type scale", "rename Drill to Practice everywhere", "calmer Learn screens". Their pack lists every screen they cover.

- **Theme first.** Most look-and-feel requests are a change to `theme.css`; prefer it to editing every mock. A flow request leaves `theme.css` alone (other flows share it).
- **Shared vocabulary.** A rename changes the board's titles and intents (board commands) and the words in every mock that shows them.
- **Then only the mocks that must change**, and remove brand values they hard-code. More than ~8 mocks: split by flow across subagents, then verify.

## Check your work

If you can, render your files and look at them (`node <plugin>/scripts/shoot.mjs <project>` writes PNGs of every state; open only yours). Each PNG is the state's device viewport. Check: nothing overflows the device's width, the important content fits in its height, text isn't clipped, the state shows what its intent says, the sample data matches the other screens, and dark mode (`?theme=dark`) still reads if the product supports it.

## Finish

End your reply with one line: `SUMMARY: <what changed, one sentence for the author>`. It appears in the board's Activity list, so write it for them: "Thread card: Answer now shows each Connector's purpose in its slot; added a 'not yet' state".
