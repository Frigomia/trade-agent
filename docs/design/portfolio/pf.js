/* Portfolio: shared sample data and section builders. Needs ../today-discovery/lib.js first (icons, meter, logo, chg).
   Fictional holdings, fictional numbers: sample data, not a claim about any real firm. All amounts are EUR.
   Field names follow HoldingSummary where they exist (shares, sector, market_value, unrealized_pl, weight). */
Object.assign(I, {
  dots: '<circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13 7l4 4"/>',
  trash: '<path d="M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  log: '<path d="M4 7h16M4 12h16M4 17h10"/>',
  chevd: '<path d="M6 9l6 6 6-6"/>',
});
const HOLD = [
  { t: 'HLDN', n: 'Halden Systems', sh: 30, v: 5312.4, cost: 4610.0, sec: 'Technology', ctry: 'United States', cur: 'USD', chg: 2.1 },
  { t: 'TNKP', n: 'Tanaka Precision', sh: 40, v: 3015.2, cost: 2650.0, sec: 'Industrials', ctry: 'Japan', cur: 'JPY', chg: 1.8 },
  { t: 'AURL', n: 'Aurelle Foods', sh: 60, v: 2845.7, cost: 3100.0, sec: 'Consumer Staples', ctry: 'France', cur: 'EUR', chg: -0.4 },
  { t: 'NVKC', n: 'Norvik Cloud', sh: 12, v: 2310.0, cost: null, sec: 'Technology', ctry: 'United States', cur: 'USD', chg: 1.2 },
  { t: 'BRVK', n: 'Brevik Medical', sh: 55, v: 2068.5, cost: 2240.0, sec: 'Health Care', ctry: 'Sweden', cur: 'SEK', chg: -0.8 },
  { t: 'MRLW', n: 'Marlow Water', sh: 120, v: 1742.9, cost: 1690.0, sec: 'Utilities', ctry: 'United Kingdom', cur: 'GBP', chg: 0.3 },
  { t: 'CSTR', n: 'Castor Logistics', sh: 25, v: 1615.3, cost: 1440.0, sec: 'Industrials', ctry: 'Germany', cur: 'EUR', chg: 0.5 },
];
const eur = (n, d = 2) => '€' + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
const sg = (n, d = 2) => (n >= 0 ? '+' : '−') + eur(n, d);
const pc = (n, d = 1) => (n >= 0 ? '+' : '−') + Math.abs(n).toFixed(d) + '%';
function totals(list = HOLD) {
  const total = list.reduce((a, h) => a + h.v, 0), known = list.filter((h) => h.cost != null);
  const cost = known.reduce((a, h) => a + h.cost, 0), val = known.reduce((a, h) => a + h.v, 0);
  const dayEur = list.reduce((a, h) => a + (h.v - h.v / (1 + h.chg / 100)), 0);
  return { total, gain: val - cost, gainPct: cost ? ((val - cost) / cost) * 100 : null, nCost: known.length, nAll: list.length, dayEur, dayPct: (dayEur / (total - dayEur)) * 100 };
}
const W = (h) => (h.v / totals().total) * 100;
function groups(dim) {
  const key = { sec: 'sec', ctry: 'ctry', cur: 'cur' }[dim], m = {};
  HOLD.forEach((h) => { m[h[key]] = (m[h[key]] || 0) + h.v; });
  const T = totals().total;
  return Object.entries(m).sort((a, b) => b[1] - a[1]).map(([name, v]) => ({ name, v, pct: (v / T) * 100 }));
}
const risk = {
  vol: 17.4,
  eff: 1 / HOLD.reduce((a, h) => a + Math.pow(h.v / totals().total, 2), 0),
};
const CORR = [[1, .41, .22, .78, .18, .12, .35], [.41, 1, .19, .38, .15, .21, .52], [.22, .19, 1, .2, .31, .44, .27], [.78, .38, .2, 1, .16, .1, .3], [.18, .15, .31, .16, 1, .29, .14], [.12, .21, .44, .1, .29, 1, .2], [.35, .52, .27, .3, .14, .2, 1]];

