/* Scan results in the Soft direction (the ledger): sample data, renderers and the page assembly. Fictional data; no requests. Needs lib.js (ic, I) and pf.js (PNAV). */
Object.assign(I, {
  chev: '<path d="m9 6 6 6-6 6"/>',
  info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>',
  ext: '<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
});

/* ---- the words for the stored reasons ---- */
const SR_EXCL = {
  thesis_invalidated: 'Thesis no longer holds', unreliable_price: 'Price not reliable', ambiguous_identity: 'Company not clearly identified',
  currency_unsupported: 'Currency not supported', insufficient_data: 'Not enough data',
};
const SR_REJ = {
  ambiguous: 'Name matches several companies', unresolved: 'No listed company found', no_price: 'No price available',
  currency_unsupported: 'Currency not supported', insufficient_data: 'Not enough data', cap_reached: "Over this scan's limit",
  duplicate: 'Already in the scan or your holdings',
};
const SR_ORIGIN = { tavily: 'Web search', reddit: 'Reddit', industry_research: 'Industry research' };

/* ---- fictional data ---- */
const SR_SCAN = { when: 'today 06:12', universe: 600, eligible: 412, shortlisted: 8, researched: 7, opp: 4 };
const SR_SET = [
  { id: 's1', tk: 'ORBF', nm: 'Orbit Freight', kind: 'thesis', why: 'Confirmed development (12 Oct 2026): the regulator ordered a recall of the main product, see https://regulator.example/notices/4471. The thesis relied on that product for most of its expected growth and no replacement is announced. Thesis impact: the growth case no longer holds until a replacement ships.', ev: ['https://regulator.example/notices/4471', 'https://freightwire.example/orbit-recall'] },
  { id: 's2', tk: 'HRBF', nm: 'Harbor Foods', kind: 'bar', overall: 48, conf: 'Medium' },
  { id: 's3', tk: 'LMGD', nm: 'Lumen Grid', kind: 'bar', overall: 41, conf: 'Low' },
];
/* a scan where nothing qualified: all eight researched companies are set aside */
const SR_NONE = [
  ['BRDG', 'Bridgeway Tools', 44, 'Medium'], ['HRBF', 'Harbor Foods', 38, 'Medium'], ['LMGD', 'Lumen Grid', 36, 'Low'], ['CBLP', 'Cobalt Pay', 33, 'Medium'],
  ['DUNS', 'Dune Solar', 31, 'Low'], ['ELMB', 'Elm Street Bank', 29, 'Medium'], ['FJRD', 'Fjord Energy', 27, 'Low'], ['GLDN', 'Golden Rail', 22, 'Low'],
].map(([tk, nm, overall, conf]) => ({ id: tk, tk, nm, kind: 'bar', overall, conf }));
const SR_NOT = [
  { r: 'insufficient_data', n: 24, rows: [
    ['Meridian Index ETF', 'MIDX', 'An ETF needs separate criteria; company fundamentals do not describe it.'],
    ['Polar Dividend ETF', 'PDIV', 'An ETF needs separate criteria; company fundamentals do not describe it.'],
    ['Quill Biotech', 'QLBT', '2 core fundamentals available, at least 3 are needed.'],
  ] },
  { r: 'unreliable_price', n: 4, rows: [['Ember Mining', 'EMBR', 'The price is out of date: last close 9 days ago.']] },
  { r: 'ambiguous_identity', n: 2, rows: [['Arden Group', 'ARDN', 'Name, exchange or asset type is missing or unknown.']] },
  { r: 'currency_unsupported', n: 1, rows: [['Kestrel Textiles', 'KTXL', 'Quote currency TRY cannot be converted.']] },
];
const SR_REJECTED = [
  { id: 'm1', nm: 'Orange', hint: 'ORA', origin: 'tavily', why: 'Named in a sector roundup as a telecom to watch.', url: 'https://news.example/telecom-roundup', r: 'ambiguous' },
  { id: 'm2', nm: 'Nordic Cell AB', hint: '', origin: 'reddit', why: 'Discussed in a thread about battery supply.', url: null, r: 'unresolved' },
  { id: 'm3', nm: 'Kestrel Labs', hint: 'KSTL', origin: 'tavily', why: 'Cited for a new trial result.', url: 'https://trials.example/kestrel', r: 'no_price' },
  { id: 'm4', nm: 'Pine Ridge REIT', hint: 'PINE', origin: 'industry_research', why: 'Listed among regional property names.', url: 'javascript:alert(1)', r: 'cap_reached' },
];
const SR_COV = ['3 companies had no market data this week.', '2 prices are a day or more old.', '1 price could not be confirmed and is shown as it was saved.', '1 candidate could not be evaluated and is not in the counts above.', 'Research mentions were available for this scan.'];

