// Adult Content Filter — Content Script v6
//
// Supported site structures:
//   GENERIC  → .item / article / li.video / etc tile wrappers
//   PORNHUB  → li.pcVideoListItem  (title: .thumbnailTitle, channel: .usernameWrapper a)
//
// Filter triggers per tile:
//   • keyword match in title text
//   • keyword match in channel / uploader name
//   • keyword match in model/site meta-links
//   • keyword match in image alt or src URL
//   • actor name exact-match in performer links or display spans
//   • actor slug match in /model/ or /models/ href

// ─── Structural selectors ─────────────────────────────────────────────────────

const TILE_SELECTORS = [
  // Generic
  '.item', '.thumb-item', '.video-item', '.video-card', '.video-block',
  '.videoItem', '.videoBlock', '.scene-card', '.clip-card',
  '.post-card', '.content-card', '.media-card', '.gallery-item', '.grid-item',
  'article',
  'li.item', 'li.video', 'li.thumb', 'li.videoItem',
  // Pornhub
  'li.pcVideoListItem',
];

const TITLE_SELECTORS = [
  // Generic
  '.title', '.thumb_title', '.video-title', '.clip-title',
  '.card-title', '.item-title', '.scene-title', '.post-title',
  '[class*="title"]',
  'h1', 'h2', 'h3', 'h4', 'h5',
  // Pornhub
  '.thumbnailTitle', '.vidTitleWrapper .title a',
];

// Channel / uploader name selectors (checked for keyword match)
const CHANNEL_SELECTORS = [
  // Pornhub
  '.usernameWrapper a', '.videoUploaderBlock a', '.usernameWrap a',
  // Generic
  '.channel-name', '.uploader', '.uploader-name', '.channel-link',
  '[class*="uploader"]', '[class*="channel"]',
];

const META_LINK_SELECTORS = [
  '.models__item', '.model-link',
  '.site-link', '.thumb_cs', '.thumb_model',
  '[class*="model"]', '[class*="studio"]',
];

const ACTOR_NAME_SELECTORS = [
  '.models__item span', '.models__item',
  '.model-link span', '.model-link',
  '.thumb_model span',
  '[class*="performer"] span', '[class*="actor"] span',
];

const CHAT_SELECTORS = [
  '.message', '.chat-message', '.chat-msg',
  '.forum-post', '.comment', '.reply',
  '.feed-item', '.feed-post',
];

const TAG_SELECTORS = [
  '[class*="tag"]:not(body):not(html)',
  '[class*="Tag"]:not(body):not(html)',
  '[class*="badge"]', '[class*="Badge"]',
  '[class*="chip"]',
  '[class*="category"]:not(body):not(html)',
  '[class*="genre"]',
];

// ─── State ────────────────────────────────────────────────────────────────────

let filterEnabled  = true;
let whitelist      = new Set();
let customKeywords = [];
let blockedActors  = [];
let hiddenLog      = [];
const MAX_LOG      = 50;

// ─── Pattern helpers ──────────────────────────────────────────────────────────

function buildKeywordPattern() {
  if (!customKeywords.length) return null;
  const parts = customKeywords.map(kw =>
    kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  );
  return new RegExp(parts.join('|'), 'gi');
}

function keywordMatches(text) {
  if (!text || !customKeywords.length) return false;
  const p = buildKeywordPattern();
  if (!p) return false;
  p.lastIndex = 0;
  return p.test(text);
}

function actorMatches(text) {
  if (!text || !blockedActors.length) return false;
  const normalized = text.trim().toLowerCase();
  return blockedActors.some(a => a.trim().toLowerCase() === normalized && a.trim().length > 0);
}

// ─── Tile / ancestor finding ──────────────────────────────────────────────────

function findTile(el, maxDepth = 10) {
  let node = el?.parentElement;
  for (let i = 0; i < maxDepth && node && node !== document.body; i++) {
    for (const sel of TILE_SELECTORS) {
      try { if (node.matches(sel)) return node; } catch {}
    }
    node = node.parentElement;
  }
  return null;
}

function findChatAncestor(el, maxDepth = 6) {
  let node = el?.parentElement;
  for (let i = 0; i < maxDepth && node && node !== document.body; i++) {
    for (const sel of CHAT_SELECTORS) {
      try { if (node.matches(sel)) return node; } catch {}
    }
    node = node.parentElement;
  }
  return null;
}

// ─── Fingerprint / log ────────────────────────────────────────────────────────

function fingerprint(el) {
  const text = (el.textContent || '').trim().slice(0, 80);
  const href = el.querySelector?.('a[href]')?.href || '';
  const src  = el.querySelector?.('img')?.src || '';
  try { return btoa(encodeURIComponent([text, href, src].join('|'))).slice(0, 32); }
  catch { return String(Math.random()).slice(2); }
}