const offDiag = CORR.flatMap((r, i) => r.map((c, j) => (i < j ? [c, i, j] : null)).filter(Boolean));
risk.corr = offDiag.reduce((a, x) => a + x[0], 0) / offDiag.length;
const best = offDiag.reduce((a, x) => (x[0] > a[0] ? x : a));
risk.pair = [HOLD[best[1]].t, HOLD[best[2]].t, best[0]];
risk.dd = (() => { let pk = 0, mdd = 0; series().forEach((v) => { pk = Math.max(pk, v); mdd = Math.min(mdd, v / pk - 1); }); return mdd * 100; })();

/* ---- shell ---- */
const PNAV = [['today', 'Today', 'today'], ['discover', 'Discover', 'discover', 'new'], ['portfolio', 'Portfolio', 'portfolio'], ['cal', 'Plan', 'cal', 'sub'], ['chat', 'Chat', 'chat'], ['track', 'Track record', 'track'], ['back', 'Backtests', 'back'], ['pref', 'Preferences', 'pref'], ['acct', 'Account', 'acct']];
const pfNav = () => PNAV.map(([k, l, i, b]) => `<div class="nav ${b === 'sub' ? 'sub' : ''} ${k === 'portfolio' ? 'on' : ''}">${ic(i)}${l}${b === 'new' ? '<em>new</em>' : ''}</div>`).join('');
const pfDesktop = (inner) => `<div class="frame"><aside class="side"><div class="brand"><i>${ic('today')}</i>trade-agent</div>${pfNav()}</aside><main class="main co pfx">${inner}</main></div>`;
const pfPhone = (inner) => {
  const tabs = [['today', 'Today'], ['portfolio', 'Portfolio', 1], ['chat', 'Chat'], ['more', 'More']];
  return `<div class="phone"><div class="scr co pfx">${inner}</div><div class="tabbar">${tabs.map(([k, l, on]) => `<div class="${on ? 'on' : ''}">${ic(k)}${l}</div>`).join('')}</div></div>`;
};
const pfTop = () => `<div class="pfh"><div><h1>Portfolio</h1><div class="sub">Your holdings, allocation and risk. Updated today, 14:14.</div></div><div class="pfa"><button class="btn ghost">${ic('log', 's')}Log trade</button><button class="btn">${ic('plus', 's')}Add holding</button></div></div>
  <nav class="seg2" aria-label="Portfolio views"><a href="#" aria-current="page">Holdings</a><a href="#">This month</a><a href="#">Saved plans</a><a href="#">Orders</a></nav>`;

/* ---- overview ---- */
const ovStats = (state) => {
  const T = totals(), nocost = state === 'nocost';
  const gain = nocost ? `<div class="stat"><small>Total gain or loss</small><b class="nb">Not available</b><em>Add purchase prices to see it. Edit a holding to add one.</em></div>`
    : `<div class="stat"><small>Total gain or loss</small><b class="num ${T.gain >= 0 ? 'up' : 'down'}">${sg(T.gain)}</b><em><span class="chg ${T.gain >= 0 ? 'up' : 'down'}">${pc(T.gainPct)}${ic(T.gain >= 0 ? 'up' : 'down', 'xs')}</span>${T.nCost < T.nAll ? ` · ${T.nAll - T.nCost} holding without a purchase price is left out` : ''}</em></div>`;
  return [`<div class="stat main-stat"><small>Total value</small><b class="num big">${eur(T.total)}</b><em>${T.nAll} holdings · EUR</em></div>`, gain,
    `<div class="stat"><small>Today</small><b class="num ${T.dayEur >= 0 ? 'up' : 'down'}">${sg(T.dayEur)}</b><em><span class="chg ${T.dayEur >= 0 ? 'up' : 'down'}">${pc(T.dayPct)}${ic(T.dayEur >= 0 ? 'up' : 'down', 'xs')}</span> since the last close</em></div>`];
};
const RANGES2 = ['1M', '6M', '1Y', 'All'];
const chartBlock = (state, h = 200) => {
  if (state === 'short') return `<div class="chartna" style="height:${h}px"><b>The chart needs a little more history</b><p>It appears once there are at least 7 days of saved values. You have 3 so far.</p></div>`;
  if (state === 'loading') return `<div class="skel" style="height:${h}px"></div>`;
  return `<div class="chart" data-h="${h}" role="img" aria-label="Portfolio value over the past year, rising from about 15,400 to 18,910 euro"></div>`;
};
const rangeTabs = () => `<span class="rng" role="tablist" aria-label="Chart range">${RANGES2.map((r) => `<button role="tab" aria-selected="${r === '1Y'}" class="${r === '1Y' ? 'on' : ''}">${r}</button>`).join('')}</span>`;
const secH = (t, extra = '') => `<div class="sh"><h2>${t}</h2>${extra}</div>`;

