// The board app: renders a project's flows, screens and states as live frames sized to each state's
// device (phone, tablet, desktop or laptop browser window, or a custom size), the focus
// view where the author draws marks (pin, box, ellipse, arrow, pen, note) over a state (also full screen,
// with a floating toolbar the author can drag), the sidebar
// (every flow and screen, the one in view highlighted), the Whole app panel (design direction and
// requests for the whole app, a flow or a screen), and the Claude controls (Send, Ask, Activity, and
// Export, which sends an export request).
// Talks to lib/server.mjs (/api/project, /api/notes,
// /api/send, /api/ask, SSE /api/stream). With a <script id="ddd-data"> in the page (the exported
// spec) it runs read-only from that data, with no server. No framework, no build step.

(() => {
  'use strict';

  // Each state's device comes from the server (/api/project "devices", resolved by lib/devices.mjs) or the
  // exported data; a board without them (an older export) is all phones.
  const PHONE = { name: 'phone', label: 'Phone', width: 390, height: 844, kind: 'phone' };
  // On the board a frame fits a box of zoom × (BOX_W × BOX_H): a phone at the zoom, wider devices smaller.
  const BOX_W = 900;
  const BOX_H = 844;
  const THUMB_W = 240;
  const THUMB_H = 169;
  const STAGE_STEPS = [0.25, 0.33, 0.5, 0.67, 0.75, 0.9, 1, 1.25, 1.5, 2];
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const DATA = document.getElementById('ddd-data');
  const READ_ONLY = !!DATA;
  const CLIENT = Math.random().toString(36).slice(2, 10);
  const SVGNS = 'http://www.w3.org/2000/svg';
  const SHAPES = { pin: 'Pin', box: 'Box', ellipse: 'Ellipse', arrow: 'Arrow', pen: 'Pen', note: 'Note' };
  const HINTS = {
    select: 'Click a mark to select it. Scroll the mock as usual.',
    pin: 'Click to drop a pin.',
    box: 'Drag to draw a box.',
    ellipse: 'Drag to draw an ellipse.',
    arrow: 'Drag from the tail to the point.',
    pen: 'Draw freehand.',
  };
  const TOOL_KEYS = { v: 'select', p: 'pin', b: 'box', e: 'ellipse', a: 'arrow', d: 'pen', n: 'note' };

  const store = {
    get(k, d) {
      try {
        const v = localStorage.getItem('ddd:' + k);
        return v == null ? d : JSON.parse(v);
      } catch {
        return d;
      }
    },
    set(k, v) {
      try {
        localStorage.setItem('ddd:' + k, JSON.stringify(v));
      } catch {}
    },
  };

  const S = {
    project: null,
    board: { flows: [] },
    devices: null, // { default, states: { "<screen>/<state>": { name, label, width, height, kind } } }
    notes: { general: '', app: { note: '' }, screens: {}, asks: [] },
    jobs: [],
    claude: { connected: false, phase: 'idle', message: '' },
    zoom: clampZoom(store.get('zoom', 0.55)),
    stageZoom: store.get('stageZoom', 'fit'), // 'fit' or a scale for the focus view
    focus: null, // { screen, state }
    full: false, // the focus view is full screen: just the state and the floating toolbar
    fsBar: store.get('fsBarV', null),
    fsNote: false, // full screen: the selected mark's note card is open (else it's folded into the toolbar) // where the author left the full-screen toolbar ({ x, y }), or null: docked
    tool: 'select',
    hot: null, // selected mark id
    sig: '',
    side: store.get('side', true), // the sidebar is open
    folded: new Set(store.get('folded', [])), // flows folded in the sidebar
    current: null, // the screen in view (board) or in focus
    filter: '',
  };

  function clampZoom(z) {
    const n = Number(z);
    return Number.isFinite(n) ? Math.min(1, Math.max(0.35, Math.round(n * 100) / 100)) : 0.55;
  }
  const el = (tag, attrs = {}, ...kids) => {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === 'class') e.className = v;
      else if (k === 'text') e.textContent = v;
      else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
      else e.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids) if (kid != null) e.append(kid);
    return e;
  };
  const svg = (tag, attrs = {}) => {
    const e = document.createElementNS(SVGNS, tag);
    for (const [k, v] of Object.entries(attrs)) if (v != null) e.setAttribute(k, v);
    return e;
  };
  const r1 = (v) => Math.round(v * 10) / 10;

  // ---------- data ----------

  async function api(method, path, body) {
    const res = await fetch(path, {
      method,
      headers: body === undefined ? {} : { 'content-type': 'application/json', 'x-ddd-client': CLIENT },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!res.ok) throw new Error((await res.text()) || res.statusText);
    return res.status === 204 ? null : res.json();
  }

  async function load() {
    if (READ_ONLY) {
      const d = JSON.parse(DATA.textContent);
      Object.assign(S, { project: d.project, board: d.board, devices: d.devices || null, notes: normNotes(d.notes), jobs: d.jobs || [] });
      return;
    }
    const d = await api('GET', 'api/project');
    Object.assign(S, { project: d.project, board: d.board, devices: d.devices || null, notes: normNotes(d.notes), jobs: d.jobs, claude: d.claude });
  }

  function normNotes(n) {
    const notes = n && typeof n === 'object' ? n : {};
    notes.general = notes.general || '';
    notes.screens = notes.screens || {};
    notes.asks = notes.asks || [];
    notes.app = notes.app && typeof notes.app === 'object' ? notes.app : { note: '' };
    notes.app.note = notes.app.note || '';
    return notes;
  }

  // ---------- devices ----------

  const defaultDevice = () => S.devices?.default || PHONE;
  const deviceOf = (screen, state) => S.devices?.states?.[`${screen}/${state}`] || defaultDevice();
  const sameDevice = (a, b) => a.name === b.name && a.width === b.width && a.height === b.height;
  const deviceText = (d) => `${d.label} · ${d.width}×${d.height}`;
  const DEVICE_ICONS = {
    phone: '<rect x="4.5" y="1.5" width="7" height="13" rx="1.8"/><path d="M7 12.5h2"/>',
    tablet: '<rect x="2.5" y="1.5" width="11" height="13" rx="1.8"/><path d="M7 12.5h2"/>',
    desktop: '<rect x="1.5" y="2.5" width="13" height="8.5" rx="1.2"/><path d="M6 14h4M8 11v3"/>',
    laptop: '<rect x="3" y="3" width="10" height="7.5" rx="1"/><path d="M1.5 13h13"/>',
    custom: '<rect x="2.5" y="2.5" width="11" height="11" rx="1.5" stroke-dasharray="2 1.6"/>',
  };
  const deviceIcon = (d) => {
    const s = document.createElementNS(SVGNS, 'svg');
    s.setAttribute('viewBox', '0 0 16 16');
    s.setAttribute('aria-hidden', 'true');
    s.innerHTML = DEVICE_ICONS[d.name] || DEVICE_ICONS.custom;
    return s;
  };
  /** A frame's scale on the board: the zoom, smaller for devices wider or taller than the board's box. */
  const boardScale = (d) => S.zoom * Math.min(1, BOX_W / d.width, BOX_H / d.height);
  const thumbScale = (d) => Math.min(THUMB_W / d.width, THUMB_H / d.height);
  /** The browser window's title bar height at scale z (desktop and laptop frames); 0 for other frames. */
  const chromeHeight = (d, z, fixed) => (d.kind !== 'browser' ? 0 : fixed || Math.round(Math.max(8, Math.min(30, 40 * z))));

  const screenNotes = (screen) => S.notes.screens[screen] || null;
  const stateNotes = (screen, state) => S.notes.screens[screen]?.states?.[state] || null;
  const marksOf = (screen, state) => stateNotes(screen, state)?.marks || [];
  function ensureState(screen, state) {
    const s = (S.notes.screens[screen] ||= { note: '', states: {} });
    s.states ||= {};
    return (s.states[state] ||= { note: '', marks: [] });
  }
  const openMarks = (screen, state) => marksOf(screen, state).filter((m) => (m.status || 'open') === 'open');
  const screenOpenCount = (screen) => {
    const states = screenNotes(screen)?.states || {};
    let n = Object.keys(states).reduce((t, st) => t + openMarks(screen, st).length, 0);
    n += S.notes.asks.filter((a) => a.screen === screen && (a.status || 'open') === 'open').length;
    return n;
  };
  const totalOpen = () => {
    let n = 0;
    for (const [screen, s] of Object.entries(S.notes.screens)) for (const st of Object.keys(s.states || {})) n += openMarks(screen, st).length;
    return n + S.notes.asks.filter((a) => (a.status || 'open') === 'open').length;
  };
  function findScreen(id) {
    for (const flow of S.board.flows) for (const screen of flow.screens || []) if (screen.id === id) return { flow, screen };
    return null;
  }
  const findFlow = (id) => S.board.flows.find((f) => f.id === id) || null;
  const allScreenIds = () => S.board.flows.flatMap((f) => (f.screens || []).map((s) => s.id));
  /** The screens a job may change (as the server's jobCoverage): every screen, a flow's, one, or none (a loose ask, an export). */
  function jobScreens(j) {
    if (j.kind === 'app') return allScreenIds();
    if (j.kind === 'flow') return (findFlow(j.flow)?.screens || []).map((s) => s.id);
    return j.screen ? [j.screen] : [];
  }
  const isActive = (j) => j.status === 'running' || j.status === 'offered';
  const scopeOf = (a) => (['app', 'flow', 'screen', 'export'].includes(a.scope) ? a.scope : a.screen ? 'screen' : null);
  const allStates = () => S.board.flows.flatMap((f) => (f.screens || []).flatMap((s) => (s.states || []).map((st) => ({ flow: f, screen: s, state: st }))));

  // ---------- saving notes ----------

  let saveTimer = null;
  let inflight = null;
  const dirty = () => !!saveTimer || !!inflight;
  function save() {
    if (READ_ONLY) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(flush, 400);
    paintCounts();
  }
  async function flush() {
    clearTimeout(saveTimer);
    saveTimer = null;
    if (READ_ONLY) return;
    if (inflight) await inflight.catch(() => {});
    inflight = api('PUT', 'api/notes', S.notes)
      .catch((err) => toast(`Couldn’t save your notes: ${err.message}`))
      .finally(() => (inflight = null));
    return inflight;
  }
  // Leaving with a save pending: send it with keepalive so it outlives the page.
  addEventListener('pagehide', () => {
    if (!saveTimer || READ_ONLY) return;
    clearTimeout(saveTimer);
    saveTimer = null;
    fetch('api/notes', { method: 'PUT', keepalive: true, headers: { 'content-type': 'application/json', 'x-ddd-client': CLIENT }, body: JSON.stringify(S.notes) }).catch(() => {});
  });

  /** Notes changed on the server (Send, a job done, another tab): take its statuses, keep our edits. */
  function mergeIncoming(incoming) {
    incoming = normNotes(incoming);
    if (!dirty()) S.notes = incoming;
    else {
      const marks = new Map();
      for (const s of Object.values(incoming.screens)) for (const st of Object.values(s.states || {})) for (const m of st.marks || []) marks.set(m.id, m);
      for (const s of Object.values(S.notes.screens)) for (const st of Object.values(s.states || {})) for (const m of st.marks || []) {
        const inc = marks.get(m.id);
        if (inc) Object.assign(m, { status: inc.status, job: inc.job });
      }
      for (const a of incoming.asks) {
        const mine = S.notes.asks.find((x) => x.id === a.id);
        if (mine) Object.assign(mine, { status: a.status, job: a.job });
        else S.notes.asks.push(a);
      }
    }
    paintCounts();
    paintBoardNotes();
    if (S.focus) {
      renderMarks();
      paintPanelNotes(false);
    }
    if (appOpen()) paintApp(false);
  }

  // ---------- frames ----------

  const frames = new Set(); // { file, el, iframe, screen, state, dev, cap? }

  /**
   * A frame showing one state's mock at scale z, in its device's chrome: a phone's rounded screen, a tablet's
   * squarer one, a browser window (title bar, three dots, an address bar with the state's title) for
   * desktop and laptop, a plain rounded frame for a custom size. The iframe is the device's size in CSS
   * pixels, scaled with a transform so it stays crisp. chrome: a fixed title bar height (the focus view).
   */
  function frame(screen, state, z, { interactive = false, register = true, chrome = 0 } = {}) {
    const dev = deviceOf(screen.id, state.id);
    const p = el('div', { class: `frame k-${dev.kind}`, 'data-screen': screen.id, 'data-state': state.id, 'data-device': dev.name });
    if (dev.kind === 'browser') {
      p.append(
        el(
          'div',
          { class: 'chrome', 'aria-hidden': 'true' },
          el('span', { class: 'dots' }, el('i'), el('i'), el('i')),
          el('span', { class: 'addr' }, el('span', { class: 'addr-text', 'data-t': `state:${screen.id}:${state.id}:title`, text: state.title || state.id })),
        ),
      );
    }
    const box = el('div', { class: 'screenbox' });
    const iframe = el('iframe', {
      src: state.file,
      title: `${screen.title}: ${state.title}`,
      loading: interactive ? null : 'lazy',
      tabindex: interactive ? null : '-1',
      scrolling: interactive ? null : 'no',
    });
    iframe.style.width = `${dev.width}px`;
    iframe.style.height = `${dev.height}px`;
    box.append(iframe, el('div', { class: 'working' }, el('span', { class: 'working-label' })));
    if (!interactive) box.append(el('div', { class: 'catch' }));
    p.append(box, el('span', { class: 'badge', hidden: true }));
    const rec = { file: state.file, el: p, iframe, screen: screen.id, state: state.id, dev, chrome };
    sizeFrame(rec, z);
    if (register) frames.add(rec);
    return { el: p, iframe, box, rec };
  }

  function sizeFrame(rec, z) {
    const { el: p, dev } = rec;
    const ch = chromeHeight(dev, z, rec.chrome);
    rec.z = z;
    p.style.setProperty('--z', z);
    p.style.setProperty('--ch', `${ch}px`);
    p.style.width = `${dev.width * z}px`;
    p.style.height = `${dev.height * z + ch}px`;
    const box = p.querySelector('.screenbox');
    box.style.top = `${ch}px`;
    box.style.height = `${dev.height * z}px`;
    p.querySelector('.chrome')?.classList.toggle('tiny', ch < 18);
    rec.iframe.style.transform = `scale(${z})`;
    const o = p.querySelector('.overlay');
    if (o) o.style.transform = `scale(${z})`;
    if (rec.cap) rec.cap.style.width = `${Math.max(dev.width * z, 150)}px`;
  }

  function reloadFrame(rec) {
    const { iframe, el: p } = rec;
    let sx = 0, sy = 0;
    try {
      sx = iframe.contentWindow.scrollX;
      sy = iframe.contentWindow.scrollY;
    } catch {}
    iframe.addEventListener(
      'load',
      () => {
        try {
          iframe.contentWindow.scrollTo(sx, sy);
        } catch {}
        p.classList.add('flash');
        setTimeout(() => p.classList.remove('flash'), 900);
      },
      { once: true },
    );
    try {
      iframe.contentWindow.location.reload();
    } catch {
      iframe.src = iframe.src;
    }
  }

  function pruneFrames() {
    for (const f of frames) if (!f.el.isConnected) frames.delete(f);
  }

  // ---------- the board ----------

  const signature = () =>
    JSON.stringify(
      S.board.flows.map((f) => [f.id, (f.screens || []).map((s) => [s.id, (s.states || []).map((st) => [st.id, st.file, deviceText(deviceOf(s.id, st.id))])])]),
    ) + deviceText(defaultDevice());

  function renderBoard() {
    S.sig = signature();
    const inner = $('#board-inner');
    inner.textContent = '';
    for (const flow of S.board.flows) {
      const screens = el('div', { class: 'screens' });
      inner.append(
        el(
          'section',
          { class: 'flow', 'data-flow': flow.id },
          el(
            'div',
            { class: 'flow-head' },
            el(
              'div',
              { class: 'flow-title-row' },
              el('h2', { class: 'flow-title', 'data-t': `flow:${flow.id}:title` }),
              READ_ONLY ? null : el('button', { class: 'btn small ghost flow-ask', type: 'button', text: 'Ask about this flow…', onclick: () => openApp(`flow:${flow.id}`) }),
            ),
            el('p', { class: 'flow-intent', 'data-t': `flow:${flow.id}:intent` }),
          ),
          screens,
        ),
      );
      for (const screen of flow.screens || []) {
        const states = el('div', { class: 'states' });
        const head = el(
          'div',
          { class: 'screen-head' },
          el('h3', { class: 'screen-title', 'data-t': `screen:${screen.id}:title` }),
          el('p', { class: 'screen-intent', 'data-t': `screen:${screen.id}:intent` }),
          el('p', { class: 'author-note', 'data-note': screen.id, hidden: true }),
        );
        screens.append(el('div', { class: 'screen', 'data-screen': screen.id }, head, states));
        for (const state of screen.states || []) {
          const dev = deviceOf(screen.id, state.id);
          const other = !sameDevice(dev, defaultDevice());
          const cap = el(
            'div',
            { class: 'caption' },
            el('p', { class: 'caption-title', 'data-t': `state:${screen.id}:${state.id}:title` }),
            other ? el('p', { class: 'caption-device', title: 'Designed for this device (the project default is ' + deviceText(defaultDevice()) + ')' }, deviceIcon(dev), deviceText(dev)) : null,
            el('p', { class: 'caption-intent', 'data-t': `state:${screen.id}:${state.id}:intent` }),
          );
          const fr = frame(screen, state, boardScale(dev));
          fr.rec.cap = cap;
          sizeFrame(fr.rec, fr.rec.z);
          fr.el.addEventListener('click', () => openFocus(screen.id, state.id));
          states.append(el('div', { class: 'state' }, fr.el, cap));
        }
      }
    }
    pruneFrames();
    paintTexts();
    paintBoardNotes();
    paintCounts();
    paintWorking();
    $('#empty').hidden = allStates().length > 0 || S.board.flows.length > 0;
    renderSide();
    spy();
  }

  /** Titles and intents, updated in place (so a board.json change doesn't reload every frame). */
  function paintTexts() {
    const put = (key, v) => $$(`[data-t="${CSS.escape(key)}"]`).forEach((e) => (e.textContent = v || ''));
    for (const f of S.board.flows) {
      put(`flow:${f.id}:title`, f.title || f.id);
      put(`flow:${f.id}:intent`, f.intent);
      for (const s of f.screens || []) {
        put(`screen:${s.id}:title`, s.title || s.id);
        put(`screen:${s.id}:intent`, s.intent);
        for (const st of s.states || []) {
          put(`state:${s.id}:${st.id}:title`, st.title || st.id);
          put(`state:${s.id}:${st.id}:intent`, st.intent);
        }
      }
    }
    $$('.flow-intent, .screen-intent, .caption-intent').forEach((e) => (e.hidden = !e.textContent));
    $('#project-name').textContent = S.project?.name || 'Untitled';
    $('#side-project').textContent = S.project?.name || 'Untitled';
    $('#side-goal').textContent = S.project?.goal || '';
    $('#side-goal').hidden = !S.project?.goal;
    document.title = `${S.project?.name || 'Board'} · design-driven-development`;
    if (S.focus) paintFocusTexts();
  }

  function paintBoardNotes() {
    $$('.author-note[data-note]').forEach((p) => {
      const n = screenNotes(p.dataset.note)?.note || '';
      p.textContent = n;
      p.hidden = !n.trim();
    });
  }

  function paintCounts() {
    for (const f of frames) {
      const b = f.el.querySelector('.badge');
      if (!b) continue;
      const marks = marksOf(f.screen, f.state);
      const open = marks.filter((m) => (m.status || 'open') === 'open').length;
      const sent = marks.filter((m) => m.status === 'sent').length;
      b.hidden = !(open || sent);
      b.textContent = open || sent;
      b.classList.toggle('sent', !open && !!sent);
      b.title = open ? `${open} open mark${open === 1 ? '' : 's'}` : `${sent} with Claude`;
    }
    for (const b of $$('#side-tree .s-badge')) {
      const k = screenOpenCount(b.dataset.screen);
      b.hidden = !k;
      b.textContent = k;
      b.title = `${k} open mark${k === 1 ? '' : 's'} or request${k === 1 ? '' : 's'}`;
    }
    paintFs();
    if (READ_ONLY) return;
    const n = totalOpen();
    $('#send-count').textContent = n;
    $('#send-btn').disabled = n === 0;
    if (S.focus) {
      const k = screenOpenCount(S.focus.screen);
      const b = $('#send-screen');
      b.disabled = k === 0;
      b.textContent = k ? `Send this screen to Claude (${k})` : 'Send this screen to Claude';
    }
  }

  /** Screens with a job: a shimmer while Claude works on them, a label while they wait. */
  function paintWorking() {
    const by = new Map();
    // A whole-app or flow job shimmers on every screen it covers; a waiting one only shows in the sidebar.
    for (const j of S.jobs) if (isActive(j)) for (const id of jobScreens(j)) by.set(id, 'updating');
    for (const j of S.jobs) if (j.status === 'queued' && j.screen && !by.has(j.screen)) by.set(j.screen, 'queued');
    paintSideWorking(by);
    for (const f of frames) {
      const st = by.get(f.screen);
      f.el.classList.toggle('updating', st === 'updating');
      f.el.classList.toggle('queued', st === 'queued');
      const label = f.el.querySelector('.working-label');
      if (label) label.textContent = st === 'updating' ? 'Claude is updating' : st === 'queued' ? 'Waiting for Claude' : '';
    }
  }

  function setZoom(z) {
    S.zoom = clampZoom(z);
    store.set('zoom', S.zoom);
    $('#zoom-range').value = S.zoom;
    $('#zoom-val').textContent = `${Math.round(S.zoom * 100)}%`;
    for (const f of frames) if (f.el.closest('#board')) sizeFrame(f, boardScale(f.dev));
  }

  // ---------- Claude: pill, activity ----------

  function paintClaude() {
    if (READ_ONLY) return;
    const pill = $('#claude-pill');
    const active = S.jobs.filter((j) => j.status === 'running' || j.status === 'offered');
    const waiting = S.jobs.filter((j) => j.status === 'queued').length;
    // An export changes no screen: it's "Exporting the spec" unless screens are being updated too.
    const changing = active.filter((j) => j.kind !== 'export');
    const screens = new Set(changing.flatMap((j) => (jobScreens(j).length ? jobScreens(j) : [j.id]))).size;
    let state = 'offline';
    let text = waiting ? `Claude offline · ${waiting} waiting` : 'Claude offline';
    let title = `No Claude session is listening. In Claude Code, say "connect to the ${S.project?.slug || ''} design" (or run /design-driven-development). What you send waits until then.`;
    if (S.claude.connected) {
      title = 'A Claude Code session is listening and works on what you send.';
      if (active.length) {
        state = 'working';
        text = screens ? `Updating ${screens} screen${screens === 1 ? '' : 's'}` : 'Exporting the spec';
      } else if (S.claude.phase === 'error') {
        state = 'error';
        text = S.claude.message || 'Claude hit a problem';
      } else if (S.claude.phase === 'working') {
        state = 'working';
        text = S.claude.message || 'Claude is working';
      } else {
        state = 'connected';
        text = waiting ? `Claude connected · ${waiting} waiting` : 'Claude connected';
      }
    }
    pill.dataset.state = state;
    pill.title = title;
    $('.pill-text', pill).textContent = text;
    const n = S.jobs.filter((j) => ['queued', 'offered', 'running'].includes(j.status)).length;
    $('#activity-count').hidden = !n;
    $('#activity-count').textContent = n;
    if (!$('#activity').hidden) renderActivity();
    if (appOpen()) renderAsks();
  }

  const ago = (iso) => {
    if (!iso) return '';
    const s = Math.max(0, (Date.now() - new Date(iso)) / 1000);
    if (s < 60) return 'just now';
    if (s < 3600) return `${Math.round(s / 60)} min ago`;
    if (s < 86400) return `${Math.round(s / 3600)} h ago`;
    return new Date(iso).toLocaleDateString();
  };
  const STATUS_LABEL = { queued: 'Waiting for Claude', offered: 'Claude is starting', running: 'Claude is working', done: 'Done', failed: 'Failed' };

  function renderActivity() {
    const box = $('#activity');
    box.textContent = '';
    const jobs = [...S.jobs].reverse();
    if (!jobs.length) {
      box.append(el('p', { class: 'a-empty muted', text: 'Nothing sent to Claude yet. Mark up a state and press Send to Claude.' }));
      return;
    }
    for (const j of jobs) {
      const said = `“${(j.asks[0]?.text || '').slice(0, 80)}”`;
      const title =
        j.kind === 'app' ? `Whole app · ${said}` : j.kind === 'export' ? `Export · ${said}` : j.kind === 'flow' ? `${findFlow(j.flow)?.title || j.flow} · ${said}` : j.screen ? findScreen(j.screen)?.screen.title || j.screen : said;
      const parts = [];
      if (j.marks?.length) parts.push(`${j.marks.length} mark${j.marks.length === 1 ? '' : 's'}`);
      if (j.asks?.length && j.screen) parts.push(`${j.asks.length} ask${j.asks.length === 1 ? '' : 's'}`);
      const when = ago(j.doneAt || j.startedAt || j.createdAt);
      box.append(
        el(
          'div',
          { class: 'job', 'data-status': j.status },
          el('span', { class: 's-dot' }),
          el('span', { class: 'job-title', text: title }),
          el('span', { class: 'job-meta', text: [STATUS_LABEL[j.status] || j.status, ...parts, when].filter(Boolean).join(' · ') }),
          j.summary || j.error ? el('span', { class: 'job-text', text: j.summary || j.error }) : null,
        ),
      );
    }
  }

  // ---------- focus view ----------

  let stage = null; // { el, iframe, overlay, svg, scroller, marksG, previewG, z, sx, sy, rec, dev }
  const STAGE_CHROME = 30; // the browser title bar in the focus view, whatever the scale

  function openFocus(screen, state) {
    const hit = findScreen(screen);
    if (!hit) return;
    const st = (hit.screen.states || []).find((s) => s.id === state) || hit.screen.states?.[0];
    if (!st) return;
    const same = S.focus && S.focus.screen === screen;
    S.focus = { screen, state: st.id };
    S.hot = null;
    history.replaceState(null, '', `#${screen}/${st.id}`);
    $('#focus').hidden = false;
    $('#board').hidden = true;
    $('#zoom').hidden = true;
    $('#back').hidden = false;
    setTool('select');
    setCurrent(screen, true);
    // The strip first: the stage fits the frame into the room the strip leaves.
    if (!same) renderStrip();
    else paintStrip();
    renderStage();
    renderPanel();
  }

  function closeFocus() {
    if (!S.focus) return;
    setFull(false);
    flush();
    const { screen } = S.focus;
    S.focus = null;
    stage = null;
    $('#stage-frame').textContent = '';
    $('#strip').textContent = '';
    pruneFrames();
    $('#focus').hidden = true;
    $('#board').hidden = false;
    $('#zoom').hidden = false;
    $('#back').hidden = true;
    $('#crumb-rest').textContent = '';
    history.replaceState(null, '', location.pathname + location.search);
    $(`.screen[data-screen="${CSS.escape(screen)}"]`)?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    $('#board').focus({ preventScroll: true });
    spyNow();
  }

  function step(dir) {
    if (!S.focus) return;
    const states = findScreen(S.focus.screen)?.screen.states || [];
    const i = states.findIndex((s) => s.id === S.focus.state);
    const next = states[i + dir];
    if (next) openFocus(S.focus.screen, next.id);
  }
  function stepScreen(dir) {
    if (!S.focus) return;
    const screens = S.board.flows.flatMap((f) => f.screens || []).filter((s) => (s.states || []).length);
    const i = screens.findIndex((s) => s.id === S.focus.screen);
    const next = screens[i + dir];
    if (next) openFocus(next.id, next.states[0].id);
  }

  const focusData = () => {
    const hit = findScreen(S.focus.screen);
    const state = hit?.screen.states.find((s) => s.id === S.focus.state);
    return hit && state ? { ...hit, state } : null;
  };

  /** The scale that fits a device's frame into the stage (never above 1). Full screen leaves a 16px margin. */
  function stageFit(dev) {
    const body = $('#stage-body');
    const ch = chromeHeight(dev, 1, STAGE_CHROME);
    const pad = S.full ? 32 : 36;
    return Math.max(0.1, Math.min(1, (body.clientHeight - pad - ch) / dev.height, (body.clientWidth - pad) / dev.width));
  }

  /** The focus view's scale: fitted, or the one the author picked (kept across states and visits). */
  function stageZoom(dev) {
    const fit = stageFit(dev);
    const z = S.full || S.stageZoom === 'fit' ? fit : Number(S.stageZoom) || 1;
    $('#stage-zoom-val').textContent = `${Math.round(z * 100)}%`;
    $('#stage-fit').setAttribute('aria-pressed', String(S.stageZoom === 'fit'));
    $('#stage-100').setAttribute('aria-pressed', String(S.stageZoom !== 'fit' && Math.abs(z - 1) < 0.001));
    $('#stage-device').textContent = deviceText(dev);
    $('#stage-device').title = sameDevice(dev, defaultDevice()) ? 'The project’s device' : `This state is designed for another device than the project’s (${deviceText(defaultDevice())})`;
    return z;
  }

  function setStageZoom(v) {
    if (!stage) return;
    const cur = stage.z;
    let next = v;
    if (v === 'in') next = STAGE_STEPS.find((x) => x > cur + 0.001) ?? STAGE_STEPS[STAGE_STEPS.length - 1];
    else if (v === 'out') next = [...STAGE_STEPS].reverse().find((x) => x < cur - 0.001) ?? STAGE_STEPS[0];
    S.stageZoom = next;
    store.set('stageZoom', next);
    resizeStage();
  }

  function renderStage() {
    const d = focusData();
    if (!d) return closeFocus();
    pruneFrames();
    const holder = $('#stage-frame');
    holder.textContent = '';
    const dev = deviceOf(d.screen.id, d.state.id);
    const z = stageZoom(dev);
    const fr = frame(d.screen, d.state, z, { interactive: true, chrome: dev.kind === 'browser' ? STAGE_CHROME : 0 });
    fr.el.querySelector('.badge')?.remove();
    // The marks layer: an SVG in the mock's own CSS pixels (its device's size), scaled with the iframe, shifted by its scroll.
    const { width: W, height: H } = dev;
    const overlay = el('div', { class: 'overlay' });
    overlay.style.width = `${W}px`;
    overlay.style.height = `${H}px`;
    overlay.style.transform = `scale(${z})`;
    const s = svg('svg', { viewBox: `0 0 ${W} ${H}`, width: W, height: H });
    const catcher = svg('rect', { class: 'catcher', width: W, height: H });
    const scroller = svg('g');
    const marksG = svg('g');
    const previewG = svg('g');
    scroller.append(marksG, previewG);
    s.append(catcher, scroller);
    overlay.append(s);
    fr.box.append(overlay);
    holder.append(fr.el);
    stage = { el: fr.el, iframe: fr.iframe, overlay, svg: s, scroller, marksG, previewG, z, sx: 0, sy: 0, rec: fr.rec, dev };
    fr.iframe.addEventListener('load', () => attachFrame(fr.iframe));
    wireDrawing(overlay, s);
    paintFocusTexts();
    paintWorking();
    renderMarks();
    setTool(S.tool);
  }

  /** Follow the mock's scroll so marks stay on what they mark; pass keys up to the board. */
  function attachFrame(iframe) {
    if (!stage || stage.iframe !== iframe) return;
    let win;
    try {
      win = iframe.contentWindow;
      void win.document; // throws when the mock isn't same-origin (an exported spec opened from disk)
    } catch {
      stage.overlay.hidden = true; // can't follow its scroll: don't draw marks in the wrong place
      return;
    }
    stage.overlay.hidden = false;
    const sync = () => {
      if (!stage || stage.iframe !== iframe) return;
      stage.sx = win.scrollX;
      stage.sy = win.scrollY;
      stage.scroller.setAttribute('transform', `translate(${-stage.sx} ${-stage.sy})`);
    };
    win.addEventListener('scroll', sync, { passive: true });
    win.addEventListener('resize', sync);
    win.document.addEventListener('keydown', onKey);
    sync();
  }

  function paintFocusTexts() {
    const d = focusData();
    if (!d) return;
    const states = d.screen.states || [];
    $('#crumb-rest').innerHTML = '';
    $('#crumb-rest').append('/ ', d.flow.title || d.flow.id, ' / ', el('b', { text: d.screen.title || d.screen.id }));
    $('#stage-state').textContent = d.state.title || d.state.id;
    $('#stage-pos').textContent = states.length > 1 ? `${states.findIndex((s) => s.id === d.state.id) + 1} of ${states.length} · ← → to move` : '';
    $('#p-flow').textContent = d.flow.title || d.flow.id;
    $('#p-screen').textContent = d.screen.title || d.screen.id;
    $('#p-screen-intent').textContent = d.screen.intent || '';
    $('#p-state-name').textContent = `· ${d.state.title || d.state.id}`;
    $('#p-state-intent').textContent = d.state.intent || '';
    // The vertical toolbar has no room for a title: its grip's tooltip says which state this is.
    const pos = states.length > 1 ? ` (${states.findIndex((s) => s.id === d.state.id) + 1} of ${states.length}, ← → to move)` : '';
    $('#fs-title').textContent = `${d.screen.title || d.screen.id} · ${d.state.title || d.state.id}`;
    $('#fs-grip').title = `${$('#fs-title').textContent}${pos}\nDrag to move · double-click to dock`;
  }

  function renderStrip() {
    const strip = $('#strip');
    strip.textContent = '';
    const d = focusData();
    if (!d) return;
    for (const st of d.screen.states || []) {
      const ph = frame(d.screen, st, thumbScale(deviceOf(d.screen.id, st.id)));
      ph.el.querySelector('.working')?.remove();
      const b = el('button', { class: 'thumb', type: 'button', 'data-state': st.id, title: `${st.title || st.id} · ${deviceText(ph.rec.dev)}` }, ph.el, el('span', { class: 'thumb-label', text: st.title || st.id }));
      b.addEventListener('click', () => openFocus(d.screen.id, st.id));
      strip.append(b);
    }
    paintStrip();
    paintCounts();
  }
  function paintStrip() {
    $$('#strip .thumb').forEach((t) => t.setAttribute('aria-current', String(t.dataset.state === S.focus?.state)));
    $('#strip .thumb[aria-current="true"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  function renderPanel() {
    paintFocusTexts();
    paintPanelNotes(true);
    renderMarks();
    paintCounts();
  }

  function paintPanelNotes(force) {
    const d = focusData();
    if (!d) return;
    const a = $('#n-screen');
    const b = $('#n-state');
    if (force || document.activeElement !== a) a.value = screenNotes(d.screen.id)?.note || '';
    if (force || document.activeElement !== b) b.value = stateNotes(d.screen.id, d.state.id)?.note || '';
    a.readOnly = b.readOnly = READ_ONLY;
    for (const t of [a, b]) autosize(t);
  }

  function autosize(t) {
    t.style.height = 'auto';
    t.style.height = `${Math.max(t.scrollHeight + 2, 36)}px`;
  }

  // ---------- marks ----------

  function nextN(screen, state) {
    return marksOf(screen, state).reduce((m, x) => Math.max(m, x.n || 0), 0) + 1;
  }

  function anchorOf(m) {
    if (m.shape === 'pin') return [m.x, m.y];
    if (m.shape === 'arrow' && m.points?.length >= 2) return m.points[m.points.length - 1];
    return [m.x + m.w / 2, m.y + m.h / 2];
  }

  /** A short, stable CSS selector for an element in the mock: ids, classes, nth-of-type, ≤ 5 levels. */
  function selectorFor(node) {
    const doc = node.ownerDocument;
    const parts = [];
    let e = node;
    while (e && e.nodeType === 1 && e !== doc.body && e !== doc.documentElement && parts.length < 5) {
      if (e.id && doc.querySelectorAll(`#${CSS.escape(e.id)}`).length === 1) {
        parts.unshift(`#${CSS.escape(e.id)}`);
        break;
      }
      let part = e.tagName.toLowerCase();
      const cls = [...e.classList].filter((c) => !/^(is-|has-)?(active|hover|focus|selected)$/.test(c)).slice(0, 2);
      if (cls.length) part += cls.map((c) => '.' + CSS.escape(c)).join('');
      const parent = e.parentElement;
      if (parent) {
        const same = [...parent.children].filter((c) => c.tagName === e.tagName);
        const unique = cls.length && [...parent.children].filter((c) => c.matches(part)).length === 1;
        if (same.length > 1 && !unique) part += `:nth-of-type(${same.indexOf(e) + 1})`;
      }
      parts.unshift(part);
      e = parent;
    }
    return parts.join(' > ') || node.tagName.toLowerCase();
  }

  /** The element under a document point in the mock, as { selector, text, rect }. */
  function targetAt(x, y) {
    try {
      const win = stage.iframe.contentWindow;
      const doc = win.document;
      const vx = x - win.scrollX;
      const vy = y - win.scrollY;
      if (vx < 0 || vy < 0 || vx > win.innerWidth || vy > win.innerHeight) return null;
      const node = doc.elementFromPoint(vx, vy);
      if (!node || node === doc.body || node === doc.documentElement) return null;
      const r = node.getBoundingClientRect();
      const text = (node.innerText || node.textContent || node.getAttribute('aria-label') || node.getAttribute('alt') || '').replace(/\s+/g, ' ').trim().slice(0, 120);
      return { selector: selectorFor(node), text, rect: [r1(r.left + win.scrollX), r1(r.top + win.scrollY), r1(r.width), r1(r.height)] };
    } catch {
      return null;
    }
  }

  function bbox(points) {
    const xs = points.map((p) => p[0]);
    const ys = points.map((p) => p[1]);
    const x = Math.min(...xs);
    const y = Math.min(...ys);
    return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
  }

  function drawMark(g, m, preview = false) {
    const cls = `mk ${m.status || 'open'}${preview ? ' preview' : ''}${S.hot === m.id ? ' hot' : ''}`;
    const grp = svg('g', { class: cls, 'data-id': m.id || '' });
    const badge = (x, y) => {
      if (preview) return;
      grp.append(svg('circle', { class: 'num', cx: x, cy: y, r: 11.5 }));
      const t = svg('text', { class: 'num-t', x, y: y + 0.5 });
      t.textContent = m.n;
      grp.append(t);
    };
    if (m.shape === 'pin') {
      const pin = svg('g', { transform: `translate(${m.x} ${m.y})` });
      pin.append(svg('path', { class: 'pin-body', d: 'M0 0C-2.5-5.5-11-10-11-19a11 11 0 1 1 22 0c0 9-8.5 13.5-11 19z' }));
      if (!preview) {
        const t = svg('text', { class: 'num-t', x: 0, y: -18.5 });
        t.textContent = m.n;
        pin.append(t);
      }
      grp.append(pin);
    } else if (m.shape === 'box') {
      for (const c of ['shape area', 'hit']) grp.append(svg('rect', { class: c, x: m.x, y: m.y, width: Math.max(m.w, 1), height: Math.max(m.h, 1), rx: 6 }));
      badge(m.x, m.y);
    } else if (m.shape === 'ellipse') {
      for (const c of ['shape area', 'hit']) grp.append(svg('ellipse', { class: c, cx: m.x + m.w / 2, cy: m.y + m.h / 2, rx: Math.max(m.w / 2, 1), ry: Math.max(m.h / 2, 1) }));
      badge(m.x + m.w * 0.15, m.y + m.h * 0.15);
    } else if (m.shape === 'arrow') {
      const [[x1, y1], [x2, y2]] = m.points;
      const a = Math.atan2(y2 - y1, x2 - x1);
      const L = 13;
      const head = `M${x2 - L * Math.cos(a - 0.45)} ${y2 - L * Math.sin(a - 0.45)}L${x2} ${y2}L${x2 - L * Math.cos(a + 0.45)} ${y2 - L * Math.sin(a + 0.45)}`;
      for (const c of ['shape', 'hit']) grp.append(svg('path', { class: c, d: `M${x1} ${y1}L${x2} ${y2}${c === 'shape' ? head : ''}` }));
      badge(x1, y1);
    } else if (m.shape === 'pen' && m.points?.length) {
      const d = m.points.map((p, i) => `${i ? 'L' : 'M'}${p[0]} ${p[1]}`).join('');
      for (const c of ['shape', 'hit']) grp.append(svg('path', { class: c, d }));
      badge(m.points[0][0], m.points[0][1]);
    } else return;
    if (!preview) {
      grp.addEventListener('click', (e) => {
        e.stopPropagation();
        selectMark(m.id, true);
      });
      const title = svg('title');
      title.textContent = `${m.n}. ${m.text || SHAPES[m.shape]}`;
      grp.append(title);
    }
    g.append(grp);
  }

  function renderMarks() {
    if (!S.focus) return;
    const { screen, state } = S.focus;
    const marks = [...marksOf(screen, state)].sort((a, b) => (a.n || 0) - (b.n || 0));
    if (stage) {
      stage.marksG.textContent = '';
      for (const m of marks) drawMark(stage.marksG, m);
    }
    // The list, keeping the caret if the author is typing in one of its notes.
    const active = document.activeElement;
    const keep = active?.closest?.('.mark') ? { id: active.closest('.mark').dataset.id, pos: active.selectionStart } : null;
    const live = marks.filter((m) => m.status !== 'done');
    const done = marks.filter((m) => m.status === 'done');
    const list = $('#marks');
    list.textContent = '';
    for (const m of live) list.append(markItem(m));
    $('#marks-done').textContent = '';
    for (const m of done) $('#marks-done').append(markItem(m));
    $('#resolved').hidden = !done.length;
    $('#resolved-count').textContent = `(${done.length})`;
    $('#marks-count').textContent = live.length ? `· ${live.length}` : '';
    $('#marks-empty').hidden = !!marks.length || READ_ONLY;
    if (keep) {
      const t = $(`.mark[data-id="${CSS.escape(keep.id)}"] textarea`);
      if (t) {
        t.focus();
        t.setSelectionRange(keep.pos, keep.pos);
      }
    }
    $$('#marks textarea').forEach(autosize);
    paintCounts();
  }

  function markItem(m) {
    const status = m.status || 'open';
    const chip = { open: 'Open', sent: 'With Claude', done: 'Done' }[status];
    const li = el('li', { class: `mark ${status}${S.hot === m.id ? ' hot' : ''}`, 'data-id': m.id });
    const head = el(
      'div',
      { class: 'm-head' },
      el('span', { text: SHAPES[m.shape] || 'Mark' }),
      el('span', { class: `chip ${status}`, text: chip }),
      m.target?.text ? el('span', { class: 'm-target', title: m.target.selector, text: `“${m.target.text}”` }) : null,
    );
    const del =
      !READ_ONLY && status !== 'sent'
        ? el('button', { class: 'icon-btn del', type: 'button', title: 'Delete this mark', 'aria-label': 'Delete this mark' })
        : el('span');
    if (del.tagName === 'BUTTON') {
      del.innerHTML = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8"/></svg>';
      del.addEventListener('click', (e) => {
        e.stopPropagation();
        deleteMark(m.id);
      });
    }
    li.append(el('span', { class: 'n', text: m.n }), head, del);
    if (!READ_ONLY && status === 'open') {
      const t = el('textarea', { rows: 1, placeholder: 'What should change here?' });
      t.value = m.text || '';
      t.addEventListener('input', () => {
        m.text = t.value;
        autosize(t);
        save();
        const title = stage?.marksG.querySelector(`[data-id="${CSS.escape(m.id)}"] title`);
        if (title) title.textContent = `${m.n}. ${m.text || SHAPES[m.shape]}`;
      });
      t.addEventListener('focus', () => selectMark(m.id, false));
      li.append(t);
    } else li.append(el('p', { class: 'm-text', text: m.text || '(no note)' }));
    li.addEventListener('click', (e) => {
      if (e.target.closest('textarea, button')) return;
      selectMark(m.id, false);
    });
    return li;
  }

  function selectMark(id, fromCanvas) {
    S.hot = id;
    $$('#marks .mark, #marks-done .mark').forEach((li) => li.classList.toggle('hot', li.dataset.id === id));
    stage?.marksG.querySelectorAll('.mk').forEach((g) => g.classList.toggle('hot', g.dataset.id === id));
    const li = $(`.mark[data-id="${CSS.escape(id)}"]`);
    if (li?.closest('details')) li.closest('details').open = true;
    li?.scrollIntoView({ block: 'nearest' });
    if (S.full) S.fsNote = !!id && (fromCanvas || S.fsNote);
    paintFs();
    if (fromCanvas) (S.full ? $('#fs-note-text:not([hidden])') : li?.querySelector('textarea'))?.focus();
    else {
      // Bring the mark into view in the mock.
      const m = marksOf(S.focus.screen, S.focus.state).find((x) => x.id === id);
      if (m && m.shape !== 'note' && stage) {
        const [, ay] = anchorOf(m);
        try {
          const win = stage.iframe.contentWindow;
          if (ay < win.scrollY + 20 || ay > win.scrollY + win.innerHeight - 20) win.scrollTo({ top: Math.max(0, ay - win.innerHeight / 2), behavior: 'smooth' });
        } catch {}
      }
    }
  }

  function deleteMark(id) {
    const { screen, state } = S.focus;
    const st = stateNotes(screen, state);
    if (!st) return;
    st.marks = st.marks.filter((m) => m.id !== id);
    if (S.hot === id) S.hot = null;
    save();
    renderMarks();
  }

  function addMark(fields) {
    const { screen, state } = S.focus;
    const st = ensureState(screen, state);
    const m = {
      id: 'm_' + Math.random().toString(36).slice(2, 8),
      n: nextN(screen, state),
      shape: fields.shape,
      x: r1(fields.x || 0),
      y: r1(fields.y || 0),
      w: r1(fields.w || 0),
      h: r1(fields.h || 0),
      points: (fields.points || []).map(([a, b]) => [r1(a), r1(b)]),
      text: '',
      target: null,
      status: 'open',
      job: null,
      createdAt: new Date().toISOString(),
    };
    if (m.shape !== 'note') {
      const [ax, ay] = anchorOf(m);
      m.target = targetAt(ax, ay);
    }
    st.marks.push(m);
    S.hot = m.id;
    if (S.full) S.fsNote = true; // write its note now; it folds away when done
    save();
    setTool('select');
    renderMarks();
    const t = S.full ? $('#fs-note-text') : $(`.mark[data-id="${CSS.escape(m.id)}"] textarea`);
    t?.focus();
    t?.scrollIntoView({ block: 'nearest' });
    return m;
  }

  function setTool(tool) {
    if (READ_ONLY) tool = 'select';
    if (tool === 'note') {
      if (S.focus) addMark({ shape: 'note' });
      return;
    }
    S.tool = tool;
    $$('#rail button[data-tool], #fs-tools button[data-tool]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.tool === tool)));
    stage?.overlay.classList.toggle('drawing', tool !== 'select');
    $('#tool-hint').textContent = READ_ONLY ? '' : HINTS[tool] || '';
  }

  // ---------- full screen ----------

  /** Full screen: just the state, fitted to the window, and the floating toolbar (F, or the button by the zoom). */
  function setFull(on) {
    on = !!on && !!S.focus;
    if (on === S.full) return;
    S.full = on;
    document.body.classList.toggle('fullscreen', on);
    $('#fs-bar').hidden = !on;
    $('#stage-full').setAttribute('aria-pressed', String(on));
    if (on) {
      closePops(null);
      closeApp();
      placeFsBar();
    }
    paintFs();
    resizeStage();
  }

  /** The toolbar's title, count, Send, and the selected mark's note card. */
  function paintFs() {
    if (!S.full || !S.focus) return;
    const { screen, state } = S.focus;
    const open = screenOpenCount(screen);
    $('#fs-count').textContent = open;
    $('#fs-count').hidden = !open;
    $('#fs-send').disabled = !open;
    $('#fs-send').title = open ? `Send this screen to Claude (${open})` : 'Nothing to send on this screen';
    const marks = marksOf(screen, state);
    const m = S.hot ? marks.find((x) => x.id === S.hot) : null;
    $('#fs-marks').textContent = marks.length;
    $('#fs-marks').hidden = !marks.length;
    $('#fs-notes').disabled = !marks.length;
    $('#fs-notes').title = !marks.length ? 'No marks on this state yet' : S.fsNote && m ? 'Fold the note away' : `Show ${m ? `mark ${m.n}'s note` : 'the latest note'} (${plural(marks.length, 'mark')} on this state)`;
    $('#fs-notes').setAttribute('aria-pressed', String(!!(S.fsNote && m)));
    const card = $('#fs-note');
    card.hidden = !(m && S.fsNote);
    if (card.hidden) return;
    const status = m.status || 'open';
    card.className = `fs-note ${status}`;
    $('#fs-note-n').textContent = m.n;
    $('#fs-note-head').textContent = [SHAPES[m.shape] || 'Mark', { open: 'Open', sent: 'With Claude', done: 'Done' }[status], m.target?.text ? `“${m.target.text}”` : ''].filter(Boolean).join(' · ');
    const t = $('#fs-note-text');
    const editable = !READ_ONLY && status === 'open';
    t.hidden = !editable;
    $('#fs-note-read').hidden = editable;
    $('#fs-note-read').textContent = m.text || '(no note)';
    if (editable && (t.dataset.id !== m.id || document.activeElement !== t)) t.value = m.text || '';
    t.dataset.id = m.id;
    autosize(t);
  }

  /** Put the toolbar where the author left it (kept inside the window), or docked at the bottom centre. */
  function placeFsBar() {
    const bar = $('#fs-bar');
    if (!S.fsBar) {
      bar.classList.remove('moved', 'flip');
      bar.style.left = bar.style.top = '';
      return;
    }
    const r = bar.getBoundingClientRect();
    const x = Math.max(8, Math.min(innerWidth - r.width - 8, S.fsBar.x));
    const y = Math.max(8, Math.min(innerHeight - r.height - 8, S.fsBar.y));
    bar.classList.add('moved');
    bar.classList.toggle('flip', x + r.width / 2 > innerWidth / 2); // in the right half, the note card opens on its left
    bar.style.left = `${x}px`;
    bar.style.top = `${y}px`;
  }

  /** Open the note card for a mark (the selected one, else the latest), or fold it back into the toolbar. */
  function showFsNote(on) {
    if (!S.focus) return;
    if (on && !S.hot) {
      const marks = marksOf(S.focus.screen, S.focus.state);
      const last = [...marks].reverse().find((m) => m.status !== 'done') || marks[marks.length - 1];
      if (!last) return;
      return selectMark(last.id, true);
    }
    S.fsNote = !!on;
    paintFs();
    if (on) $('#fs-note-text:not([hidden])')?.focus();
  }

  function wireFullscreen() {
    // The toolbar's tools are the rail's, so they share keys, titles and pressed state.
    for (const b of $$('#rail button[data-tool]')) {
      const c = b.cloneNode(true);
      c.addEventListener('click', () => setTool(S.tool === c.dataset.tool && c.dataset.tool !== 'select' ? 'select' : c.dataset.tool));
      $('#fs-tools').append(c);
    }
    $('#stage-full').addEventListener('click', () => setFull(!S.full));
    $('#fs-exit').addEventListener('click', () => setFull(false));
    $('#fs-send').addEventListener('click', () => S.focus && sendToClaude(S.focus.screen));
    $('#fs-notes').addEventListener('pointerdown', (e) => e.preventDefault()); // keep focus in the note, so the click toggles it
    $('#fs-notes').addEventListener('click', () => showFsNote(!(S.fsNote && S.hot)));
    $('#fs-note-close').addEventListener('click', () => showFsNote(false));
    // Done writing: Enter (Shift+Enter is a new line), or focus leaving the card, folds it into the toolbar.
    $('#fs-note-text').addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        e.target.blur();
      }
    });
    $('#fs-note').addEventListener('focusout', (e) => {
      if (!e.relatedTarget || !$('#fs-note').contains(e.relatedTarget)) setTimeout(() => !$('#fs-note').contains(document.activeElement) && showFsNote(false), 0);
    });
    $('#fs-note-text').addEventListener('input', (e) => {
      const t = e.target;
      const m = S.focus && marksOf(S.focus.screen, S.focus.state).find((x) => x.id === t.dataset.id);
      if (!m) return;
      m.text = t.value;
      autosize(t);
      save();
      const li = $(`#marks .mark[data-id="${CSS.escape(m.id)}"] textarea`);
      if (li) li.value = m.text;
      const title = stage?.marksG.querySelector(`[data-id="${CSS.escape(m.id)}"] title`);
      if (title) title.textContent = `${m.n}. ${m.text || SHAPES[m.shape]}`;
    });
    // Drag by the grip; double-click docks it back.
    const bar = $('#fs-bar');
    const grip = $('#fs-grip');
    let drag = null;
    grip.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      const r = bar.getBoundingClientRect();
      drag = { dx: e.clientX - r.left, dy: e.clientY - r.top };
      grip.setPointerCapture(e.pointerId);
      bar.classList.add('dragging');
      e.preventDefault();
    });
    grip.addEventListener('pointermove', (e) => {
      if (!drag) return;
      S.fsBar = { x: e.clientX - drag.dx, y: e.clientY - drag.dy };
      placeFsBar();
    });
    const drop = () => {
      if (!drag) return;
      drag = null;
      bar.classList.remove('dragging');
      store.set('fsBarV', S.fsBar);
    };
    grip.addEventListener('pointerup', drop);
    grip.addEventListener('pointercancel', drop);
    grip.addEventListener('dblclick', () => {
      S.fsBar = null;
      store.set('fsBarV', null);
      placeFsBar();
    });
    addEventListener('resize', () => S.full && placeFsBar());
  }

  function wireDrawing(overlay, s) {
    let start = null;
    let pts = null;
    let drew = false; // the click that ends a drag isn't a click on the empty canvas: keep the new mark selected
    const toDoc = (e) => {
      const r = s.getBoundingClientRect();
      const z = r.width / stage.dev.width;
      return [(e.clientX - r.left) / z + stage.sx, (e.clientY - r.top) / z + stage.sy];
    };
    const shapeFrom = (a, b) => {
      if (S.tool === 'arrow') return { shape: 'arrow', points: [a, b], ...bbox([a, b]) };
      if (S.tool === 'pen') return { shape: 'pen', points: pts, ...bbox(pts) };
      return { shape: S.tool, ...bbox([a, b]) };
    };
    // The mock scrolls under the marks even while a tool is on.
    overlay.addEventListener(
      'wheel',
      (e) => {
        try {
          stage.iframe.contentWindow.scrollBy(e.deltaX, e.deltaY);
          e.preventDefault();
        } catch {}
      },
      { passive: false },
    );
    s.addEventListener('pointerdown', (e) => {
      if (S.tool === 'select' || e.button !== 0) return;
      e.preventDefault();
      s.setPointerCapture(e.pointerId);
      start = toDoc(e);
      pts = [start];
    });
    s.addEventListener('pointermove', (e) => {
      if (!start) return;
      const p = toDoc(e);
      if (S.tool === 'pen') {
        const last = pts[pts.length - 1];
        if (Math.hypot(p[0] - last[0], p[1] - last[1]) >= 2) pts.push(p);
      }
      if (S.tool === 'pin') return;
      stage.previewG.textContent = '';
      drawMark(stage.previewG, { ...shapeFrom(start, p), status: 'open' }, true);
    });
    const end = (e) => {
      if (!start) return;
      const a = start;
      const b = toDoc(e);
      start = null;
      drew = true;
      stage.previewG.textContent = '';
      if (S.tool === 'pin') return addMark({ shape: 'pin', x: a[0], y: a[1] });
      const size = S.tool === 'pen' ? Math.max(bbox(pts).w, bbox(pts).h) : Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (size < 6) return; // a click with a drag tool: wait for a real drag
      if (S.tool === 'pen') pts.push(b);
      addMark(shapeFrom(a, b));
    };
    s.addEventListener('pointerup', end);
    s.addEventListener('pointercancel', () => {
      start = null;
      stage.previewG.textContent = '';
    });
    s.addEventListener('click', (e) => {
      if (drew) return void (drew = false);
      if (S.tool === 'select' && !e.target.closest('.mk')) selectMark(null, false);
    });
    s.addEventListener('pointerdown', () => (drew = false), true);
  }

  // ---------- live updates ----------

  function connect() {
    if (READ_ONLY) return;
    const es = new EventSource('api/stream');
    es.onmessage = (e) => {
      let ev;
      try {
        ev = JSON.parse(e.data);
      } catch {
        return;
      }
      if (ev.type === 'hello' || ev.type === 'claude') {
        S.claude = ev.claude;
        paintClaude();
        if (ev.type === 'hello') refresh(); // after a reconnect, catch up
      } else if (ev.type === 'jobs') {
        S.jobs = ev.jobs;
        paintClaude();
        paintWorking();
      } else if (ev.type === 'notes') {
        if (ev.from !== CLIENT) mergeIncoming(ev.notes);
      } else if (ev.type === 'file') {
        if (ev.path === 'board.json' || ev.path === 'project.json') refresh();
        else if (ev.path.startsWith('assets/') || ev.path === 'theme.css') [...frames].forEach(reloadFrame);
        else for (const f of [...frames]) if (f.file === ev.path) reloadFrame(f);
      }
    };
  }

  let refreshing = null;
  async function refresh() {
    if (refreshing) return refreshing;
    refreshing = (async () => {
      try {
        const d = await api('GET', 'api/project');
        S.project = d.project;
        S.board = d.board;
        S.devices = d.devices || null;
        S.jobs = d.jobs;
        S.claude = d.claude;
        mergeIncoming(d.notes);
        if (signature() !== S.sig) {
          const sc = $('#board');
          const [l, t] = [sc.scrollLeft, sc.scrollTop];
          renderBoard();
          sc.scrollLeft = l;
          sc.scrollTop = t;
          if (S.focus) {
            const d2 = focusData();
            if (!d2) {
              const first = findScreen(S.focus.screen)?.screen.states?.[0];
              if (first) openFocus(S.focus.screen, first.id);
              else closeFocus();
            } else {
              renderStrip();
              if (stage && (stage.rec.file !== d2.state.file || !sameDevice(stage.dev, deviceOf(d2.screen.id, d2.state.id)))) renderStage();
            }
          }
        } else paintTexts();
        paintClaude();
        paintWorking();
      } catch {}
    })().finally(() => (refreshing = null));
    return refreshing;
  }

  // ---------- the sidebar: flows and screens ----------

  const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
  const CHEVRON = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="m6 4 4 4-4 4"/></svg>';

  function setSide(open) {
    S.side = !!open;
    store.set('side', S.side);
    document.body.classList.toggle('side-open', S.side);
    $('#side-btn').setAttribute('aria-expanded', String(S.side));
    $('#side').inert = !S.side;
    if (stage) requestAnimationFrame(resizeStage);
    if (S.side) paintCurrent(true);
  }

  function renderSide() {
    const tree = $('#side-tree');
    tree.textContent = '';
    for (const flow of S.board.flows) {
      const screens = flow.screens || [];
      const folded = S.folded.has(flow.id);
      const list = el('ul', { class: 's-screens' });
      for (const screen of screens) {
        const n = (screen.states || []).length;
        const btn = el(
          'button',
          { class: 's-screen', type: 'button', 'data-screen': screen.id, onclick: () => goScreen(screen.id) },
          el('span', { class: 's-work', hidden: true }),
          el('span', { class: 's-title', 'data-t': `screen:${screen.id}:title`, text: screen.title || screen.id }),
          ...screenDevices(screen).map((d) => el('span', { class: 's-dev', title: `Designed for ${deviceText(d)}` }, deviceIcon(d))),
          el('span', { class: 's-badge', 'data-screen': screen.id, hidden: true }),
          el('span', { class: 's-states', text: n, title: plural(n, 'state') }),
        );
        list.append(el('li', { 'data-screen': screen.id }, btn));
      }
      const caret = el('button', { class: 's-caret', type: 'button', 'aria-expanded': String(!folded), 'aria-label': `Fold ${flow.title || flow.id}`, onclick: () => fold(flow.id) });
      caret.innerHTML = CHEVRON;
      tree.append(
        el(
          'div',
          { class: `s-flow${folded ? ' folded' : ''}`, 'data-flow': flow.id },
          el(
            'div',
            { class: 's-flow-row' },
            caret,
            el(
              'button',
              { class: 's-flow-btn', type: 'button', onclick: () => goFlow(flow.id) },
              el('span', { class: 's-flow-title', 'data-t': `flow:${flow.id}:title`, text: flow.title || flow.id }),
              el('span', { class: 's-work', hidden: true }),
              el('span', { class: 's-count', text: screens.length, title: plural(screens.length, 'screen') }),
            ),
          ),
          list,
        ),
      );
    }
    applyFilter();
    paintCounts();
    paintWorking();
    paintCurrent(false);
  }

  /** The devices a screen's states use other than the project's, one per device. */
  function screenDevices(screen) {
    const seen = new Map();
    for (const st of screen.states || []) {
      const d = deviceOf(screen.id, st.id);
      if (!sameDevice(d, defaultDevice())) seen.set(deviceText(d), d);
    }
    return [...seen.values()];
  }

  function fold(id) {
    if (S.folded.has(id)) S.folded.delete(id);
    else S.folded.add(id);
    store.set('folded', [...S.folded]);
    const f = $(`#side-tree .s-flow[data-flow="${CSS.escape(id)}"]`);
    f?.classList.toggle('folded', S.folded.has(id));
    f?.querySelector('.s-caret')?.setAttribute('aria-expanded', String(!S.folded.has(id)));
  }

  function applyFilter() {
    const q = S.filter.trim().toLowerCase();
    const tree = $('#side-tree');
    tree.classList.toggle('filtering', !!q);
    let any = false;
    for (const f of $$('.s-flow', tree)) {
      const flow = findFlow(f.dataset.flow);
      const flowHit = !q || `${flow?.title} ${flow?.id}`.toLowerCase().includes(q);
      let shown = 0;
      for (const li of $$('li[data-screen]', f)) {
        const s = findScreen(li.dataset.screen)?.screen;
        const hit = flowHit || `${s?.title} ${s?.id}`.toLowerCase().includes(q);
        li.hidden = !hit;
        if (hit) shown++;
      }
      f.hidden = !!q && !shown && !flowHit;
      any ||= !f.hidden;
    }
    $('#side-none').hidden = !q || any;
  }

  /** Mark the screen in view (or in focus) and its flow; keep it visible in the sidebar. */
  function setCurrent(id, reveal) {
    if (S.current === id && !reveal) return;
    S.current = id;
    paintCurrent(reveal);
  }
  function paintCurrent(reveal) {
    const flowId = S.current ? findScreen(S.current)?.flow.id : null;
    $$('#side-tree .s-screen').forEach((b) => (b.dataset.screen === S.current ? b.setAttribute('aria-current', 'true') : b.removeAttribute('aria-current')));
    $$('#side-tree .s-flow').forEach((f) => f.classList.toggle('current', f.dataset.flow === flowId));
    const cur = $('#side-tree .s-screen[aria-current="true"]');
    if (cur && S.side && (reveal || !$('#side').matches(':hover'))) {
      const box = $('#side-tree');
      const r = cur.getBoundingClientRect();
      const b = box.getBoundingClientRect();
      const margin = reveal ? 60 : 8; // a jump centres it; scrolling the board only keeps it in view
      if (r.top < b.top + margin || r.bottom > b.bottom - margin) box.scrollTop += r.top - b.top - b.height / 2 + r.height / 2;
    }
  }

  /** Which screens shimmer (or wait), as dots in the sidebar; the Whole app item says what an app job is doing. */
  function paintSideWorking(by) {
    $$('#side-tree .s-screen').forEach((b) => ($('.s-work', b).hidden = by.get(b.dataset.screen) !== 'updating'));
    $$('#side-tree .s-flow').forEach((f) => {
      const flow = findFlow(f.dataset.flow);
      const busy = (flow?.screens || []).some((s) => by.get(s.id) === 'updating') || S.jobs.some((j) => isActive(j) && j.kind === 'flow' && j.flow === f.dataset.flow);
      $('.s-flow-row .s-work', f).hidden = !busy;
    });
    const app = S.jobs.filter((j) => j.kind === 'app' && ['queued', 'offered', 'running'].includes(j.status));
    const running = app.some(isActive);
    $('#side-app-work').hidden = !running;
    $('#side-app-sub').textContent = running ? 'Claude is updating every screen' : app.length ? 'A request is waiting for Claude' : 'Brand, design, wording';
  }

  const board = () => $('#board');
  function goFlow(id) {
    if (S.focus) {
      const first = (findFlow(id)?.screens || []).find((s) => (s.states || []).length);
      if (first) openFocus(first.id, first.states[0].id);
      return;
    }
    const sec = $(`#board .flow[data-flow="${CSS.escape(id)}"]`);
    if (!sec) return;
    spyHold = Date.now() + 800;
    const first = findFlow(id)?.screens?.[0];
    if (first) setCurrent(first.id, true);
    board().scrollTo({ top: Math.max(0, sec.offsetTop - 8), left: 0, behavior: 'smooth' });
  }
  function goScreen(id) {
    const hit = findScreen(id);
    if (!hit) return;
    if (S.focus) {
      if ((hit.screen.states || []).length) openFocus(id, hit.screen.states[0].id);
      return;
    }
    const sc = $(`#board .screen[data-screen="${CSS.escape(id)}"]`);
    const sec = sc?.closest('.flow');
    if (!sc) return;
    spyHold = Date.now() + 800;
    setCurrent(id, true);
    board().scrollTo({ top: Math.max(0, sec.offsetTop - 8), left: Math.max(0, sc.offsetLeft - 32), behavior: 'smooth' });
    sc.classList.remove('flash');
    void sc.offsetWidth;
    sc.classList.add('flash');
    setTimeout(() => sc.classList.remove('flash'), 1500);
  }

  // The screen in view: the one showing the most of itself in the board's viewport.
  let io = null;
  let spyHold = 0;
  const seen = new Map();
  function spy() {
    io?.disconnect();
    seen.clear();
    if (!('IntersectionObserver' in window)) return;
    io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) seen.set(e.target.dataset.screen, e.isIntersecting ? e.intersectionRect.width * e.intersectionRect.height : 0);
        spyNow();
      },
      { root: board(), threshold: [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1] },
    );
    $$('#board .screen').forEach((s) => io.observe(s));
  }
  function spyNow() {
    if (S.focus || Date.now() < spyHold) return;
    let best = null;
    let area = 0;
    for (const [id, a] of seen) if (a > area) [best, area] = [id, a];
    if (best) setCurrent(best, false);
  }

  // ---------- the Whole app panel ----------

  const appOpen = () => !$('#app-panel').hidden;
  const SCOPE_HINT = {
    app: 'Claude changes the theme first (theme.css, shared by every mock), then the mocks that still need it. While it works, no other job touches any screen.',
    flow: 'Claude changes every screen in this flow. Other flows keep working in parallel.',
    screen: 'Claude changes this screen’s states, like marks sent from it.',
    any: 'For something new (screens, states, a flow): Claude decides where it goes.',
  };

  function openApp(scope = 'app') {
    closePops(null);
    $('#app-panel').hidden = false;
    document.body.classList.add('app-open');
    $('#side-app').setAttribute('aria-current', 'true');
    fillScopes(scope);
    paintApp(true);
    renderAsks();
    if (!READ_ONLY) setTimeout(() => $('#ask-text').focus(), 0);
  }
  function closeApp() {
    if (!appOpen()) return;
    $('#app-panel').hidden = true;
    document.body.classList.remove('app-open');
    $('#side-app').removeAttribute('aria-current');
  }

  function fillScopes(value) {
    const sel = $('#ask-scope');
    sel.textContent = '';
    sel.append(el('option', { value: 'app', text: `Whole app · every screen (${allScreenIds().length})` }));
    if (S.board.flows.length) {
      const g = el('optgroup', { label: 'One flow' });
      for (const f of S.board.flows) g.append(el('option', { value: `flow:${f.id}`, text: `${f.title || f.id} · ${plural((f.screens || []).length, 'screen')}` }));
      sel.append(g);
      const g2 = el('optgroup', { label: 'One screen' });
      for (const f of S.board.flows) for (const s of f.screens || []) g2.append(el('option', { value: `screen:${s.id}`, text: `${s.title || s.id} (${f.title || f.id})` }));
      sel.append(g2);
    }
    sel.append(el('option', { value: 'any', text: 'Something new · Claude decides where' }));
    sel.value = value;
    if (sel.value !== value) sel.value = 'app';
    paintHint();
  }
  const paintHint = () => ($('#ask-hint').textContent = SCOPE_HINT[$('#ask-scope').value.split(':')[0]] || '');

  function paintApp(force) {
    const t = $('#n-app');
    if (force || document.activeElement !== t) t.value = S.notes.app?.note || '';
    t.readOnly = READ_ONLY;
    autosize(t);
    renderAsks();
  }

  function scopeLabel(a) {
    const sc = scopeOf(a);
    if (sc === 'app') return 'Whole app';
    if (sc === 'export') return 'Export';
    if (sc === 'flow') return `${findFlow(a.flow)?.title || a.flow} flow`;
    if (sc === 'screen') return findScreen(a.screen)?.screen.title || a.screen;
    return 'Anywhere';
  }

  function renderAsks() {
    const list = $('#asks-list');
    list.textContent = '';
    const asks = [...S.notes.asks].reverse();
    for (const a of asks) {
      const job = a.job ? S.jobs.find((j) => j.id === a.job) : null;
      let chip = a.status || 'open';
      let label = { open: 'Open', sent: 'With Claude', done: 'Done' }[chip] || chip;
      if (job?.status === 'queued') label = 'Waiting for Claude';
      else if (job && isActive(job)) label = 'Claude is working';
      else if (job?.status === 'failed') [chip, label] = ['open', 'Failed'];
      list.append(
        el(
          'li',
          { class: `ask ${chip}` },
          el('p', { class: 'ask-text', text: a.text }),
          el('div', { class: 'ask-meta' }, el('span', { class: 'ask-scope', text: scopeLabel(a) }), el('span', { class: `chip ${chip}`, text: label }), el('span', { class: 'muted', text: ago(a.createdAt) })),
          job?.summary || job?.error ? el('p', { class: 'ask-summary', text: job.summary || job.error }) : null,
        ),
      );
    }
    $('#asks-empty').hidden = asks.length > 0;
    $('#asks-count').textContent = asks.length ? `· ${asks.length}` : '';
  }

  async function sendAsk(e) {
    e.preventDefault();
    const text = $('#ask-text').value.trim();
    if (!text) return;
    const [kind, id] = $('#ask-scope').value.split(':');
    const body = { text, scope: kind === 'any' ? null : kind, flow: kind === 'flow' ? id : null, screen: kind === 'screen' ? id : null };
    const btn = $('#ask-send');
    btn.disabled = true;
    try {
      await flush();
      const r = await api('POST', 'api/ask', body);
      if (!S.notes.asks.some((a) => a.id === r.ask.id)) S.notes.asks.push({ ...r.ask, status: 'sent', job: r.jobs[0]?.id || null });
      S.jobs = [...S.jobs.filter((j) => !r.jobs.some((x) => x.id === j.id)), ...r.jobs];
      $('#ask-text').value = '';
      renderAsks();
      paintClaude();
      paintWorking();
      paintCounts();
      toast(r.connected ? 'Sent to Claude.' : 'Queued. Claude picks it up when it connects.');
    } catch (err) {
      toast(`Couldn’t send: ${err.message}`);
    } finally {
      btn.disabled = false;
    }
  }

  const EXPORT_TEXT = 'export the spec';

  /** Export is a request like Ask: it becomes an export job, and Claude writes the spec into the product repo. */
  async function sendExport(e) {
    e.preventDefault();
    const text = $('#export-text').value.trim();
    if (!text) return;
    const btn = $('#export-send');
    btn.disabled = true;
    try {
      await flush();
      const r = await api('POST', 'api/ask', { text, scope: 'export' });
      if (!S.notes.asks.some((a) => a.id === r.ask.id)) S.notes.asks.push({ ...r.ask, status: 'sent', job: r.jobs[0]?.id || null });
      S.jobs = [...S.jobs.filter((j) => !r.jobs.some((x) => x.id === j.id)), ...r.jobs];
      $('#export-text').value = EXPORT_TEXT;
      closePops(null);
      renderAsks();
      paintClaude();
      toast(r.connected ? 'Sent to Claude: it’s writing the spec.' : 'Queued. Claude writes the spec when it connects.');
    } catch (err) {
      toast(`Couldn’t send: ${err.message}`);
    } finally {
      btn.disabled = false;
    }
  }

  // ---------- controls ----------

  let toastTimer = null;
  function toast(text) {
    const t = $('#toast');
    t.textContent = text;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (t.hidden = true), 3600);
  }

  async function sendToClaude(screen = null) {
    try {
      await flush();
      const r = await api('POST', 'api/send', { screen });
      const n = r.jobs.length;
      if (!n) toast('Nothing open to send.');
      else if (r.connected) toast(`Sent to Claude: ${n} job${n === 1 ? '' : 's'}.`);
      else toast(`Queued ${n} job${n === 1 ? '' : 's'}. Claude picks ${n === 1 ? 'it' : 'them'} up when it connects.`);
      S.jobs = [...S.jobs.filter((j) => !r.jobs.some((x) => x.id === j.id)), ...r.jobs];
      paintClaude();
      paintWorking();
    } catch (err) {
      toast(`Couldn’t send: ${err.message}`);
    }
  }

  function closePops(except) {
    for (const [btn, pop] of [['#activity-btn', '#activity'], ['#export-btn', '#export-pop']]) {
      if (pop === except) continue;
      $(pop).hidden = true;
      $(btn).setAttribute('aria-expanded', 'false');
    }
  }
  function togglePop(btn, pop, render) {
    const open = $(pop).hidden;
    closePops(pop);
    $(pop).hidden = !open;
    $(btn).setAttribute('aria-expanded', String(open));
    if (open && render) render();
  }

  function wire() {
    if (READ_ONLY) {
      document.documentElement.classList.add('readonly');
      $('#readonly-tag').hidden = false;
      $('#claude-pill').hidden = true;
    }
    $('#back').addEventListener('click', closeFocus);
    $('#send-btn').addEventListener('click', () => sendToClaude(null));
    $('#send-screen').addEventListener('click', () => S.focus && sendToClaude(S.focus.screen));
    $('#activity-btn').addEventListener('click', () => togglePop('#activity-btn', '#activity', renderActivity));
    $('#export-btn').addEventListener('click', () =>
      togglePop('#export-btn', '#export-pop', () => {
        $('#export-dest').textContent = S.project?.repo ? `Writes to ${S.project.repo}/docs/design/${S.project.slug}/` : '';
        const t = $('#export-text');
        if (!t.value.trim()) t.value = EXPORT_TEXT;
        t.focus();
        t.setSelectionRange(t.value.length, t.value.length);
      }),
    );
    $('#export-form').addEventListener('submit', sendExport);
    $('#export-text').addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) sendExport(e);
    });
    wireFullscreen();
    document.addEventListener('click', (e) => {
      if (!e.target.closest('.pop-wrap')) closePops(null);
    });
    // sidebar and the Whole app panel
    $('#side-btn').addEventListener('click', () => setSide(!S.side));
    $('#side-filter').addEventListener('input', (e) => {
      S.filter = e.target.value;
      applyFilter();
    });
    $('#side-app').addEventListener('click', () => (appOpen() ? closeApp() : openApp('app')));
    $('#ask-btn').addEventListener('click', () => openApp(S.focus ? `screen:${S.focus.screen}` : 'app'));
    $('#app-close').addEventListener('click', closeApp);
    $('#ask-scope').addEventListener('change', paintHint);
    $('#ask-form').addEventListener('submit', sendAsk);
    $('#ask-text').addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) sendAsk(e);
    });
    $('#n-app').addEventListener('input', (e) => {
      S.notes.app = { ...(S.notes.app || {}), note: e.target.value };
      autosize(e.target);
      save();
    });

    // zoom
    $('#zoom-range').addEventListener('input', (e) => setZoom(e.target.value));
    $('#zoom-out').addEventListener('click', () => setZoom(S.zoom - 0.05));
    $('#zoom-in').addEventListener('click', () => setZoom(S.zoom + 0.05));

    // focus view
    $$('#rail button[data-tool]').forEach((b) => b.addEventListener('click', () => setTool(S.tool === b.dataset.tool && b.dataset.tool !== 'select' ? 'select' : b.dataset.tool)));
    $('#add-note').addEventListener('click', () => setTool('note'));
    $('#stage-fit').addEventListener('click', () => setStageZoom('fit'));
    $('#stage-100').addEventListener('click', () => setStageZoom(1));
    $('#stage-in').addEventListener('click', () => setStageZoom('in'));
    $('#stage-out').addEventListener('click', () => setStageZoom('out'));
    $('#n-screen').addEventListener('input', (e) => {
      if (!S.focus) return;
      const s = (S.notes.screens[S.focus.screen] ||= { note: '', states: {} });
      s.note = e.target.value;
      autosize(e.target);
      paintBoardNotes();
      save();
    });
    $('#n-state').addEventListener('input', (e) => {
      if (!S.focus) return;
      ensureState(S.focus.screen, S.focus.state).note = e.target.value;
      autosize(e.target);
      save();
    });
    addEventListener('resize', resizeStage);
    if (window.ResizeObserver) new ResizeObserver(() => resizeStage()).observe($('#stage-body'));
    document.addEventListener('keydown', onKey);
    addEventListener('hashchange', fromHash);
  }

  function resizeStage() {
    if (!stage) return;
    const z = stageZoom(stage.dev);
    stage.z = z;
    sizeFrame(stage.rec, z);
  }

  function onKey(e) {
    const typing = e.target.closest?.('input, textarea, select, [contenteditable=""], [contenteditable="true"]');
    if (e.key === 'Escape') {
      if (typing && e.target.ownerDocument === document) return e.target.blur();
      if (!$('#activity').hidden || !$('#export-pop').hidden) return closePops(null);
      if (appOpen()) return closeApp();
      if (S.focus && S.tool !== 'select') return setTool('select');
      if (S.focus && S.hot) return selectMark(null, false);
      if (S.full) return setFull(false);
      if (S.focus) return closeFocus();
      return;
    }
    if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === '[') {
      e.preventDefault();
      return setSide(!S.side);
    }
    const k = e.key.toLowerCase();
    if (S.focus) {
      if (!READ_ONLY && TOOL_KEYS[k]) {
        e.preventDefault();
        return setTool(TOOL_KEYS[k]);
      }
      if (k === 'f') {
        e.preventDefault();
        return setFull(!S.full);
      }
      if (k === '-' || k === '_') return setStageZoom('out');
      if (k === '=' || k === '+') return setStageZoom('in');
      if (k === '0') return setStageZoom('fit');
      if (k === '1') return setStageZoom(1);
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        return step(e.key === 'ArrowLeft' ? -1 : 1);
      }
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        if (e.target.ownerDocument !== document) return; // let the mock scroll
        e.preventDefault();
        return stepScreen(e.key === 'ArrowUp' ? -1 : 1);
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && S.hot && !READ_ONLY) {
        const m = marksOf(S.focus.screen, S.focus.state).find((x) => x.id === S.hot);
        if (m && m.status !== 'sent') {
          e.preventDefault();
          deleteMark(m.id);
        }
      }
      return;
    }
    if (k === '-' || k === '_') setZoom(S.zoom - 0.05);
    else if (k === '=' || k === '+') setZoom(S.zoom + 0.05);
    else if (k === '0') setZoom(0.55);
  }

  function fromHash() {
    const m = decodeURIComponent(location.hash.slice(1)).match(/^([a-z0-9-]+)\/([a-z0-9-]+)$/);
    if (m) {
      if (!S.focus || S.focus.screen !== m[1] || S.focus.state !== m[2]) openFocus(m[1], m[2]);
    } else if (S.focus) closeFocus();
  }

  async function boot() {
    wire();
    if (store.get('side', null) == null && innerWidth < 900) S.side = false;
    setSide(S.side);
    try {
      await load();
    } catch (err) {
      $('#project-name').textContent = 'Couldn’t load the project';
      toast(err.message);
      return;
    }
    setZoom(S.zoom);
    renderBoard();
    paintClaude();
    fromHash();
    connect();
    // Relative times in Activity stay fresh.
    setInterval(() => !$('#activity').hidden && renderActivity(), 30_000);
  }

  // Exposed for tests and screenshots.
  window.dddBoard = { state: S, openFocus, closeFocus, addMark, setTool, setZoom, setStageZoom, selectMark, setSide, openApp, closeApp, goScreen, goFlow };

  boot();
})();
