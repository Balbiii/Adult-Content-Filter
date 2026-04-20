// Adult Content Filter — Popup Script v7
// No innerHTML assignments — all DOM built programmatically

// ── Element refs ──────────────────────────────────────────────────────────────
const toggle      = document.getElementById('toggle');
const statusDot   = document.getElementById('status-dot');
const statusText  = document.getElementById('status-text');
const statHidden  = document.getElementById('stat-hidden');
const statSess    = document.getElementById('stat-session');
const logList     = document.getElementById('log-list');
const logCount    = document.getElementById('log-count');
const clearLogBtn = document.getElementById('clear-log-btn');
const wlList      = document.getElementById('wl-list');

let currentLog       = [];
let currentWhitelist = {};
let customKeywords   = [];
let blockedActors    = [];

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Safely set text on an element */
function setText(el, text) {
  el.textContent = String(text ?? '');
}

/** Create element with optional className and text */
function el(tag, opts = {}) {
  const node = document.createElement(tag);
  if (opts.cls)   node.className   = opts.cls;
  if (opts.text)  node.textContent = opts.text;
  if (opts.title) node.title       = opts.title;
  if (opts.attrs) {
    Object.entries(opts.attrs).forEach(([k, v]) => node.setAttribute(k, v));
  }
  return node;
}

/** Empty a container */
function empty(container) {
  while (container.firstChild) container.removeChild(container.firstChild);
}

/** Build an "empty state" block */
function emptyState(emoji, lines) {
  const div  = el('div', { cls: 'empty-state' });
  const span = el('span', { cls: 'emoji', text: emoji });
  div.appendChild(span);
  lines.forEach((line, i) => {
    if (i > 0) div.appendChild(document.createElement('br'));
    div.appendChild(document.createTextNode(line));
  });
  return div;
}

function sendToTab(msg) {
  browser.tabs.query({ active: true, currentWindow: true }).then(tabs => {
    if (tabs[0]) browser.tabs.sendMessage(tabs[0].id, msg).catch(() => {});
  });
}

function timeAgo(ts) {
  const d = Math.floor((Date.now() - ts) / 1000);
  if (d < 60)   return `${d}s ago`;
  if (d < 3600) return `${Math.floor(d / 60)}m ago`;
  return `${Math.floor(d / 3600)}h ago`;
}

// ── Tab switching ─────────────────────────────────────────────────────────────
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('tab-' + btn.dataset.tab).classList.add('active');
  });
});

// ── Status / toggle ───────────────────────────────────────────────────────────
function updateUI(enabled) {
  toggle.checked = enabled;
  statusDot.classList.toggle('off', !enabled);

  empty(statusText);
  const strong = el('strong', { text: enabled ? 'Filter on' : 'Filter off' });
  statusText.appendChild(strong);
  statusText.appendChild(document.createTextNode(
    enabled ? ' — scanning this page' : ' — content visible'
  ));
}

toggle.addEventListener('change', () => {
  const enabled = toggle.checked;
  updateUI(enabled);
  browser.storage.local.set({ filterEnabled: enabled });
  sendToTab({ type: 'SET_FILTER', enabled });
  setTimeout(fetchStats, 400);
});

// ── Fetch stats ───────────────────────────────────────────────────────────────
function fetchStats() {
  browser.tabs.query({ active: true, currentWindow: true }).then(tabs => {
    if (!tabs[0]) return;
    browser.tabs.sendMessage(tabs[0].id, { type: 'GET_STATS' })
      .then(res => {
        if (!res) return;
        setText(statHidden, res.hidden);
        setText(statSess,   res.log ? res.log.length : 0);
        renderLog(res.log || []);
      })
      .catch(() => {
        setText(statHidden, '—');
        setText(statSess, '—');
      });
  });
}