/* ---- holdings ---- */
const bar = (p) => `<i class="wbar"><b style="width:${Math.min(100, p * 2.4)}%"></b></i>`;
const gainCell = (h, nocost) => (h.cost == null || nocost)
  ? `<button class="addp" aria-label="Add the purchase price of ${h.t}">Add purchase price</button>`
  : `<span class="${h.v >= h.cost ? 'up' : 'down'} num">${sg(h.v - h.cost)}<small>${pc(((h.v - h.cost) / h.cost) * 100)}</small></span>`;
const holdRow = (h, nocost, open) => `<div class="hrow ${open ? 'open' : ''}" role="row" data-hrow data-sec="${h.sec}" data-ctry="${h.ctry}" data-cur="${h.cur}">
  <a href="#" class="hc" role="cell">${logo(h.n, 36)}<span><b>${h.n}</b><small>${h.t} · ${h.sec}</small></span></a>
  <span class="hs num" role="cell"><span class="vh">Shares </span>${h.sh}</span><span class="hv num" role="cell"><span class="vh">Value </span><b>${eur(h.v)}</b><small class="dd">${chg(h.chg)}</small></span>
  <span class="hg" role="cell"><span class="vh">Gain or loss </span>${gainCell(h, nocost)}</span><span class="hw num" role="cell"><span class="vh">Weight </span>${bar(W(h))}<b>${W(h).toFixed(1)}%</b></span>
  <button class="kb" aria-label="Actions for ${h.t}" aria-haspopup="menu" aria-expanded="${!!open}">${ic('dots')}</button>
  <div class="mn" role="menu" ${open ? '' : 'hidden'}><button role="menuitem">${ic('edit', 'xs')}Edit holding</button><button role="menuitem">${ic('log', 'xs')}Log a trade</button><button role="menuitem">${ic('trash', 'xs')}Remove holding</button></div></div>`;
const holdTable = (state = 'found', openIdx = -1) => `<div class="htable hlist" role="table" aria-label="Your holdings"><div class="hhead" role="row"><span role="columnheader">Company</span><span role="columnheader">Shares</span><span role="columnheader">Value</span><span role="columnheader">Gain or loss</span><span role="columnheader">Weight</span><span role="columnheader"><span class="vh">Actions</span></span></div>${HOLD.map((h, i) => holdRow(h, state === 'nocost', i === openIdx)).join('')}</div>`;