function extractLabel(el) {
  for (const sel of [...TITLE_SELECTORS, ...CHANNEL_SELECTORS]) {
    try {
      const t = el.querySelector(sel);
      if (t) return t.textContent.trim().slice(0, 60);
    } catch {}
  }
  return (el.textContent || '').trim().slice(0, 60) || '(unlabeled)';
}

function extractThumb(el) {
  const img = el.querySelector?.('img');
  return img?.src || img?.getAttribute('data-src') || img?.getAttribute('data-mediumthumb') || '';
}

function logItem(el, reason) {
  const fp = fingerprint(el);
  if (hiddenLog.some(i => i.id === fp)) return fp;
  hiddenLog.unshift({
    id: fp,
    label: extractLabel(el),
    thumb: extractThumb(el),
    url: el.querySelector?.('a[href]')?.href || window.location.href,
    reason,
    timestamp: Date.now(),
    site: window.location.hostname,
  });
  if (hiddenLog.length > MAX_LOG) hiddenLog.length = MAX_LOG;
  browser.storage.local.get({ hiddenLog: [] }).then(({ hiddenLog: stored }) => {
    const merged = [...hiddenLog,
      ...stored.filter(s => !hiddenLog.find(h => h.id === s.id)),
    ].slice(0, MAX_LOG);
    browser.storage.local.set({ hiddenLog: merged });
  });
  return fp;
}

// ─── Hide / restore ───────────────────────────────────────────────────────────

function hideEl(el, reason) {
  if (!el || el.dataset.acfFiltered) return;
  const fp = fingerprint(el);
  if (whitelist.has(fp)) return;
  el.dataset.acfFiltered = '1';
  el.dataset.acfReason   = reason;
  el.dataset.acfFp       = fp;
  el.classList.add('acf-filter-hidden');
  logItem(el, reason);
}

function restoreByFp(fp) {
  document.querySelectorAll(`[data-acf-fp="${fp}"]`).forEach(el => {
    el.classList.remove('acf-filter-hidden');
    delete el.dataset.acfFiltered;
    delete el.dataset.acfFp;
    delete el.dataset.acfReason;
  });
}

function resetPage() {
  document.querySelectorAll('.acf-filter-hidden').forEach(el => {
    el.classList.remove('acf-filter-hidden');
    delete el.dataset.acfFiltered;
    delete el.dataset.acfFp;
    delete el.dataset.acfReason;
  });
}

// ─── Core tile check ──────────────────────────────────────────────────────────

