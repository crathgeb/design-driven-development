# The mock kit

`kit/mock.css` is the shared look of every mock: a modern iOS screen at 390×844, light and dark. Use its classes so every worker's screens look like the same app. `kit/example.html` shows every component (open it at 390 wide, add `?theme=dark` for dark); it is also the kit's visual test.

- **Link it** as `/kit/mock.css`, then the project theme as `/theme.css` (and `/kit/mock.js`, optional) — `templates/mock.html` already does. The board server serves both (`/theme.css` is an empty stylesheet when a project has none); `export.mjs` copies them beside the mocks and rewrites the links to `../kit/mock.css` and `../theme.css`.
- **Theme** with CSS variables, in the project's `theme.css` (at the project folder's root): the brand for every mock at once (`:root { --accent: #0A7AFF; --font: … }`). Give dark values too, under `:root[data-theme='dark']` and `@media (prefers-color-scheme: dark)`. Dark applies under `prefers-color-scheme: dark` or `<html data-theme="dark">`; `?theme=dark|light` on a mock's URL forces one (via `mock.js`).
- **Mocks never hard-code the brand.** No hex colours, font stacks or radii that the theme provides in a mock's `<style>`: use the variables (`var(--accent)`, `var(--font)`, `var(--r-lg)`), so a change to `theme.css` restyles every screen.
- **Write little CSS of your own.** If a mock needs a style the kit lacks, put it in the mock's `<style>` using the kit's variables. If several mocks need it, it belongs in the kit.
- **Coordinates matter.** Marks are stored in document coordinates, so don't use `position: fixed` or inner scrolling areas: the page itself scrolls. `.bottom` sits at the bottom of a short screen and flows after the content of a long one.

## Tokens

| Variable | Use |
|---|---|
| `--bg` `--surface` `--surface-2` `--surface-3` | page, cards, inset fills (segmented track), grey word boxes |
| `--text` `--muted` `--faint` `--border` | text, secondary text, placeholders, hairlines |
| `--accent` `--accent-text` `--accent-soft` | primary colour, text on it, its tint |
| `--success` `--warning` `--danger` (+ `-soft`), `--success-text` | states: right, close, wrong |
| `--l1` `--l2` `--l3` (+ `-soft`) | three category ("layer") colours a product colour-codes |
| `--s1`…`--s8` | spacing 4, 8, 12, 16, 20, 24, 32, 44 |
| `--r-sm` `--r-md` `--r-lg` `--r-xl` `--r-pill` | radii 8, 12, 18, 24, pill |
| `--font` `--mono` `--gutter` | system font, monospace, 16px side margin |

## Screen skeleton

| Class | Example |
|---|---|
| `.screen` | `<div class="screen">…</div>`: the whole phone screen, a column at least 844 high |
| `.screen.surface` | white page instead of `--bg` |
| `.status-bar` | `<header class="status-bar">9:41</header>`: time, signal, wifi, battery. `.on-dark` for white |
| `.nav-bar` | `<nav class="nav-bar"><a class="nav-back">Learn</a><span class="nav-title">About you</span><a class="nav-action">Edit</a></nav>` (use `<span></span>` for an empty side) |
| `.nav-back` / `.nav-back.plain` | back button as a white pill (default) or plain blue link |
| `.nav-action` / `.nav-action.round` | text action, or a round icon button: `<a class="nav-action round"><i class="icon i-more"></i></a>` |
| `.content` | `<main class="content">`: padded column with 16px gaps. `.flush` drops side padding |
| `.bottom` | `<div class="bottom">`: actions pinned under the content |
| `.home-indicator` | `<div class="home-indicator"></div>`: last element. `.overlay` floats it over a sheet |
| `.tab-bar` | `<nav class="tab-bar"><span class="on"><i class="icon i-home"></i>Home</span>…</nav>` |

## Text

