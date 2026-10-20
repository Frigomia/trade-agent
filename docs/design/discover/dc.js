/* Discover (watchlist): shared sample data, behaviour and section builders. Needs ../today-discovery/lib.js first.
   Fictional companies and numbers: sample data, not a claim about any real firm.
   The search, Add, filters, sort, Analyze and Remove (with Undo) really work in each copy of the page. */
Object.assign(I, {
  plus: '<path d="M12 5v14M5 12h14"/>',
  circ: '<circle cx="12" cy="12" r="8" stroke-dasharray="3 3"/>',
  trash: '<path d="M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13"/>',
  sort: '<path d="M7 4v16M7 20l-3-3M7 20l3-3M17 20V4M17 4l-3 3M17 4l3 3"/>',
  cal: '<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M8 3v4M16 3v4M4 10h16"/>',
});
/* the universe a search draws from: name, ticker, exchange, currency and price come with it, so the user types none of them */
const DB = [
  { t: 'HLDN', n: 'Halden Systems', exch: 'NASDAQ', cur: 'USD', price: 184.2, chg: 2.1 },
  { t: 'BRVK', n: 'Brevik Medical', exch: 'Stockholm', cur: 'SEK', price: 412.6, chg: -0.8 },
  { t: 'TNKP', n: 'Tanaka Precision', exch: 'Tokyo', cur: 'JPY', price: 3845, chg: 1.8 },
  { t: 'NVKC', n: 'Norvik Cloud', exch: 'NASDAQ', cur: 'USD', price: 205.0, chg: 1.2 },
  { t: 'PLMN', n: 'Pellman Stores', exch: 'NYSE', cur: 'USD', price: 48.3, chg: -0.4 },
  { t: 'QSMC', n: 'Quade Semiconductors', exch: 'NASDAQ', cur: 'USD', price: null, chg: null },
  { t: 'HLST', n: 'Halstead Marine', exch: 'Oslo', cur: 'NOK', price: 238.4, chg: 0.6 },
  { t: 'KSTR', n: 'Kestrel Systems', exch: 'NYSE', cur: 'USD', price: 97.15, chg: 0.9 },
  { t: 'LMST', n: 'Lumen Stack', exch: 'Frankfurt', cur: 'EUR', price: 61.8, chg: -1.3 },
  { t: 'CRVN', n: 'Corvane Energy', exch: 'Toronto', cur: 'CAD', price: 38.1, chg: 3.4 },
  { t: 'MRLW', n: 'Marlow Water', exch: 'London', cur: 'GBP', price: 12.84, chg: 0.3 },
  { t: 'AURL', n: 'Aurelle Foods', exch: 'Paris', cur: 'EUR', price: 47.43, chg: -0.4 },
];
const WL0 = [
  { t: 'HLDN', age: 2, src: 'Today', status: 'analyzed', insight: 'Recurring software revenue and widening margins, priced below its peers.' },
  { t: 'BRVK', age: 5, src: 'Today', status: 'analyzed', insight: 'Steady cash generation and low debt, with a valuation in line with peers.' },
  { t: 'TNKP', age: 9, src: 'Today', status: 'analyzed', insight: 'Order backlog is growing and returns sit above the sector upper quartile.' },
  { t: 'NVKC', age: 1, src: 'Added by you', status: 'none' },
  { t: 'PLMN', age: 3, src: 'Added by you', status: 'none' },
  { t: 'QSMC', age: 12, src: 'Added by you', status: 'none' },
];
const esc = (x) => String(x).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const co = (t) => DB.find((d) => d.t === t);
const fmtp = (d) => (d.price == null ? null : `${d.cur} ${d.price.toLocaleString('en-US', { minimumFractionDigits: d.cur === 'JPY' ? 0 : 2, maximumFractionDigits: d.cur === 'JPY' ? 0 : 2 })}`);
const ago = (a) => (a === 0 ? 'just now' : `${a} day${a === 1 ? '' : 's'} ago`);
const full = (it) => ({ ...co(it.t), ...it });

/* ---- state and derived lists ---- */
const FILTERS = [['all', 'All'], ['analyzed', 'AI analyzed'], ['none', 'Not analyzed']];
const SORTS = [['new', 'Recently added'], ['name', 'Name'], ['chg', 'Daily change']];
const isAn = (it) => it.status === 'analyzed';
function visible(s) {
  let l = s.items.map(full);
  if (s.filter === 'analyzed') l = l.filter(isAn); else if (s.filter === 'none') l = l.filter((x) => !isAn(x));
  const by = { new: (a, b) => a.age - b.age, name: (a, b) => a.n.localeCompare(b.n), chg: (a, b) => (b.chg ?? -99) - (a.chg ?? -99) }[s.sort];
  return l.sort(by);
}
const counts = (s) => ({ all: s.items.length, analyzed: s.items.filter(isAn).length, none: s.items.filter((x) => !isAn(x)).length });
const results = (s) => { const q = s.q.trim().toLowerCase(); return q ? DB.filter((d) => d.n.toLowerCase().includes(q) || d.t.toLowerCase().includes(q)).slice(0, 5) : []; };
const has = (s, t) => s.items.some((x) => x.t === t);