/* ---- small pieces ---- */
let srN = 0;
const srEsc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
const srHost = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch (e) { return u; } };
const srSafe = (u) => { try { return ['http:', 'https:'].includes(new URL(u).protocol); } catch (e) { return false; } };
const srLink = (u) => (!u ? '' : srSafe(u) ? `<a href="#" title="${srEsc(u)}">${srEsc(srHost(u))}${ic('ext', 'xs')}</a>` : `<span title="Not a web link, so shown as text">${srEsc(u)}</span>`);
const srErr = (t) => `<div class="errbox" role="alert">${ic('alert', 's')}<span>${t}</span></div>`;
const srNote = (t) => `<div class="srnote" role="note">${ic('info', 's')}<span>${t}</span></div>`;
const srChip = (thesis, text) => `<span class="chip ${thesis ? 'warn' : 'none'}">${thesis ? ic('alert', 'xs') : ''}${text}</span>`;
const srWeb = (text, note) => `<div class="webbox"><span>${srEsc(text)}</span><span class="wl">${note}</span></div>`;

/* ---- rows: one shape for the three kinds of leftover ---- */
const srSetRow = (x) => ({
  g: 'set', nm: x.nm, tk: x.tk, stage: 'Set aside after research', dot: 'a',
  chip: srChip(x.kind === 'thesis', x.kind === 'thesis' ? SR_EXCL.thesis_invalidated : 'Below the bar'),
  detail: x.kind === 'thesis'
    ? `${srWeb(x.why, 'Written by the scan from the sources below. Check them before relying on it.')}<div class="ev" role="group" aria-label="Evidence for ${srEsc(x.nm)}">${x.ev.map(srLink).join('')}</div>`
    : `<p class="meta1">Score ${x.overall} · ${x.conf} confidence. Researched, but it did not reach the score and confidence bar.</p>`,
});
const srNotRows = (groups) => groups.flatMap((g) => g.rows.map(([nm, tk, why]) => ({ g: 'not', nm, tk, stage: 'Not researched', dot: '', chip: srChip(false, SR_EXCL[g.r]), detail: `<p class="meta1">${srEsc(why)}</p>` })));
const srMenRow = (x) => ({
  g: 'men', nm: x.nm, tk: x.hint, stage: `Mention · ${SR_ORIGIN[x.origin]}`, dot: 'b', chip: srChip(false, SR_REJ[x.r]),
  detail: `${srWeb(x.why, `From ${SR_ORIGIN[x.origin].toLowerCase()}, not checked by us.`)}${x.url ? `<div class="ev">${srLink(x.url)}</div>` : ''}`,
});
const srRow = (x, open) => `<div class="row1${open ? ' open' : ''}" data-g="${x.g}"><button class="lr" aria-expanded="${!!open}"><span class="who"><span>${srEsc(x.nm)}</span>${x.tk ? `<span class="tk">${srEsc(x.tk)}</span>` : ''}</span><span class="stg"><span class="stdot ${x.dot}"></span>${x.stage}</span><span class="why">${x.chip}</span><span class="chv">${ic('chev', 's')}</span></button><div class="dt">${x.detail}</div></div>`;

/* ---- the page ---- */
const srFlt = (n, cur = 'all') => {
  const lab = { all: 'All', set: 'Set aside', not: 'Not researched', men: 'Mentions' };
  return `<div class="flt" role="group" aria-label="Filter the list">${Object.keys(lab).map((k) => `<button class="${k === cur ? 'on' : ''}" aria-pressed="${k === cur}">${lab[k]}<i>${n[k]}</i></button>`).join('')}</div>`;
};
const srCnt = ({ legacy = false, set = SR_SET.length, opp = SR_SCAN.opp, res = SR_SCAN.researched } = {}) => `<div class="cnt" aria-label="Counts"><span><b>${SR_SCAN.universe}</b>in the universe</span><span><b>${SR_SCAN.eligible}</b>eligible</span><span><b>${SR_SCAN.shortlisted}</b>shortlisted</span><span><b>${res}</b>researched</span><span class="hi"><b>${legacy ? '—' : opp}</b>opportunities</span><span><b>${legacy ? '—' : set}</b>set aside</span></div>
  <p class="fnote">Companies that failed a safeguard are in the list as Not researched. Holdings and sectors you avoid are left out by choice, and eligible companies ranked below the shortlist were not researched. "Set aside" means researched but not recommended; nothing here is a recommendation to sell or avoid.</p>`;