| Class | Example |
|---|---|
| `.large-title` | `<h1 class="large-title">Learn</h1>` (34) |
| `.title` / `.headline` | `<h2 class="title">20% learned</h2>` (24) / `<p class="headline">` (17 semibold) |
| `.section-label` | `<p class="section-label">By topic</p>`: small caps header over a list |
| `.prompt` / `.prompt.lg` | `<p class="prompt">Comment vous appelez-vous ?</p>`: a question, italic and muted |
| `.big-text` | `<p class="big-text">Je m'appelle Léa.</p>`: the main content of a card (27 bold) |
| `.body-text` | 19, for paragraphs of content |
| `.translation` | `<p class="translation">My name is Léa.</p>` |
| `.meta` `.caption` `.hint` | small muted lines: `<p class="meta">Card 3 of 18</p>` |
| `.muted` `.faint` `.small` `.strong` `.center` `.accent` `.success` `.warning` `.danger` | text helpers |

## Layout

| Class | Example |
|---|---|
| `.stack` (`.tight`, `.loose`) | vertical column, 12px gaps (8, 20) |
| `.hstack` (`.between`, `.wrap`) | `<div class="hstack between">…</div>` |
| `.grow` `.spacer` | take the remaining room |
| `.divider` | `<hr class="divider">` |

## Cards and decks

| Class | Example |
|---|---|
| `.card` | `<article class="card">…</article>`: white, rounded, soft shadow, 12px gaps |
| `.card.compact` `.flat` `.tall` `.inset` `.selected` | less padding; border instead of shadow; 440 min height (a deck card); grey well; blue outline |
| `.card-foot` | footer pinned to the bottom of a tall card, with a hairline above |
| `.deck` | `<div class="deck"><div class="peek prev"></div><article class="card tall">…</article><div class="peek next"></div></div>`: the current card with neighbours peeking at the edges (leave out a `.peek` at either end). Put it in `.content.flush` |
| `.deck-meta` | `<p class="deck-meta">Card 3 of 18 · 2 learned</p>` |
| `.dots` | `<div class="dots"><i class="done"></i><i class="on"></i><i></i></div>` |
| `.panel` / `.panel.raised` | the controls under a card; `.raised` gives it a white sheet-like top |
| `.panel-row` | a row of controls with space between |

## Lists

| Class | Example |
|---|---|
| `.list` (`.flat`) | `<div class="list"><div class="row">…</div></div>`: grouped rows with hairlines |
| `.row` | `<div class="row"><span class="check on"></span><div class="row-main"><span class="row-title">Je suis née à Lyon.</span><span class="row-sub">I was born in Lyon.</span></div><span class="row-end">Fact</span></div>` |
| `.row.link` | adds a chevron after `.row-end` |
| `.row.dim` `.row.selected` `.row.lifted` | faded; tinted; picked up while dragging |
| `.handle` | `<span class="handle"></span>`: drag grip |
| `.check` (`.on`, `.done`) | empty circle; blue ✓; green ✓ |
| `.num` (`.on`) | `<span class="num on">2</span>`: a numbered circle |
| `.seq`, `.seq-item`, `.seq-link` | items joined by links: `<div class="seq"><div class="seq-item">…</div><div class="seq-link"><span class="chip sm on">et</span></div><div class="seq-item">…</div></div>` |

## Controls