/* ---- pieces ---- */
const pill = (st) => st === 'analyzed' ? `<span class="stp an">${ic('check', 'xs')}AI analyzed</span>` : st === 'running' ? `<span class="stp run">${ic('refresh', 'xs')}Analyzing</span>` : `<span class="stp no">${ic('circ', 'xs')}Not analyzed</span>`;
const priceBlock = (d) => d.price == null
  ? `<div class="px"><b class="nopx">Price unavailable</b><small>We could not get a quote. Try again later.</small></div>`
  : `<div class="px"><b class="num">${fmtp(d)}</b><span>${chg(d.chg)}</span><small>As of 14:14</small></div>`;
const openLabel = (d) => (isAn(d) ? `Open the investment report for ${d.n}` : `Open the company overview of ${d.n}`);
const nameLink = (d, cls = '') => `<a href="#" class="nm ${cls}" aria-label="${openLabel(d)}">${d.n}</a>`;
const insight = (d) => (isAn(d) && d.insight ? `<p class="ins">${ic('spark', 'xs')}<span>${d.insight}</span></p>` : '');
const rowActions = (d) => `${isAn(d) ? `<a href="#" class="btn ghost sm" aria-label="View the report for ${d.n}">${ic('eye', 's')}View</a>`
  : d.status === 'running' ? `<button class="btn ghost sm" disabled>${ic('refresh', 's')}Analyzing</button>`
  : `<button class="btn sm" data-act="run" data-t="${d.t}" title="Runs the research once and uses 1 of your monthly runs" aria-label="Analyze ${d.n}, uses 1 monthly run">${ic('spark', 's')}Analyze</button>`}
  <button class="btn ghost sm iconb" data-act="remove" data-t="${d.t}" aria-label="Remove ${d.n} from Discover" title="Remove from Discover">${ic('trash', 's')}</button>`;
const meta = (d) => `${d.t} · ${d.exch} · ${d.cur}`;
const sub = (d) => `Added ${ago(d.age)} · ${d.src === 'Today' ? 'saved from Today' : 'by you'}`;

