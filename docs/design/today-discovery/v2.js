/* v2 shared builders: reference-based Today layout. Pages add their own look through CSS and a few overrides.
   Needs lib.js first. Day change and price are NOT in IdeaOut today (see SPEC.md, gap 4). */
DATA.set_aside = DATA.scan.researched - DATA.scan.opportunities;
DATA.ideas[0].sources = 2; // the two catalysts below
DATA.ideas[0].flags = ['Top three customers are 38% of revenue', 'Shares fell 22% over the past year'];
DATA.ideas[0].catalysts = ['Q3 results on 6 Nov follow two quarters of margin expansion.', 'Contract renewals for the largest customers start in Q1.'];

const head2 = (sub) => `<div class="head2"><div><h1>Today</h1><div class="sub">${sub}</div></div></div>`;
const SUB = 'Your latest research ideas and what needs attention on your holdings.';

function V2Desktop(inner) {
  return `<div class="frame"><aside class="side"><div class="brand"><i>${ic('today')}</i>trade-agent</div>${navItems('today')}</aside>
  <main class="main v2"><div class="topbar"><button class="theme" style="margin-left:auto" aria-label="Toggle theme">${ic('sun')}</button></div>${head2(SUB)}${inner}</main></div>`;
}
function V2Phone(inner) {
  const tabs = [['today', 'Today', 1], ['discover', 'Discover'], ['portfolio', 'Portfolio'], ['chat', 'Chat'], ['more', 'More']];
  return `<div class="phone"><div class="scr v2">${head2(SUB)}${inner}</div>
  <div class="tabbar">${tabs.map(([k, l, on]) => `<div class="${on ? 'on' : ''}">${ic(k)}${l}</div>`).join('')}</div></div>`;
}

const quiet = (h) => h.replace(/role="img" aria-label="[^"]*"/, 'aria-hidden="true"'); // the words follow, so the meter is not read twice
const confW = (c) => `${quiet(meter(c, 'confidence'))}${cap1(c)} confidence`;
const riskW = (r) => `${quiet(meter(r, 'risk'))}${cap1(r)} risk`;
const idChips = (i) => `<span class="chips"><span class="chip">${ic('globe', 'xs')}${i.country}</span><span class="chip">${ic('layers', 'xs')}${i.sector}</span></span>`;
const priceBlock = (i) => `<div class="pr"><span class="num">${i.cur} ${i.price}</span><small>${chg(i.chg)}</small></div>`;
const asOfNote = `<span class="asof">Prices at ${DATA.ideas[0].asOf.replace('close', '')}close</span>`;

const scanbar = (state) => {
  const S = DATA.scan;
  const lead = `<span class="spk">${ic('spark', 's')}</span>`;
  if (state === 'running') return `<div class="panel scanbar">${lead}<span class="tx"><b>Scanning now</b> · researching ${DATA.job.done} of ${DATA.job.total}</span></div>`;
  if (state === 'failed' || state === 'failedKey') return `<div class="panel scanbar">${lead}<span class="tx"><b>Last scan did not finish</b></span><span class="sp"></span><button class="ibtn">${ic('refresh', 'xs')}Try again</button></div>`;
  const n = state === 'none' ? 0 : S.opportunities;
  return `<div class="panel scanbar">${lead}<span class="tx"><b>Latest AI scan</b> · Updated today ${S.when.replace('Today ', '')} · ${n} opportunit${n === 1 ? 'y' : 'ies'}${n ? ` · <span title="Researched, but not recommended">${DATA.set_aside} set aside</span>` : ''}</span><span class="sp"></span>
    <button class="ibtn" aria-label="Refresh scan, ${S.budget.used} of ${S.budget.limit} runs used this month. Costs 1 run.">${ic('refresh', 'xs')}<small>${S.budget.used} of ${S.budget.limit} runs</small></button><button class="ibtn" aria-label="Scan history">${ic('history', 'xs')}</button></div>`;
};

/* AI text lives in the dashed box, apart from computed numbers */
const aiBox = (i, extra = '') => `<div class="webbox"><p class="thesis">${i.thesis || i.why}</p>${i.catalyst ? `<p class="now">${ic('spark', 's')}<span><b>Why now.</b> ${i.catalyst}</span></p>` : ''}${extra}<span class="wl">AI research summary · ${i.sources} cited source${i.sources > 1 ? 's' : ''}</span></div>`;

const oppCard = (i, extra = '') => `<article class="panel card"><div class="hd">${logo(i.name, 40)}<div style="min-width:0"><div class="nm">${i.name}</div><div class="tk">${i.ticker} · ${i.exch}</div></div>${priceBlock(i)}</div>
  <div class="chips"><span class="chip">${confW(i.confidence)}</span><span class="chip">${riskW(i.risk)}</span></div>${idChips(i)}<p class="ln">${i.why}</p>${extra}
  <div class="ft"><a href="#" class="lk">Open research ${ic('arrow', 'xs')}</a><span class="sp"></span><button class="lk m" aria-label="Save ${i.name} to Discover">${ic('bookmark', 'xs')}Save</button></div></article>`;