// ── Log ───────────────────────────────────────────────────────────────────────
function renderLog(log) {
  currentLog = log || [];
  setText(logCount, `${currentLog.length} item${currentLog.length !== 1 ? 's' : ''}`);
  empty(logList);

  if (!currentLog.length) {
    logList.appendChild(emptyState('✨', ['No items hidden yet on this page']));
    return;
  }

  currentLog.forEach(item => {
    const isWL = !!currentWhitelist[item.id];

    const row = el('div', { cls: 'log-item' });

    // Thumbnail
    if (item.thumb) {
      const img = el('img', { cls: 'log-thumb', attrs: { alt: '', src: item.thumb } });
      img.addEventListener('error', () => { img.style.display = 'none'; });
      row.appendChild(img);
    } else {
      row.appendChild(el('div', { cls: 'log-thumb-placeholder', text: '🎬' }));
    }

    // Info block
    const info = el('div', { cls: 'log-info' });

    const labelEl = el('div', { cls: 'log-label', text: item.label, title: item.label });
    info.appendChild(labelEl);

    const meta = el('div', { cls: 'log-meta' });
    meta.appendChild(document.createTextNode(`${item.site} · ${timeAgo(item.timestamp)}`));

    // Reason badge
    if (item.reason) {
      if (item.reason.startsWith('actor:') || item.reason.startsWith('actor-url:') || item.reason.startsWith('actor-channel:')) {
        const name   = item.reason.replace(/^actor[^:]*:/, '');
        const badge  = el('span', { text: `🎭 ${name}` });
        badge.style.cssText = 'color:var(--pink);font-size:9px;margin-left:4px';
        meta.appendChild(badge);
      } else if (item.reason.startsWith('channel:')) {
        const badge = el('span', { text: `📺 ${item.reason.slice(8)}` });
        badge.style.cssText = 'color:var(--amber);font-size:9px;margin-left:4px';
        meta.appendChild(badge);
      }
    }
    info.appendChild(meta);
    row.appendChild(info);

    // Allow button
    const btn = el('button', {
      cls:  'whitelist-btn' + (isWL ? ' whitelisted' : ''),
      text: isWL ? 'Allowed' : 'Allow',
      attrs: { 'data-fp': item.id },
    });
    btn.addEventListener('click', () => {
      if (!currentWhitelist[item.id]) {
        currentWhitelist[item.id] = item.label;
        sendToTab({ type: 'WHITELIST_ADD', fp: item.id });
      } else {
        delete currentWhitelist[item.id];
        sendToTab({ type: 'WHITELIST_REMOVE', fp: item.id });
      }
      browser.storage.local.set({ whitelistMeta: currentWhitelist });
      renderLog(currentLog);
      renderWhitelist();
    });
    row.appendChild(btn);

    logList.appendChild(row);
  });
}

clearLogBtn.addEventListener('click', () => {
  currentLog = [];
  browser.storage.local.set({ hiddenLog: [] });
  sendToTab({ type: 'CLEAR_LOG' });
  renderLog([]);
  setText(statHidden, '0');
  setText(statSess, '0');
});

// ── Whitelist ─────────────────────────────────────────────────────────────────
function renderWhitelist() {
  empty(wlList);
  const entries = Object.entries(currentWhitelist);

  if (!entries.length) {
    wlList.appendChild(emptyState('📋', [
      'No whitelisted items yet.',
      'Use "Allow" on hidden items to add them.',
    ]));
    return;
  }

  entries.forEach(([fp, label]) => {
    const row = el('div', { cls: 'wl-item' });

    row.appendChild(el('div', { cls: 'wl-dot' }));
    row.appendChild(el('div', { cls: 'wl-label', text: label, title: label }));

    const rmBtn = el('button', { cls: 'wl-remove', text: '✕', attrs: { 'data-fp': fp } });
    rmBtn.addEventListener('click', () => {
      delete currentWhitelist[fp];
      browser.storage.local.set({ whitelistMeta: currentWhitelist });
      sendToTab({ type: 'WHITELIST_REMOVE', fp });
      renderWhitelist();
      renderLog(currentLog);
    });
    row.appendChild(rmBtn);

    wlList.appendChild(row);
  });
}

// ── Keywords ──────────────────────────────────────────────────────────────────
const kwInput      = document.getElementById('kw-input');
const kwAddBtn     = document.getElementById('kw-add-btn');
const kwCustomList = document.getElementById('kw-custom-list');
const kwBadge      = document.getElementById('kw-badge');

function updateKwBadge() {
  if (customKeywords.length) {
    setText(kwBadge, customKeywords.length);
    kwBadge.style.display = 'inline-block';
  } else {
    kwBadge.style.display = 'none';
  }
}

function renderKeywords() {
  updateKwBadge();
  empty(kwCustomList);

  if (!customKeywords.length) {
    kwCustomList.appendChild(el('span', {
      text: 'No keywords yet.',
      attrs: { style: 'font-size:11px;color:var(--muted)' },
    }));
    return;
  }

  customKeywords.forEach((kw, idx) => {
    const tag  = el('span', { cls: 'kw-tag' });
    tag.appendChild(document.createTextNode(kw));

    const rm = el('button', { cls: 'kw-remove', text: '✕', title: 'Remove', attrs: { 'data-idx': idx } });
    rm.addEventListener('click', () => {
      customKeywords.splice(idx, 1);
      saveKeywords();
    });
    tag.appendChild(rm);
    kwCustomList.appendChild(tag);
  });
}

function saveKeywords() {
  browser.storage.local.set({ customKeywords });
  sendToTab({ type: 'SET_KEYWORDS', keywords: customKeywords });
  renderKeywords();
}

function addKeyword() {
  const val = kwInput.value.trim();
  if (!val || customKeywords.map(k => k.toLowerCase()).includes(val.toLowerCase())) {
    kwInput.value = ''; return;
  }
  customKeywords.push(val);
  kwInput.value = '';
  saveKeywords();
}

kwAddBtn.addEventListener('click', addKeyword);
kwInput.addEventListener('keydown', e => { if (e.key === 'Enter') addKeyword(); });

// ── Actors ────────────────────────────────────────────────────────────────────
const actorInput    = document.getElementById('actor-input');
const actorAddBtn   = document.getElementById('actor-add-btn');
const actorListEl   = document.getElementById('actor-list');
const actorTabBadge = document.getElementById('actor-tab-badge');