/* ---- allocation donut (interactive: the tabs switch the grouping) ---- */
const DIMS = [['sec', 'Sector'], ['ctry', 'Country'], ['cur', 'Currency']];
function donutBody(dim, size = 180, act = false) {
  const g = groups(dim), r = size / 2 - 14, C = 2 * Math.PI * r; let off = 0;
  const arcs = g.map((x, i) => { const len = (x.pct / 100) * C, a = `<circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="var(--c${(i % 6) + 1})" stroke-width="22" stroke-dasharray="${Math.max(0, len - 2).toFixed(2)} ${(C - Math.max(0, len - 2)).toFixed(2)}" stroke-dashoffset="${(-off).toFixed(2)}" transform="rotate(-90 ${size / 2} ${size / 2})" data-i="${i}"><title>${x.name} ${x.pct.toFixed(1)}%</title></circle>`; off += len; return a; }).join('');
  return `<div class="dn"><svg class="dsv" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" role="img" aria-label="Allocation by ${DIMS.find((d) => d[0] === dim)[1].toLowerCase()}: ${g.map((x) => x.name + ' ' + x.pct.toFixed(1) + '%').join(', ')}"><circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="var(--track)" stroke-width="22"/>${arcs}<text x="50%" y="46%" text-anchor="middle" class="dt1">${eur(totals().total, 0)}</text><text x="50%" y="60%" text-anchor="middle" class="dt2">Total</text></svg>
  <ol class="lg">${g.map((x, i) => `<li data-key="${x.name}" data-i="${i}" ${act ? 'tabindex="0" role="button" aria-pressed="false"' : ''}><i style="background:var(--c${(i % 6) + 1})"></i><span>${x.name}</span><b class="num">${x.pct.toFixed(1)}%</b><small class="num">${eur(x.v, 0)}</small></li>`).join('')}</ol></div>`;
}
const donutBox = (size = 180, dim = 'sec', extraCls = '') => `<div class="dbox ${extraCls}" data-act="${extraCls === 'filter'}" data-size="${size}" data-dim="${dim}"><div class="seg3" role="tablist" aria-label="Group allocation by">${DIMS.map(([k, l]) => `<button role="tab" data-dim="${k}" aria-selected="${k === dim}" class="${k === dim ? 'on' : ''}">${l}</button>`).join('')}</div><div class="dbody">${donutBody(dim, size, extraCls === 'filter')}</div></div>`;
document.addEventListener('click', (e) => {
  const t = e.target.closest('.seg3 [data-dim]');
  if (t) {
    const box = t.closest('.dbox'); box.dataset.dim = t.dataset.dim; box.dataset.sel = '';
    box.querySelectorAll('.seg3 button').forEach((b) => { const on = b === t; b.classList.toggle('on', on); b.setAttribute('aria-selected', on); });
    box.querySelector('.dbody').innerHTML = donutBody(t.dataset.dim, +box.dataset.size, box.dataset.act === 'true'); applyFilter(box);
    return;
  }
  const li = e.target.closest('.dbox.filter .lg li');
  if (li) { const box = li.closest('.dbox'); box.dataset.sel = box.dataset.sel === li.dataset.key ? '' : li.dataset.key; applyFilter(box); }
});
function applyFilter(box) {
  const scope = box.closest('.pfx') || document, sel = box.dataset.sel || '', dim = box.dataset.dim, list = scope.querySelector('.hlist');
  box.querySelectorAll('.lg li').forEach((l) => { l.classList.toggle('sel', l.dataset.key === sel); if (l.hasAttribute('aria-pressed')) l.setAttribute('aria-pressed', l.dataset.key === sel); });
  if (!list || !box.classList.contains('filter')) return;
  list.querySelectorAll('[data-hrow]').forEach((r) => { r.style.display = !sel || r.dataset[dim] === sel ? '' : 'none'; });
  const c = scope.querySelector('.fnote'); if (c) c.innerHTML = sel ? `Showing holdings in ${sel}. <button class="lk fclr">Show all</button>` : '';
}
document.addEventListener('click', (e) => { if (e.target.classList && e.target.classList.contains('fclr')) { const box = e.target.closest('.pfx').querySelector('.dbox.filter'); box.dataset.sel = ''; applyFilter(box); } });
const topPos = () => `<ol class="tp">${HOLD.slice(0, 5).map((h) => `<li>${logo(h.n, 28)}<span>${h.t}</span><i class="wbar"><b style="width:${W(h) * 3}%"></b></i><b class="num">${W(h).toFixed(1)}%</b></li>`).join('')}</ol>`;