const alertRows = () => DATA.alerts2.map((a) => `<a href="#" class="rw">${logo(a.name, 34)}<span class="rwm"><b>${a.ticker}</b><small>${a.name}</small><span class="rwt">${a.text}</span></span><span class="pillx ${a.tone}">${a.tone === 'up' ? ic('up', 'xs') : ''}${a.pill}</span>${ic('chev', 'xs')}</a>`).join('');
const watchRows = () => DATA.watchlist.map((w) => `<div class="rw">${logo(w.name, 34)}<span class="rwm"><b>${w.ticker}</b><small>${w.name}</small><span class="rwt">${w.text}</span></span><button class="actx">${w.action}</button></div>`).join('');
const lists = () => `<div class="two"><section class="panel list"><h2 class="st">${ic('bell', 's')}Portfolio alerts</h2>${alertRows()}</section><section class="panel list"><h2 class="st">${ic('eye', 's')}Watchlist insights</h2>${watchRows()}</section></div>`;

const stageBlock = (state) => {
  if (state === 'none') return `<div class="panel state"><span class="big0 num">0</span><h3>No compelling opportunity today</h3><p>No company reached 60 points with medium or better confidence. That is a result, not an error.</p><div class="miss"><span class="chip">Nearest misses</span>${DATA.misses.map((m) => `<span class="chip num">${m.ticker} · ${m.overall}</span>`).join('')}</div></div>`;
  if (state === 'running') { const idx = 2; return `<div class="panel state"><h3 style="margin-top:0">Scanning the market</h3><div class="prog" role="progressbar" aria-valuenow="${DATA.job.done}" aria-valuemax="${DATA.job.total}" aria-label="Scan progress"><i style="width:${Math.round(((idx + DATA.job.done / DATA.job.total) / 5) * 100)}%"></i></div><div class="steps">${DATA.stages.map(([k, l], n) => `<div class="${n < idx ? 'dn' : n === idx ? 'cur' : ''}"><i>${n < idx ? ic('check', 'xs') : ''}</i>${n === idx ? `${l} · ${DATA.job.done} of ${DATA.job.total}` : l}</div>`).join('')}</div><p class="adv" style="margin-top:14px">The scan keeps running if you leave this page.</p></div>`; }
  if (state === 'failed') return `<div class="panel state"><span class="tone">${ic('alert')}</span><h3>The scan did not finish</h3><p>${DATA.errors.generic} Nothing was saved.</p><div style="margin-top:14px"><button class="btn">${ic('refresh', 's')} Try again</button></div></div>`;
  return `<div class="panel state"><span class="tone">${ic('key')}</span><h3>${DATA.errors.key}</h3><p>Claude did not accept your key, so the scan stopped. Nothing was saved.</p><div style="margin-top:14px"><button class="btn">${ic('key', 's')} Reconnect Claude</button></div></div>`;
};

/* each page passes foundBlock(hasFit) and its own tag text */
function mountV2(foundBlock, { extra } = {}) {
  const region = (state) => {
    const found = state === 'found' || state === 'empty';
    return `${scanbar(state)}${found ? foundBlock(state !== 'empty') : stageBlock(state)}${state === 'found' ? lists() : ''}${adv()}`;
  };
  document.getElementById('desk').innerHTML = V2Desktop(region('found'));
  document.getElementById('phones').innerHTML = [['found', 'Ideas found'], ['none', 'No compelling opportunity'], ['running', 'Scan running'], ['failed', 'Scan failed'], ['failedKey', 'Claude key needs attention'], ['empty', 'Empty portfolio (alerts hidden, fit unavailable)']]
    .concat(extra ? [[null, extra[0]]] : []).map(([s, l]) => `<div><div class="cap">${l}</div>${V2Phone(s ? region(s) : extra[1]())}</div>`).join('');
  document.getElementById('states').innerHTML = [['none', 'No compelling opportunity'], ['running', 'Scan running'], ['failed', 'Scan failed'], ['failedKey', 'Claude key needs attention'], ['empty', 'Empty portfolio']]
    .map(([s, l]) => `<div class="region v2"><div class="cap">${l}</div>${region(s)}</div>`).join('');
}

/* the theme button flips light and dark in the browser */
document.addEventListener('click', (e) => {
  if (!e.target.closest('.theme')) return;
  const r = document.documentElement;
  r.dataset.theme = r.dataset.theme === 'dark' ? 'light' : 'dark';
});