function updateActorBadge() {
  if (blockedActors.length) {
    setText(actorTabBadge, blockedActors.length);
    actorTabBadge.style.display = 'inline-block';
  } else {
    actorTabBadge.style.display = 'none';
  }
}

function renderActors() {
  updateActorBadge();
  empty(actorListEl);

  if (!blockedActors.length) {
    actorListEl.appendChild(emptyState('🎭', ['No blocked performers yet.']));
    return;
  }

  blockedActors.forEach((name, idx) => {
    const row = el('div', { cls: 'actor-item' });
    row.appendChild(el('div', { cls: 'actor-dot' }));
    row.appendChild(el('div', { cls: 'actor-name', text: name, title: name }));

    const rm = el('button', { cls: 'actor-remove', text: '✕', attrs: { 'data-idx': idx } });
    rm.addEventListener('click', () => {
      blockedActors.splice(idx, 1);
      saveActors();
    });
    row.appendChild(rm);
    actorListEl.appendChild(row);
  });
}

function saveActors() {
  browser.storage.local.set({ blockedActors });
  sendToTab({ type: 'SET_ACTORS', actors: blockedActors });
  renderActors();
}

function addActor() {
  const val = actorInput.value.trim();
  if (!val || blockedActors.map(a => a.toLowerCase()).includes(val.toLowerCase())) {
    actorInput.value = ''; return;
  }
  blockedActors.push(val);
  actorInput.value = '';
  saveActors();
}

actorAddBtn.addEventListener('click', addActor);
actorInput.addEventListener('keydown', e => { if (e.key === 'Enter') addActor(); });

// ── Import / Export ───────────────────────────────────────────────────────────
const exportBtn  = document.getElementById('export-btn');
const importFile = document.getElementById('import-file');
const resetBtn   = document.getElementById('reset-btn');
const ieToast    = document.getElementById('ie-toast');

function showToast(msg, isError = false) {
  setText(ieToast, msg);
  ieToast.className = 'ie-toast show' + (isError ? ' error' : '');
  setTimeout(() => { ieToast.className = 'ie-toast'; }, 3000);
}

exportBtn.addEventListener('click', () => {
  const payload = {
    version: 1,
    exportedAt: new Date().toISOString(),
    customKeywords,
    blockedActors,
    whitelist: Object.entries(currentWhitelist).map(([fp, label]) => ({ fp, label })),
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `adult-content-filter-settings-${Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(url);
  showToast('✓ Settings exported successfully.');
});

importFile.addEventListener('change', () => {
  const file = importFile.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const data = JSON.parse(e.target.result);
      if (typeof data !== 'object' || !data.version) throw new Error('Invalid file');

      if (Array.isArray(data.customKeywords)) {
        const existing = customKeywords.map(k => k.toLowerCase());
        data.customKeywords.forEach(k => {
          if (k && !existing.includes(k.toLowerCase())) customKeywords.push(k);
        });
        browser.storage.local.set({ customKeywords });
        sendToTab({ type: 'SET_KEYWORDS', keywords: customKeywords });
        renderKeywords();
      }
      if (Array.isArray(data.blockedActors)) {
        const existing = blockedActors.map(a => a.toLowerCase());
        data.blockedActors.forEach(a => {
          if (a && !existing.includes(a.toLowerCase())) blockedActors.push(a);
        });
        browser.storage.local.set({ blockedActors });
        sendToTab({ type: 'SET_ACTORS', actors: blockedActors });
        renderActors();
      }
      if (Array.isArray(data.whitelist)) {
        data.whitelist.forEach(({ fp, label }) => {
          if (fp && label) currentWhitelist[fp] = label;
        });
        browser.storage.local.set({ whitelistMeta: currentWhitelist });
        renderWhitelist();
      }
      showToast('✓ Settings imported and merged.');
    } catch {
      showToast('✗ Invalid file. Please use an exported settings file.', true);
    }
    importFile.value = '';
  };
  reader.readAsText(file);
});

resetBtn.addEventListener('click', () => {
  if (!confirm('Reset ALL settings? This will clear all keywords, blocked performers, and the whitelist.')) return;
  customKeywords   = [];
  blockedActors    = [];
  currentWhitelist = {};
  browser.storage.local.set({ customKeywords, blockedActors, whitelistMeta: {}, whitelist: [], hiddenLog: [] });
  sendToTab({ type: 'SET_KEYWORDS', keywords: [] });
  sendToTab({ type: 'SET_ACTORS', actors: [] });
  renderKeywords();
  renderActors();
  renderWhitelist();
  renderLog([]);
  setText(statHidden, '0');
  setText(statSess, '0');
  showToast('✓ All settings have been reset.');
});

// ── Init ──────────────────────────────────────────────────────────────────────
browser.storage.local.get({
  filterEnabled:  true,
  whitelistMeta:  {},
  hiddenLog:      [],
  customKeywords: [],
  blockedActors:  [],
}).then(result => {
  updateUI(result.filterEnabled);
  currentWhitelist = result.whitelistMeta  || {};
  customKeywords   = result.customKeywords || [];
  blockedActors    = result.blockedActors  || [];
  renderWhitelist();
  renderKeywords();
  renderActors();
  fetchStats();
});