| Class | Example |
|---|---|
| `.btn` | `<button class="btn">Keep</button>`: primary, 50 high |
| `.btn.block` `.secondary` `.outline` `.quiet` `.success` `.danger` | full width; tinted; white with border; text link; green; red tint |
| `.btn.pill` `.btn.sm` `.btn.round` | `<button class="btn pill secondary"><i class="icon i-play sm"></i>Hear it</button>`; small pill; round icon button |
| `.btn-row` | buttons sharing a row equally |
| `.segmented` (`.neutral`) | `<div class="segmented"><span class="done">Listen</span><span class="on">Repeat</span><span>Answer</span></div>`: `.on` selected, `.done` gets a ✓ |
| `.tabs` | `<div class="tabs"><span class="on">Sentences</span><span>Threads</span></div>` |
| `.chips` + `.chip` | `<div class="chips"><span class="chip on">Je m'appelle…</span><span class="chip">Mon nom est…</span><span class="chip more">+2 more</span></div>`: `.on` adds ✓ |
| `.chip.sm` `.chip.add` `.chip .sub` | small; dashed "add"; a second, muted word: `<span class="chip sm">et <span class="sub">add</span></span>` |
| `.chips-label` | `<p class="chips-label">3 ways to answer</p>` |
| `.mic` (`.sm`, `.listening`) | `<span class="mic listening" style="--level:.7"></span>`: blue mic; red stop with a level ring |
| `.mic-label` (`.live`) | `<span class="mic-label live"><span class="level-bars"><i></i><i></i><i></i><i></i><i></i></span>Listening</span>` |
| `.field`, `.field-label`, `.input`, `.field-help` | `<div class="field"><label class="field-label">Your first name</label><div class="input focus">Léa</div></div>` |
| `.input.focus` `.input.placeholder` `.input-row` | focused with caret; placeholder text; input with a button beside it |
| `.keyboard` | `<div class="keyboard"></div>` at the end of the screen: an English QWERTY keyboard (`data-layout="azerty"` for French, `data-return="Next"` to relabel the return key) |

## Status

| Class | Example |
|---|---|
| `.progress` (`.success`, `.thin`, `.thick`) | `<div class="progress" style="--value:.4"></div>` |
| `.ring` (`.success`) | `<div class="ring" style="--value:.35">35%</div>` (`--size` to resize) |
| `.stat` | a big number: `<span class="stat">20% learned</span>` |
| `.badge` | `<span class="badge l1">Fact</span>`: outlined pill. `.l1 .l2 .l3 .success .warning .danger .muted`; `.soft` fills it; `.solid` makes it accent |
| `.count` `.dot` | `<span class="count">3</span>`; `<span class="dot l2"></span>` |
| `.banner` | `<div class="banner success"><i class="icon i-check"></i><span><b>Learned.</b> <span class="banner-text">Practise it any time.</span></span></div>`: also `.warning .danger .neutral` |
| `.toast` (`.bottom`) | `<span class="toast"><i class="icon i-check sm"></i>Thread saved</span>`: floats near the top (or bottom) |
| `.empty` | `<div class="empty"><div class="empty-icon"><i class="icon i-link"></i></div><p class="empty-title">No Threads yet</p><p class="empty-text">…</p><button class="btn pill">…</button></div>` |
| `.scrim` + `.sheet` | `<div class="scrim"></div><div class="sheet"><p class="sheet-title">…</p>…</div>`: a bottom sheet over a dimmed screen |

## Speech and fill-in

| Class | Example |
|---|---|
| `.words` (`.md`, `.sm`) + `.w` | `<div class="words"><span class="w ok">J'ai</span><span class="w close">enfant</span><span class="w miss">qui</span><span class="w box">ont</span><span class="w punct">.</span></div>`: words said right (green chip), close (amber), missed (red text), not yet said (grey box the word's width), `.next` underlines the word expected next |
| `.heard` | `<p class="heard">You're saying: <b>j'ai deux enfant</b></p>` |
| `.blank` (`.active`) | `<span class="blank active">00</span>`: an empty blank (its text sets the width) |
| `.slot` (`.active`) | `<span class="slot">Léa</span>`: a filled blank |

## Icons

`<i class="icon i-mic"></i>`, coloured by the text colour; `.sm` (16) and `.lg` (26). Names: back, chevron, down, play, pause, stop, mic, check, plus, close, edit, speaker, grip, search, more, arrow, again, link, info, warn, star, home, list, gear, sparkle, lock, keyboard, flag.

## Not part of the product

| Class | Example |
|---|---|
| `.mock-label` (`.warn`) | `<span class="mock-label warn">Alternative B</span>`: a tag in the corner saying what a mock is (an alternative, a concept sketch), so nobody mistakes it for the proposal |
