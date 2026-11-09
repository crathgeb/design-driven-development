# Writing and revising mocks

How a worker writes a mock for a design-driven-development board, or revises one from the author's marks. A mock is one **state** of one **screen**: a static HTML page rendered at 390×844 in the author's board. The author judges the design by looking at it, so it must look like the real app with real content, and show exactly what its intent says.

## The files

- One file per state: `<project>/mocks/<screen-id>--<state-id>.html`. Start a new one from `templates/mock.html` (beside this skill's plugin root).
- Link the kit as `/kit/mock.css`, then the project theme as `/theme.css`, and `/kit/mock.js`; images as `/assets/<file>` (put new images in `<project>/assets/`). Export rewrites these links; don't make them relative.
- The page is self-contained: no build step, no frameworks, no external fonts or scripts.
- The page itself scrolls; don't use `position: fixed` or inner scrolling areas. The author's marks are stored in page coordinates, and they must stay on what they point at. Most states should fit in 844 px; a long list may scroll, and then the extra content is part of the design.

## The kit

`kit/README.md` lists every class with an example, and `kit/example.html` shows them all. Build every mock from them: status bar, nav bar, cards, the deck with peeking neighbours, lists, chips, buttons, segmented control, mic, word chips, banners, sheets, keyboard. Kit classes are why mocks from different workers look like one app.

- **Product look:** lives in the project's `theme.css` (`<project>/theme.css`, linked after the kit), which overrides the kit's variables for every mock at once. **Never hard-code brand colours, fonts or radii in a mock**, and don't copy theme overrides into a mock's `<style>`: use the variables (`var(--accent)`, `var(--font)`, `var(--r-lg)`). A screen job doesn't change `theme.css` (it's shared); whole-app requests do.
- **Your own CSS:** only for what the kit lacks, in the mock's `<style>`, built on the kit's variables (`var(--surface)`, `var(--s3)`, `var(--r-lg)`). If another mock on the board already styles the same thing, copy its rules rather than inventing new ones.
- **Not part of the product:** label alternatives and concept sketches with `.mock-label` ("Alternative B · not proposed") so no one mistakes them for the proposal.

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

If you can, render your files and look at them (`node <plugin>/scripts/shoot.mjs <project>` writes PNGs of every state; open only yours). Check: nothing overflows the 390 width, the important content fits in 844, text isn't clipped, the state shows what its intent says, the sample data matches the other screens, and dark mode (`?theme=dark`) still reads if the product supports it.

## Finish

End your reply with one line: `SUMMARY: <what changed, one sentence for the author>`. It appears in the board's Activity list, so write it for them: "Thread card: Answer now shows each Connector's purpose in its slot; added a 'not yet' state".