const srHead = (sub) => `<a class="back1" href="#">${ic('arrow', 's')}Today</a><div class="hd"><h1>Scan results</h1><p class="sub">${sub}</p></div>`;
const srSub = `Latest AI scan · Updated ${SR_SCAN.when}. What was looked at and what was left out.`;
const srLedger = ({ rows, phone = false, openFirst = true, more = 0, empty = 'Nothing was left out by this scan.' }) => `<section class="panel led" aria-label="Everything the scan left out">${phone || !rows.length ? '' : '<div class="lh" aria-hidden="true"><span>Company</span><span>Where it fell out</span><span>Why</span><span></span></div>'}${rows.length ? rows.map((x, i) => srRow(x, openFirst && i === 0)).join('') : `<p class="emp">${ic('check', 's')}${empty}</p>`}${more ? `<div class="more1"><button type="button" class="lnk">Show ${more} more</button></div>` : ''}</section>`;
const srCov = (notes = SR_COV) => `<section class="panel cvp" aria-labelledby="h-cov-${++srN}"><h3 id="h-cov-${srN}">Coverage notes</h3>${notes.length ? `<ul class="cov">${notes.map((t) => `<li>${ic('info', 's')}${srEsc(t)}</li>`).join('')}</ul>` : `<p class="emp" style="padding:0">${ic('check', 's')}Nothing to report.</p>`}</section>`;

const SR_ROWS = [...SR_SET.map(srSetRow), ...srNotRows(SR_NOT), ...SR_REJECTED.slice(0, 3).map(srMenRow), srMenRow({ ...SR_REJECTED[3], url: 'https://reits.example/pine-ridge' })];
const SR_N = { all: SR_SET.length + 31 + SR_REJECTED.length, set: SR_SET.length, not: 31, men: SR_REJECTED.length };
const srPage = (phone) => `<div class="sr">${srHead(srSub)}${srCnt()}${srFlt(SR_N)}${srLedger({ rows: SR_ROWS, phone, more: SR_N.all - SR_ROWS.length })}${srCov()}</div>`;

/* ---- the way in: the scan bar and the no-opportunity panel ---- */
const srBar = () => `<div class="panel sbar"><span class="ld" aria-hidden="true">${ic('spark', 's')}</span><span class="tx" role="status"><b>Latest AI scan</b> · Updated ${SR_SCAN.when} · ${SR_SCAN.opp} opportunities · ${SR_SET.length} set aside</span><a class="lnk" href="#">Scan results${ic('chev', 'xs')}</a></div>`;
const srNoOpp = () => {
  const id = `nm-${++srN}`;
  return `<div class="panel noopp"><h2>No compelling opportunity today</h2><p class="body1">No company reached the score and confidence bar. That is a result, not an error.</p><div class="miss"><span class="chip none" id="${id}">Nearest misses</span><ul aria-labelledby="${id}">${SR_NONE.slice(0, 3).map((x) => `<li class="chip none"><b>${x.nm}</b> ${x.tk} · ${x.overall} · ${x.conf} confidence</li>`).join('')}</ul></div><a class="lnk" href="#">Scan results${ic('chev', 'xs')}</a></div>`;
};

/* ---- the frame ---- */
const srNav = () => PNAV.map(([k, l, i, b]) => `<div class="nav ${b === 'sub' ? 'sub' : ''} ${k === 'today' ? 'on' : ''}">${ic(i)}${l}${b === 'new' ? '<em>new</em>' : ''}</div>`).join('');
const srDesk = (inner) => `<div class="frame"><aside class="side"><div class="brand"><i>${ic('today')}</i>trade-agent</div>${srNav()}</aside><main class="main co pfx">${inner}</main></div>`;
const srPhone = (inner) => {
  const tabs = [['today', 'Today', 1], ['discover', 'Discover'], ['portfolio', 'Portfolio'], ['chat', 'Chat'], ['more', 'More']];
  return `<div class="phone"><div class="scr co pfx">${inner}</div><div class="tabbar">${tabs.map(([k, l, on]) => `<div class="${on ? 'on' : ''}">${ic(k)}${l}</div>`).join('')}</div></div>`;
};
const srCap = (t) => `<div class="cap">${t}</div>`;
const srState = (t, html) => `<div class="region co pfx">${srCap(t)}${html}</div>`;