function checkTile(tile) {
  if (!tile || tile.dataset.acfFiltered) return;
  if (whitelist.has(fingerprint(tile))) return;

  // 1. Title
  for (const sel of TITLE_SELECTORS) {
    try {
      const el = tile.querySelector(sel);
      if (el && keywordMatches(el.textContent)) { hideEl(tile, 'title'); return; }
    } catch {}
  }

  // 2. Channel / uploader name
  for (const sel of CHANNEL_SELECTORS) {
    try {
      tile.querySelectorAll(sel).forEach(el => {
        if (tile.dataset.acfFiltered) return;
        if (keywordMatches(el.textContent)) hideEl(tile, `channel:${el.textContent.trim().slice(0, 40)}`);
      });
    } catch {}
    if (tile.dataset.acfFiltered) return;
  }

  // 3. Model / site meta-links (text + href)
  for (const sel of META_LINK_SELECTORS) {
    try {
      tile.querySelectorAll(sel).forEach(el => {
        if (tile.dataset.acfFiltered) return;
        if (keywordMatches(el.textContent)) hideEl(tile, 'meta-link');
      });
    } catch {}
    if (tile.dataset.acfFiltered) return;
  }

  // 4. Images — alt text
  tile.querySelectorAll('img').forEach(img => {
    if (tile.dataset.acfFiltered) return;
    const alt = img.alt || img.getAttribute('alt') || '';
    const title = img.getAttribute('data-title') || img.getAttribute('title') || '';
    if (keywordMatches(alt) || keywordMatches(title)) hideEl(tile, 'img');
  });
  if (tile.dataset.acfFiltered) return;

  // 5. Actor name blocking — display text
  if (blockedActors.length > 0) {
    for (const sel of ACTOR_NAME_SELECTORS) {
      try {
        tile.querySelectorAll(sel).forEach(el => {
          if (tile.dataset.acfFiltered) return;
          const name = Array.from(el.childNodes)
            .filter(n => n.nodeType === Node.TEXT_NODE)
            .map(n => n.textContent.trim())
            .join(' ')
            .trim() || el.textContent.trim();
          if (actorMatches(name)) hideEl(tile, `actor:${name}`);
        });
      } catch {}
      if (tile.dataset.acfFiltered) return;
    }

    // Also check channel/uploader name against actor list
    for (const sel of CHANNEL_SELECTORS) {
      try {
        tile.querySelectorAll(sel).forEach(el => {
          if (tile.dataset.acfFiltered) return;
          if (actorMatches(el.textContent.trim())) {
            hideEl(tile, `actor-channel:${el.textContent.trim().slice(0, 40)}`);
          }
        });
      } catch {}
      if (tile.dataset.acfFiltered) return;
    }

    // Actor slug in href
    tile.querySelectorAll('a[href]').forEach(a => {
      if (tile.dataset.acfFiltered) return;
      const href = a.href || a.getAttribute('href') || '';
      const slugMatch = href.match(/\/(?:models?|performers?|actors?|stars?|model)\/([^/?#]+)/i);
      if (slugMatch) {
        const slug = decodeURIComponent(slugMatch[1]).replace(/-/g, ' ').replace(/"/g, '').trim();
        if (actorMatches(slug)) hideEl(tile, `actor-url:${slug}`);
      }
    });
  }
}

// ─── Non-tile scan ────────────────────────────────────────────────────────────

function checkChatMessages() {
  CHAT_SELECTORS.forEach(sel => {
    try {
      document.querySelectorAll(sel).forEach(el => {
        if (!el.dataset.acfFiltered && keywordMatches(el.textContent)) hideEl(el, 'chat');
      });
    } catch {}
  });
}

function checkTagChips() {
  TAG_SELECTORS.forEach(sel => {
    try {
      document.querySelectorAll(sel).forEach(el => {
        if (el.dataset.acfFiltered || el.children.length > 5) return;
        if (keywordMatches(el.textContent)) hideEl(el, 'tag');
      });
    } catch {}
  });
}

// ─── Full scan ────────────────────────────────────────────────────────────────

function runFullScan() {
  if (!filterEnabled) return;
  TILE_SELECTORS.forEach(sel => {
    try { document.querySelectorAll(sel).forEach(tile => checkTile(tile)); } catch {}
  });
  checkChatMessages();
  checkTagChips();
}

// ─── MutationObserver ─────────────────────────────────────────────────────────

let scanTimer = null;
function scheduleFullScan() {
  clearTimeout(scanTimer);
  scanTimer = setTimeout(runFullScan, 250);
}

const observer = new MutationObserver(mutations => {
  if (!filterEnabled) return;
  let needScan = false;
  for (const mut of mutations) {
    if (mut.addedNodes.length || mut.type === 'attributes') { needScan = true; break; }
  }
  if (needScan) scheduleFullScan();
});

observer.observe(document.documentElement, {
  childList: true, subtree: true, attributes: true,
  attributeFilter: ['src', 'href', 'data-src', 'data-title', 'title', 'alt'],
});

// ─── Messages ─────────────────────────────────────────────────────────────────

browser.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'SET_FILTER') {
    filterEnabled = msg.enabled;
    browser.storage.local.set({ filterEnabled });
    if (filterEnabled) runFullScan(); else resetPage();
  }
  if (msg.type === 'GET_STATS') {
    return Promise.resolve({
      hidden: document.querySelectorAll('.acf-filter-hidden').length,
      log: hiddenLog,
    });
  }
  if (msg.type === 'WHITELIST_ADD') {
    whitelist.add(msg.fp);
    browser.storage.local.set({ whitelist: [...whitelist] });
    restoreByFp(msg.fp);
    hiddenLog = hiddenLog.filter(i => i.id !== msg.fp);
    browser.storage.local.set({ hiddenLog });
  }
  if (msg.type === 'WHITELIST_REMOVE') {
    whitelist.delete(msg.fp);
    browser.storage.local.set({ whitelist: [...whitelist] });
    runFullScan();
  }
  if (msg.type === 'CLEAR_LOG') {
    hiddenLog = [];
    browser.storage.local.set({ hiddenLog: [] });
  }
  if (msg.type === 'SET_KEYWORDS') {
    customKeywords = msg.keywords || [];
    browser.storage.local.set({ customKeywords });
    resetPage(); runFullScan();
  }
  if (msg.type === 'SET_ACTORS') {
    blockedActors = msg.actors || [];
    browser.storage.local.set({ blockedActors });
    resetPage(); runFullScan();
  }
});

// ─── Init ─────────────────────────────────────────────────────────────────────

browser.storage.local.get({
  filterEnabled: true, whitelist: [], hiddenLog: [],
  customKeywords: [], blockedActors: [],
}).then(result => {
  filterEnabled  = result.filterEnabled;
  whitelist      = new Set(result.whitelist);
  hiddenLog      = result.hiddenLog || [];
  customKeywords = result.customKeywords || [];
  blockedActors  = result.blockedActors || [];
  if (filterEnabled) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', runFullScan);
    } else {
      runFullScan();
    }
  }
});