/* ---- risk and analytics: facts, no score ---- */
const top3 = () => HOLD.slice(0, 3).reduce((a, h) => a + W(h), 0);
const metric = (l, v, d) => `<div class="mt2"><small>${l}</small><b class="num">${v}</b><em>${d}</em></div>`;
const riskEss = () => `<div class="mts">${metric('Volatility', risk.vol + '%', 'a year, from one year of daily changes')}${metric('Largest position', W(HOLD[0]).toFixed(1) + '%', HOLD[0].n)}${metric('Top three together', top3().toFixed(1) + '%', HOLD.slice(0, 3).map((h) => h.t).join(', '))}${metric('Effective holdings', risk.eff.toFixed(1), 'as if spread equally over this many')}${metric('Average correlation', risk.corr.toFixed(2), `highest pair ${risk.pair[0]} and ${risk.pair[1]}, ${risk.pair[2].toFixed(2)}`)}${metric('Biggest fall, last year', pc(risk.dd), 'from peak to low of the portfolio')}</div>`;
const heat = () => `<div class="heatw"><table class="heat" aria-label="Correlation between holdings"><thead><tr><th></th>${HOLD.map((h) => `<th scope="col">${h.t}</th>`).join('')}</tr></thead><tbody>${HOLD.map((h, i) => `<tr><th scope="row">${h.t}</th>${CORR[i].map((c, j) => `<td class="${i === j ? 'dg' : ''}" style="--a:${c}"><span>${c.toFixed(2)}</span></td>`).join('')}</tr>`).join('')}</tbody></table></div><p class="adv">1.00 means two holdings moved together every day; 0 means no link. Darker is higher. Based on one year of daily changes.</p>`;
const riskAdv = (open = false) => `<details class="adv2" ${open ? 'open' : ''}><summary>${ic('chevd', 'xs')}Advanced analytics</summary><div class="advb"><div><h3 class="sub3">Correlation between holdings</h3>${heat()}</div><div><h3 class="sub3">Spread</h3><dl class="ff"><div><dt>Sectors</dt><dd class="num">${groups('sec').length}</dd></div><div><dt>Countries</dt><dd class="num">${groups('ctry').length}</dd></div><div><dt>Currencies</dt><dd class="num">${groups('cur').length}</dd></div><div><dt>Largest sector</dt><dd class="num">${groups('sec')[0].name}, ${groups('sec')[0].pct.toFixed(1)}%</dd></div></dl><p class="adv">These are facts about the portfolio, not a rating. There is no overall health score.</p></div></div></details>`;

/* ---- states ---- */
const emptyBlock = () => `<div class="panel emp"><span class="eic">${ic('portfolio')}</span><h3>No holdings yet</h3><p>Add what you own to see its value, allocation and risk. You can add purchase prices now or later; without them the gain or loss is simply not shown.</p><div class="empa"><button class="btn">${ic('plus', 's')}Add your first holding</button><button class="btn ghost">${ic('log', 's')}Log a trade</button></div><p class="adv">Nothing is sent to a broker. Adding a holding only records it here.</p></div>`;
const confirmBlock = () => `<div class="panel emp"><h3>Remove HLDN?</h3><p>This removes Halden Systems from your portfolio, with its shares and purchase details. It does not sell anything.</p><div class="empa"><button class="btn">Remove holding</button><button class="btn ghost">Keep it</button></div></div>`;

/* ---- charts drawn at the real pixel width ---- */
function series() { let s = 11, p = 15400; const o = []; const rnd = () => ((s = (s * 9301 + 49297) % 233280) / 233280 - 0.5); for (let i = 0; i < 250; i++) { const t = i / 249; p *= 1 + (t < 0.5 ? 0.0009 : t < 0.65 ? -0.0014 : 0.0012) + rnd() * 0.007; o.push(p); } const k = 18910 / o[o.length - 1]; return o.map((v) => v * k); }
let gid = 0;
function drawCharts() {
  document.querySelectorAll('.chart').forEach((el) => {
    const w = el.clientWidth || 300, h = +el.dataset.h, S = series(), mn = Math.min(...S) - 300, mx = Math.max(...S) + 300, L = 44, B = 22;
    const x = (i) => L + (i / (S.length - 1)) * (w - L - 4), y = (v) => 6 + (1 - (v - mn) / (mx - mn)) * (h - 6 - B);
    const line = S.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('');
    const grid = [0.1, 0.5, 0.9].map((q) => mn + (mx - mn) * q).map((v) => `<line x1="${L}" x2="${w}" y1="${y(v)}" y2="${y(v)}" class="gl"/><text x="${L - 6}" y="${y(v) + 4}" text-anchor="end">${(Math.round(v / 100) / 10).toFixed(1)}k</text>`).join('');
    const months = ['Nov', 'Jan', 'Mar', 'May', 'Jul', 'Sep'].map((m, i) => `<text x="${x((i / 5.4) * 249)}" y="${h - 5}">${m}</text>`).join('');
    el.innerHTML = `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" aria-hidden="true"><defs><linearGradient id="gp${++gid}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="var(--accent)" stop-opacity=".22"/><stop offset="1" stop-color="var(--accent)" stop-opacity="0"/></linearGradient></defs>${grid}<path d="${line}L${x(S.length - 1)},${h - B}L${L},${h - B}Z" fill="url(#gp${gid})"/><path d="${line}" class="ln2"/>${months}<circle cx="${x(S.length - 1)}" cy="${y(S[S.length - 1])}" r="4" class="pt"/></svg>`;
  });
}
window.addEventListener('load', () => { drawCharts(); document.body.dataset.h = document.documentElement.scrollHeight; });
window.addEventListener('resize', drawCharts);