document.getElementById('d-entry').innerHTML = `<div class="grid2" style="width:1280px"><div>${srCap('Today: the scan bar')}${srBar()}</div><div>${srCap('Today: no opportunity')}${srNoOpp()}</div></div>`;
document.getElementById('d-page').innerHTML = srDesk(srPage(false));
document.getElementById('phones').innerHTML = [
  ['Scan results', srPhone(srPage(true))],
  ['The Mentions filter', srPhone(`<div class="sr">${srHead('Latest AI scan · Updated today 06:12.')}${srFlt(SR_N, 'men')}${srLedger({ rows: SR_REJECTED.slice(0, 3).map(srMenRow), phone: true })}</div>`)],
  ['The way in', srPhone(`<div class="sr" style="min-height:0">${srBar()}${srNoOpp()}</div>`)],
].map(([l, h]) => `<div>${srCap(l)}${h}</div>`).join('');

const srNoneN = { all: 8 + 31 + SR_REJECTED.length, set: 8, not: 31, men: SR_REJECTED.length };
document.getElementById('states').innerHTML = [
  ['No scan yet', `<div class="sr">${srHead('No scan has run yet.')}<div class="panel empty3"><span class="ic">${ic('spark')}</span><h2>Nothing to show yet</h2><p>Run a scan from Today. When it finishes, what it set aside and why will be listed here.</p><a class="btn" href="#">Go to Today</a></div></div>`],
  ['Nothing set aside (filter: Set aside)', `<div class="sr">${srHead('Latest AI scan · Updated today 06:12.')}${srCnt({ set: 0, opp: 7 })}${srFlt({ all: 31 + 4, set: 0, not: 31, men: 4 }, 'set')}${srLedger({ rows: [], empty: 'Nothing was set aside. Every researched company was put forward.' })}</div>`],
  ['A scan with no opportunity (filter: Set aside)', `<div class="sr">${srHead('Latest AI scan · Updated today 06:12.')}${srCnt({ set: 8, opp: 0, res: 8 })}${srFlt(srNoneN, 'set')}${srLedger({ rows: SR_NONE.map(srSetRow), openFirst: false })}</div>`],
  ['The below-the-bar companies not saved', `<div class="sr">${srHead('Latest AI scan · Updated today 06:12.')}${srCnt()}${srFlt({ all: 1 + 31 + 4, set: SR_SET.length, not: 31, men: 4 }, 'set')}${srLedger({ rows: SR_SET.slice(0, 1).map(srSetRow) })}${srNote('2 researched companies below the bar were not kept, so they cannot be listed. The count above still includes them.')}</div>`],
  ['An older scan, saved before the counts', `<div class="sr">${srHead('Latest AI scan · Updated 14 Oct, 06:12.')}${srCnt({ legacy: true })}${srNote('This scan was saved before its counts were kept, so the totals are missing. The list below is what it saved.')}${srFlt({ all: 1, set: 0, not: 1, men: 0 }, 'all')}${srLedger({ rows: srNotRows([SR_NOT[3]]), openFirst: false })}</div>`],
  ['A link that is not safe', `<div class="sr">${srLedger({ rows: [srMenRow(SR_REJECTED[3])] })}</div>`],
  ['A list with nothing in it', `<div class="sr">${srLedger({ rows: [] })}${srCov([])}</div>`],
  ['Could not load', `<div class="sr">${srHead('Latest AI scan')}${srErr('Could not load the scan results.')}</div>`],
].map(([l, h]) => srState(l, h)).join('');

/* interaction: a row opens, a filter hides the other kinds */
document.querySelectorAll('.lr').forEach((b) => b.addEventListener('click', () => { const r = b.parentElement; r.classList.toggle('open'); b.setAttribute('aria-expanded', r.classList.contains('open')); }));
document.querySelectorAll('.flt button').forEach((b) => b.addEventListener('click', () => { const f = b.parentElement; f.querySelectorAll('button').forEach((o) => { o.classList.toggle('on', o === b); o.setAttribute('aria-pressed', o === b); }); const k = ['all', 'set', 'not', 'men'][[...f.children].indexOf(b)]; f.closest('.sr').querySelectorAll('.row1').forEach((r) => { r.hidden = k !== 'all' && r.dataset.g !== k; }); }));

/* ?show=d-page,phones shows only those blocks; ?st=2-4 keeps only those states (0 based, inclusive). */
const srOnly = new URLSearchParams(location.search).get('show');
if (srOnly) {
  const ids = srOnly.split(',');
  [...document.body.children].forEach((el, i, all) => {
    if (el.tagName === 'SCRIPT' || el.classList.contains('sample')) return;
    const own = el.id ? ids.includes(el.id) : all[i + 1] && ids.includes(all[i + 1].id);
    el.hidden = !own;
  });
}
const srSt = new URLSearchParams(location.search).get('st');
if (srSt) {
  const [from, to = from] = srSt.split('-').map(Number);
  [...document.getElementById('states').children].forEach((el, i) => { el.hidden = i < from || i > to; });
}
