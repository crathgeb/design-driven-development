# The mock kit

`kit/mock.css` is the shared look of every mock: a modern touch screen (iOS-style bars, cards, lists, sheets), light and dark. `kit/desktop.css`, linked after it, adds a web app: an app shell with a left nav and a top bar, page headers, grids, tables, forms, menus, dialogs and a split view, at desktop density, on the same variables (see "Desktop and web" below). Use their classes so every worker's screens look like the same app.

`kit/example.html` shows every phone component (open it at 390 wide) and `kit/example-desktop.html` every desktop one (at 1440 wide; it reflows at 820 and 390); add `?theme=dark` for dark. They are also the kit's visual tests.

**Which template for which device** (the board says each state's device; the context pack names the template):

| Device | Size | Template | Kit |
|---|---|---|---|
| phone | 390×844 | `templates/mock.html` | `mock.css` |
| tablet | 820×1180 | `templates/mock-tablet.html` | `mock.css` + `desktop.css`, `<html class="touch">` |
| laptop, desktop | 1280×800, 1440×900 | `templates/mock-desktop.html` | `mock.css` + `desktop.css` |
| custom `W×H` | its size | desktop from 1024 wide, tablet from 600, else phone | as the template |

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
| `.screen` | `<div class="screen">…</div>`: the whole phone (or tablet) screen, a column at least the viewport high |
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

## Desktop and web (`kit/desktop.css`)

Link it after `mock.css` and before `/theme.css` (`templates/mock-desktop.html` does). It makes the shared components desktop-sized (36 px buttons and inputs, 14 px text, 44 px rows) unless `<html class="touch">` (tablets), and adds the classes below. Everything from `mock.css` still works: `.card`, `.badge`, `.banner`, `.btn`, `.chip`, `.tabs`, `.segmented`, `.progress`, `.empty`, `.list`, `.input`, icons.

Static mocks can't hover: show a hover with `.hover` (`.nav-item`, `.btn`, `.icon-btn`, `tr`, `.menu-item`, `.split-item`, `.card.link`) and an open menu by putting `.menu` in the page.

Extra variables: `--sidenav-w` (240), `--topbar-h` (56), `--page-max` (1200), `--row-h` (44), `--hover` (a faint tint for hovered rows).

| Class | Example |
|---|---|
| `.app` (`.no-nav`) | `<div class="app"><nav class="sidenav">…</nav><div class="main"><header class="topbar">…</header><main class="page">…</main></div></div>`: the shell |
| `.sidenav`, `.sidenav-brand`, `.logo`, `.nav-section`, `.nav-item` (`.on`, `.hover`), `.nav-end`, `.sidenav-foot`, `.who` | `<a class="nav-item on"><i class="icon i-list"></i>Invoices<span class="count">3</span></a>` |
| `.topbar`, `.search`, `.kbd`, `.icon-btn` (`.dot` for a badge), `.avatar` (`.sm`, `.lg`, `.l1`, `.l2`), `.avatars` | `<header class="topbar"><div class="search"><i class="icon i-search"></i>Search…<span class="kbd">/</span></div><span class="spacer"></span><span class="avatar sm">LM</span></header>` |
| `.page` (`.wide`, `.narrow`), `.page-head`, `.breadcrumbs`, `.page-title`, `.page-sub`, `.page-actions` | `<div class="page-head"><div><nav class="breadcrumbs"><a>Billing</a><span>Invoices</span></nav><h1 class="page-title">Invoices</h1></div><div class="page-actions"><button class="btn">New invoice</button></div></div>` |
| `.section-head`, `.section-title` | a heading row inside a page |
| `.grid` (`.cols-2`, `.cols-3`, `.cols-4`, `.auto`), `.span-2`, `.span-3`, `.span-all` | `<div class="grid cols-4"><article class="card kpi">…</article>…</div>` |
| `.card-head`, `.card-title`, `.card.link` | a card's title row |
| `.kpi`, `.kpi-label`, `.kpi-value`, `.delta` (`.up`, `.down`), `.bars` | `<article class="card kpi"><span class="kpi-label">Overdue</span><span class="kpi-value">€3,150</span><span class="delta down">2 invoices</span></article>`; `<div class="bars"><i style="--v:.4"></i><i class="on" style="--v:.8"></i></div>` |
| `.table-wrap`, `.table` (`.compact`), `.num`, `.cell-main`, `.cell-sub`, `tr.hover`, `tr.selected`, `th.sorted`, `.table-foot`, `.pager` | `<div class="table-wrap"><table class="table"><thead><tr><th>Client</th><th class="num">Amount</th></tr></thead><tbody><tr><td><span class="cell-main">Café Noisette<span class="cell-sub">Paris</span></span></td><td class="num">€860.50</td></tr></tbody></table></div>` |
| `.form`, `.form-section` (with a `<header>`), `.form-fields`, `.form-row`, `.fields-2`, `.form-actions` | `<div class="form-row"><label class="label">Client</label><div class="input select">Boulangerie Roux</div></div>` |
| `.label` (`.opt`), `.help`, `.error-text`, `.input.error`, `.input.disabled`, `.textarea`, `.select`, `.prefix`, `.suffix` | inputs on `mock.css`'s `.input` |
| `.toggle`, `.checkbox`, `.radio` (`.on`), `.option`, `.option-text` | `<label class="option"><span class="toggle on"></span><span class="option-text">Remind before the due date<span>3 days before</span></span></label>` |
| `.tabs.line` (`.count` inside a tab), `.toolbar`, `.filter` (`.on`) | `<div class="toolbar"><div class="search">…</div><span class="filter on">Status: <b>Sent</b></span><span class="spacer"></span><button class="btn sm outline">Sort</button></div>` |
| `.has-menu`, `.menu` (`.left`, `.static`), `.menu-label`, `.menu-item` (`.on`, `.hover`, `.danger`), `.menu-sep`, `.tooltip` | `<div class="has-menu"><button class="btn outline sm">Sort</button><div class="menu"><a class="menu-item on">Due date</a>…</div></div>` |
| `.modal-backdrop`, `.modal` (`.lg`), `.modal-head`, `.modal-title`, `.modal-body`, `.modal-foot` | last in `<body>`: `<div class="modal-backdrop"><div class="modal">…</div></div>` (covers the page; absolute, not fixed) |
| `.toast-stack` + `.toast`, `.toast-action` | `<div class="toast-stack"><span class="toast"><i class="icon i-check sm"></i>Sent<span class="toast-action">Undo</span></span></div>`: bottom right |
| `.split` (`--split-w`), `.split-list`, `.list-head`, `.split-item` (`.on`, `.hover`), `.split-top`, `.split-detail` | a list beside its detail (mail, inbox, clients) |
| `.empty.boxed` | the kit's `.empty`, in a dashed box, for a page section with nothing in it |
| `.desc` | `<dl class="desc"><dt>Client since</dt><dd>March 2024</dd></dl>`: label and value pairs |
| `.only-wide`, `.only-narrow` | shown above or below 600 px wide |

**Responsive.** Under 1100 px a four-column grid becomes two and form sections stack; under 900 px the side nav becomes an icon rail; under 600 px the nav hides, grids are one column, form rows stack, the split view shows one pane, tables scroll and dialogs become bottom sheets. So one desktop mock's markup also reads at a phone's width: for a responsive pair, give the phone state the same markup (or its own `templates/mock.html` layout when the phone design differs).