/* ---- states and mounting ---- */
const loadingBody = () => `<div class="panel" aria-busy="true" style="display:grid;gap:14px"><p class="adv" style="margin:0">Loading your portfolio…</p><div class="skel" style="height:34px;width:42%"></div><div class="skel" style="height:150px"></div></div><div class="panel" aria-busy="true" style="display:grid;gap:12px">${[1, 2, 3, 4].map(() => '<div class="skel" style="height:44px"></div>').join('')}</div>`;
function mountPF(compose) {
  const wrap = (s) => {
    if (s === 'empty') return pfTop() + emptyBlock() + adv();
    if (s === 'confirm') return pfTop() + confirmBlock() + adv();
    if (s === 'loading') return pfTop() + loadingBody();
    return compose(s);
  };
  document.getElementById('desk').innerHTML = pfDesktop(wrap('found'));
  document.getElementById('phones').innerHTML = [['found', 'Holdings'], ['empty', 'Empty portfolio'], ['nocost', 'No purchase prices'], ['short', 'Short history'], ['loading', 'Loading']].map(([s, l]) => `<div><div class="cap">${l}</div>${pfPhone(wrap(s))}</div>`).join('');
  document.getElementById('states').innerHTML = [['empty', 'Empty portfolio'], ['nocost', 'No purchase prices: gain or loss not shown'], ['short', 'Short history: chart waits for data'], ['loading', 'Loading'], ['menu', 'Row menu open: edit, log a trade, remove'], ['confirm', 'Confirm removing a holding']].map(([s, l]) => `<div class="region co pfx"><div class="cap">${l}</div>${wrap(s)}</div>`).join('');
}

/* legend rows: hover or focus highlights the slice; Enter or Space selects (the filter in option 3) */
const hiOn = (e) => { const li = e.target.closest && e.target.closest('.lg li'); if (li) li.closest('.dbox').dataset.hi = li.dataset.i; };
const hiOff = (e) => { const li = e.target.closest && e.target.closest('.lg li'); if (li) delete li.closest('.dbox').dataset.hi; };
document.addEventListener('mouseover', hiOn); document.addEventListener('mouseout', hiOff);
document.addEventListener('focusin', hiOn); document.addEventListener('focusout', hiOff);
document.addEventListener('keydown', (e) => { if ((e.key === 'Enter' || e.key === ' ') && e.target.matches && e.target.matches('.lg li')) { e.preventDefault(); e.target.click(); } });

/* range tabs and the row menu */
document.addEventListener('click', (e) => {
  const rb = e.target.closest('.rng button');
  if (rb) { rb.parentElement.querySelectorAll('button').forEach((b) => { const on = b === rb; b.classList.toggle('on', on); b.setAttribute('aria-selected', on); }); return; }
  const kb = e.target.closest('.kb');
  document.querySelectorAll('.hrow.open').forEach((r) => { if (!kb || r !== kb.closest('.hrow')) { r.classList.remove('open'); r.querySelector('.mn').hidden = true; r.querySelector('.kb').setAttribute('aria-expanded', 'false'); } });
  if (kb) { const r = kb.closest('.hrow'), on = !r.classList.contains('open'); r.classList.toggle('open', on); r.querySelector('.mn').hidden = !on; kb.setAttribute('aria-expanded', on); }
});