const searchBox = (s, cls = '') => {
  const r = results(s);
  const list = !s.q.trim() ? '' : `<ul class="sres" role="list" aria-label="Search results">${r.length ? r.map((d) => `<li class="srow"><span class="srl">${logo(d.n, 32)}<span><b>${d.n}</b><small>${d.t} · ${d.exch} · ${d.cur}</small></span></span>${has(s, d.t)
    ? `<span class="dupn">${ic('check', 'xs')}Already in Discover</span>`
    : `<button class="btn sm" data-act="add" data-t="${d.t}" aria-label="Add ${d.n} to Discover">${ic('plus', 's')}Add</button>`}</li>`).join('') : `<li class="snone"><b>No company found for “${esc(s.q.trim())}”</b><p>Check the spelling, or try the ticker. Name, exchange and currency are filled in for you once you pick a result.</p></li>`}</ul>`;
  return `<div class="sbox ${cls}"><label class="search">${ic('search', 's')}<input class="sq" value="${esc(s.q)}" placeholder="Search by name or ticker" aria-label="Search a company by name or ticker" ${s.q.trim() ? '' : `aria-describedby="shint${s.id}"`} autocomplete="off"></label><button class="btn" data-act="addtop">${ic('plus', 's')}Add Company</button>${list}</div>
  ${s.q.trim() ? '' : `<p class="hint" id="shint${s.id}">We fill in the name, exchange and currency. No shares or purchase price needed, unlike Add Holding.</p>`}`;
};
const filters = (s) => { const c = counts(s); return `<div class="seg4" role="group" aria-label="Show">${FILTERS.map(([k, l]) => `<button data-act="filter" data-v="${k}" aria-pressed="${s.filter === k}" class="${s.filter === k ? 'on' : ''}">${l}<i class="cnt">${c[k]}</i></button>`).join('')}</div>`; };
const sorter = (s) => `<label class="sortl">Sort by<select class="ssel" aria-label="Sort by">${SORTS.map(([k, l]) => `<option value="${k}" ${s.sort === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>`;
const empty = () => `<div class="panel emp"><span class="eic">${ic('discover')}</span><h3>Nothing to watch yet</h3><p>Search for a company above and add it, or save one from Today and it appears here by itself. You do not need to own it.</p><button class="btn" data-act="focus">${ic('search', 's')}Search for a company</button></div>`;
const noMatch = (s) => `<div class="panel emp"><span class="eic">${ic('search')}</span><h3>${s.filter === 'analyzed' ? 'No analyzed companies yet' : 'Every company is analyzed'}</h3><p>${s.filter === 'analyzed' ? 'Run research on a company to see it here.' : 'There is nothing left to analyze in this list.'}</p><button class="btn ghost" data-act="filter" data-v="all">Show all companies</button></div>`;
const skel = () => `<div class="panel" aria-busy="true"><p class="hint" style="margin:0 0 12px">Loading your watchlist…</p>${[1, 2, 3, 4].map(() => '<div class="skel" style="height:64px;margin-bottom:10px"></div>').join('')}</div>`;
const toast = (s) => (s.toast ? `<div class="toast" role="status"><span>${s.toast}</span>${s.undos.length ? '<button data-act="undo">Undo</button>' : ''}</div>` : '');
const dcHead = () => `<div class="dch"><div><h1>Discover</h1><div class="sub">Companies you are monitoring. You do not need to own them.</div></div><div class="upd">Updated today, 14:14<button class="ibtn" data-act="refresh" aria-label="Refresh prices">${ic('refresh', 'xs')}</button></div></div>`;

/* ---- behaviour: each copy of the page keeps its own state ---- */
let uid = 0;
function mountApp(el, init, render) {
  el._s = { id: ++uid, items: WL0.map((x) => ({ ...x })), filter: 'all', sort: 'new', q: '', toast: '', undos: [], loading: false, ...init };
  el._r = render; paintApp(el);
}
function focusKey(f) {
  if (!f || !f.classList) return '';
  if (f.classList.contains('sq')) return '.sq';
  if (f.classList.contains('ssel')) return '.ssel';
  const a = f.dataset && f.dataset.act; if (!a) return '';
  return `[data-act="${a}"]${f.dataset.t ? `[data-t="${f.dataset.t}"]` : ''}${f.dataset.v ? `[data-v="${f.dataset.v}"]` : ''}`;
}
function paintApp(el) {
  const f = document.activeElement, mine = f && el.contains(f), key = mine ? focusKey(f) : '', pos = mine && key === '.sq' ? f.selectionStart : 0;
  el.innerHTML = el._r(el._s);
  if (key) { const n = el.querySelector(key); if (n) { n.focus(); if (key === '.sq') n.setSelectionRange(pos, pos); } }
}
document.addEventListener('input', (e) => { if (e.target.classList.contains('sq')) { const r = e.target.closest('.dcx'); r._s.q = e.target.value; r._s.toast = ''; paintApp(r); } });
document.addEventListener('keydown', (e) => {
  if (!e.target.classList || !e.target.classList.contains('sq')) return;
  const r = e.target.closest('.dcx');
  if (e.key === 'Escape') { r._s.q = ''; paintApp(r); }
  if (e.key === 'Enter') { e.preventDefault(); const b = r.querySelector('.sres [data-act="add"]'); if (b) b.click(); }
});
document.addEventListener('change', (e) => { if (e.target.classList.contains('ssel')) { const r = e.target.closest('.dcx'); r._s.sort = e.target.value; paintApp(r); } });
document.addEventListener('click', (e) => {
  const r = e.target.closest('.dcx'); if (!r) return;
  const a = e.target.closest('[data-act]'); if (!a) return; const s = r._s, t = a.dataset.t;
  if (a.dataset.act === 'filter') s.filter = a.dataset.v;
  else if (a.dataset.act === 'sort') s.sort = s.sort === a.dataset.v ? (a.dataset.v === 'name' ? 'new' : s.sort) : a.dataset.v;
  else if (a.dataset.act === 'add') { if (!has(s, t)) { s.items.push({ t, age: 0, src: 'Added by you', status: 'none' }); s.toast = `Added ${co(t).n}. Name, exchange and currency were filled in.`; } s.q = ''; s.sort = 'new'; s.filter = 'all'; }
  else if (a.dataset.act === 'addtop') { const first = results(s).find((d) => !has(s, d.t)); if (first && s.q.trim()) { s.items.push({ t: first.t, age: 0, src: 'Added by you', status: 'none' }); s.toast = `Added ${first.n}. Name, exchange and currency were filled in.`; s.q = ''; s.sort = 'new'; s.filter = 'all'; } else { const i = r.querySelector('.sq'); if (i) i.focus(); return; } }
  else if (a.dataset.act === 'remove') { s.undos.push(s.items.find((x) => x.t === t)); s.items = s.items.filter((x) => x.t !== t); s.toast = `Removed ${co(t).n} from Discover. It only leaves this list.`; }
  else if (a.dataset.act === 'undo') { const u = s.undos.pop(); if (u && !has(s, u.t)) s.items.push(u); s.filter = 'all'; s.toast = s.undos.length ? `Restored ${co(u.t).n}.` : ''; }
  else if (a.dataset.act === 'refresh') s.toast = 'Prices are up to date as of 14:14.';
  else if (a.dataset.act === 'run') { const it = s.items.find((x) => x.t === t); it.status = 'running'; setTimeout(() => { it.status = 'analyzed'; it.insight = 'New research is ready. Open the report for the full case.'; paintApp(r); }, 1400); }
  else if (a.dataset.act === 'focus') { const i = r.querySelector('.sq'); if (i) i.focus(); return; }
  paintApp(r);
});

/* ---- shells and the states shown on the page ---- */
const DNAV = [['today', 'Today', 'today'], ['discover', 'Discover', 'discover'], ['portfolio', 'Portfolio', 'portfolio'], ['cal', 'Plan', 'cal', 'sub'], ['chat', 'Chat', 'chat'], ['track', 'Track record', 'track'], ['back', 'Backtests', 'back'], ['pref', 'Preferences', 'pref'], ['acct', 'Account', 'acct']];
const dcNav = () => DNAV.map(([k, l, i, b]) => `<div class="nav ${b === 'sub' ? 'sub' : ''} ${k === 'discover' ? 'on' : ''}">${ic(i)}${l}</div>`).join('');
const dcFrame = () => `<div class="frame"><aside class="side"><div class="brand"><i>${ic('today')}</i>trade-agent</div>${dcNav()}</aside><main class="main co dcx"></main></div>`;
const dcPhone = () => `<div class="phone"><div class="scr co dcx"></div><div class="tabbar">${[['today', 'Today'], ['discover', 'Discover', 1], ['portfolio', 'Portfolio'], ['chat', 'Chat'], ['more', 'More']].map(([k, l, on]) => `<div class="${on ? 'on' : ''}">${ic(k)}${l}</div>`).join('')}</div></div>`;
const STATES = [
  ['found', 'Watchlist', {}],
  ['empty', 'Empty watchlist', { items: [] }],
  ['dup', 'Search with a company already added', { q: 'hal' }],
  ['noresult', 'Search with no result', { q: 'zzz' }],
  ['nomatch', 'No company matches the filter', { filter: 'analyzed', items: WL0.filter((x) => x.status !== 'analyzed').map((x) => ({ ...x })) }],
  ['loading', 'Loading', { loading: true }],
  ['running', 'Research running on one company', { items: WL0.map((x) => (x.t === 'NVKC' ? { ...x, status: 'running' } : { ...x })) }],
  ['undo', 'Removed, with Undo', { items: WL0.filter((x) => x.t !== 'PLMN').map((x) => ({ ...x })), toast: 'Removed Pellman Stores from Discover. It only leaves this list.', undos: [{ ...WL0[4] }] }],
];
const pick = (ks) => ks.map((k) => STATES.find((s) => s[0] === k));
function mountDC(render) {
  const PH = pick(['found', 'empty', 'dup', 'nomatch', 'loading']), SG = STATES.slice(1);
  document.getElementById('desk').innerHTML = dcFrame(); mountApp(document.querySelector('#desk .dcx'), { q: new URLSearchParams(location.search).get('q') || '' }, render);
  document.getElementById('phones').innerHTML = PH.map(([k, l]) => `<div><div class="cap">${l}</div>${dcPhone()}</div>`).join('');
  document.querySelectorAll('#phones .dcx').forEach((el, i) => mountApp(el, PH[i][2], render));
  document.getElementById('states').innerHTML = SG.map(([k, l]) => `<div class="region"><div class="cap">${l}</div><div class="co dcx"></div></div>`).join('');
  document.querySelectorAll('#states .dcx').forEach((el, i) => mountApp(el, SG[i][2], render));
}
window.addEventListener('load', () => { document.body.dataset.h = document.documentElement.scrollHeight; });

/* placeholder links do not scroll the page */
document.addEventListener('click', (e) => { const a = e.target.closest && e.target.closest('.dcx a[href="#"]'); if (a) e.preventDefault(); });
