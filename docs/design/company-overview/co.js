/* Company overview: shared sample data and section builders. Needs ../today-discovery/lib.js first.
   Field names follow IdeaOut / CandidateMetrics / RiskProfile / PeerComparison / Claim / NegativeDevelopment.
   Fictional company, fictional numbers: this is sample data, not a claim about any real firm. */
Object.assign(I, {
  swap: '<path d="M7 4L3 8l4 4M3 8h14M17 20l4-4-4-4M21 16H7"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.4-1 .9-1 1.7M12 17v.01"/>',
  link: '<path d="M10 14L20 4M14 4h6v6M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5"/>',
  chevd: '<path d="M6 9l6 6 6-6"/>',
  forum: '<path d="M4 5h16v10H9l-5 4z"/>',
  minus: '<path d="M6 12h12"/>',
  ask: '<path d="M21 15a2 2 0 0 1-2 2H8l-5 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/><path d="M12 8l.9 2.1L15 11l-2.1.9L12 14l-.9-2.1L9 11l2.1-.9z"/>',
});
const CO = {
  name: 'Halden Systems', ticker: 'HLDN', exch: 'NASDAQ', sector: 'Software', industry: 'Infrastructure software', country: 'United States',
  cur: 'USD', price: '184.20', chg: 2.1, chgAbs: '+3.82', asOf: 'Mon close, 19 Oct 2026', analysed: '20 Oct 2026, 06:12',
  confidence: 'high', risk: 'medium', overall: 82, scores: { quality: 84, valuation: 76, fit: 61 }, sources: 5,
  thesis: [
    'Halden sells monitoring and automation software to utilities and logistics operators, and most of its revenue repeats every year.',
    'Customers run it inside core operations, so switching is costly; renewal rates have stayed above 95% for three years.',
    'Operating margin widened from 21% to 25% over two years because new contracts added revenue faster than costs.',
    'At 24.6 times earnings the shares trade about 17% below the peer median, which looks low for this rate of growth.',
  ],
  thesisMore: 'Over the long term the opportunity rests on the installed base: each new module is sold to customers who already trust the platform. The main thing to watch is whether the largest customers renew on similar terms in 2027.',
  bull: [
    ['Operating margin rose for two quarters in a row.', 'confirmed', 'Q2 2026 results, 16 Jul 2026'],
    ['Renewal rates above 95% for three years.', 'confirmed', 'Investor presentation, 2 Jun 2026'],
    ['Q3 results are due 6 Nov 2026 and follow two quarters of margin expansion.', 'unverified', 'Upcoming catalyst'],
    ['Contract renewals with the largest customers start in Q1 2027.', 'unverified', 'Upcoming catalyst'],
  ],
  bear: [
    ['The top three customers are 38% of revenue.', 'confirmed', 'Annual report, FY2025'],
    ['Shares fell about 12% from February to May before recovering.', 'confirmed', 'Price data, 19 Oct 2026'],
    ['A rival says Halden won its latest contract on price, not product.', 'disputed', 'Company disagrees; no filing either way'],
  ],
  negDev: [
    { s: 'Chief financial officer resigned on 2 Sep 2026.', status: 'confirmed', impact: 'Adds uncertainty ahead of Q3 results; does not change the figures.', inv: false },
    { s: 'One outlet reports a regulator inquiry into a subsidiary.', status: 'unverified', impact: 'The company denies it and no filing was found. It would matter only if it reached the main business.', inv: false },
  ],
  fund: [['Revenue growth', '+14.2%', 'year on year'], ['Gross margin', '61.4%', 'last twelve months'], ['Operating margin', '24.8%', 'last twelve months'], ['Return on equity', '21.3%', 'last twelve months'], ['Net debt / EBITDA', '1.4x', 'last reported'], ['Free cash flow margin', '19.3%', 'last twelve months']],
  peers: [
    ['P/E', 24.6, 29.8, 26.0, 36.0, 'below', (v) => v.toFixed(1)],
    ['EV/EBITDA', 16.9, 21.2, 18.5, 27.3, 'below', (v) => v.toFixed(1)],
    ['Revenue growth', 14.2, 9.8, 5.1, 13.0, 'above', (v) => '+' + v.toFixed(1) + '%'],
    ['Operating margin', 24.8, 22.0, 15.2, 27.1, 'within', (v) => v.toFixed(1) + '%'],
    ['Return on equity', 21.3, 15.7, 10.2, 19.8, 'above', (v) => v.toFixed(1) + '%'],
    ['Net debt / EBITDA', 1.4, 1.1, 0.4, 2.0, 'within', (v) => v.toFixed(1) + 'x'],
  ],
  peerGroup: 'Industry group · 12 companies',
  risk_chars: [
    ['Volatility', '28% a year', 'Annualised; the price typically moves about this much over twelve months.'],
    ['Biggest fall, last year', '−12%', 'From peak to low within the past twelve months.'],
    ['Size', 'Large · EUR 38.2B', 'Market value.'],
    ['Liquidity', 'EUR 190M a day', 'Average value traded; easy to buy and sell at normal size.'],
    ['Leverage', 'Net debt 1.4x EBITDA', 'Moderate. Interest cover is not available.'],
  ],
  riskFlags: ['Top three customers are 38% of revenue', 'Shares fell about 12% from February to May'],
  riskText: 'Two of the largest customers operate in regulated markets, so a policy change could delay renewals. Most revenue is in the United States; about a fifth comes from Europe.',
  fitText: 'Adds infrastructure software to a portfolio that is mostly financials and consumer names. Software would rise from 3% to about 7%, and no single position would become the largest.',
  fitFacts: [['Software weight', '3% → 7%'], ['Largest position', 'Unchanged'], ['USD exposure', '41% → 44%']],
  src: [
    ['Official', 'Q2 2026 earnings release', 'halden.example/ir', '16 Jul 2026'],
    ['Official', 'Investor presentation', 'halden.example/ir', '2 Jun 2026'],
    ['Reliable reporting', 'CFO resigns ahead of results', 'ledgerwire.example', '2 Sep 2026'],
    ['Reliable reporting', 'Analyst note on margin outlook', 'marketdesk.example', '24 Sep 2026'],
    ['Other', 'Industry report on infrastructure software', 'sectorbrief.example', '8 Oct 2026'],
  ],
  limits: ['Price: Mon close, 19 Oct 2026.', 'Financial figures: FY2025 and the twelve months to Q2 2026.', 'Interest cover and some peer figures were not available.', 'Peer group: 12 companies in the same industry.'],
  forum: 'Forum users say the margin gain is a one-off from lower hiring. This is opinion, was not checked and is not used in any score.',
  unresolved: ['Whether a regulator inquiry exists: one outlet reports it, the company denies it, and no filing was found.', 'Whether the latest contract was won on price: a rival says so, the company disagrees.'],
};
const STATUS = { confirmed: ['check', 'Confirmed'], disputed: ['swap', 'Disputed'], unverified: ['help', 'Unverified']};
const stMark = (s) => `<span class="stm ${s}">${ic(STATUS[s][0], 'xs')}${STATUS[s][1]}</span>`;

/* confidence and risk: a three-segment meter plus the word, never colour alone; the meter is hidden from screen readers because the words follow */
const quiet = (h) => h.replace(/role="img" aria-label="[^"]*"/, 'aria-hidden="true"');
const confW = (c) => `${quiet(meter(c, 'confidence'))}${cap1(c)} confidence`;
const riskW = (r) => `${quiet(meter(r, 'risk'))}${cap1(r)} risk`;

/* ---- header pieces ---- */
const coIdentity = (sz = 56) => `<div class="id">${logo(CO.name, sz)}<div style="min-width:0"><h1 class="coname">${CO.name}</h1><div class="cotk">${CO.ticker} · ${CO.exch}</div><div class="cotags"><span>${ic('layers', 'xs')}${CO.sector}</span><span>${ic('globe', 'xs')}${CO.country}</span></div></div></div>`;
const coPrice = () => `<div class="coprice"><b class="num">${CO.cur} ${CO.price}</b><span>${chg(CO.chg)}<em>${CO.chgAbs} today</em></span><small>${CO.asOf}</small></div>`;
const coMeta = () => `<div class="cometa"><span>${confW(CO.confidence)}</span><span>${riskW(CO.risk)}</span><span class="lastan">${ic('history', 'xs')}Last analysis ${CO.analysed}</span></div>`;
const coActions = () => `<div class="coacts"><button class="btn">${ic('check', 's')}Approve</button><button class="btn ghost">${ic('bookmark', 's')}Save to Discover</button><button class="btn ghost">${ic('x', 's')}Dismiss</button><button class="btn ghost">${ic('ask', 's')}Ask AI</button></div>`;
const coBack = () => `<a href="#" class="back">${ic('chev', 'xs')}Back to opportunities</a>`;

/* ---- sections ---- */
const secHead = (t, extra = '') => `<div class="sh"><h2>${t}</h2>${extra}</div>`;
const aiLabel = (n) => `<span class="wl">AI research summary · ${n} cited sources</span>`;
const secThesis = (open = false) => `${secHead('Investment thesis')}<div class="webbox"><p class="thesis">${CO.thesis.join(' ')}</p><details class="more" ${open ? "open" : ""}><summary>Read the full thesis ${ic('chevd', 'xs')}</summary><p class="thesis">${CO.thesisMore}</p></details>${aiLabel(CO.sources)}</div>`;
const RANGES = ['1D', '1W', '1M', '6M', '1Y', '5Y'];
const secChart = (h = 220) => `${secHead('Share price', `<span class="rng" role="tablist" aria-label="Price range">${RANGES.map((r) => `<button role="tab" aria-selected="${r === '1Y'}" class="${r === '1Y' ? 'on' : ''}">${r}</button>`).join('')}</span>`)}
  <div class="pnow"><b class="num">${CO.cur} ${CO.price}</b>${chg(CO.chg)}</div><div class="chart" data-h="${h}" role="img" aria-label="Share price over the past year: from 150 to ${CO.price} ${CO.cur}, with a dip in the spring"></div><p class="adv">${CO.asOf}. One year shown.</p>`;
const secFund = () => `${secHead('Fundamentals')}<div class="tiles2">${CO.fund.map(([l, v, p]) => `<div class="tl"><small>${l}</small><b class="num">${v}</b><em>${p}</em></div>`).join('')}<div class="tl na"><small>Interest cover</small><b>Not available</b><em>No source for this company</em></div></div>`;
const POS = { below: ['down', 'Below peer median'], within: ['minus', 'Within the usual range'], above: ['up', 'Above peer median'] };
const peerRow = ([l, v, med, p25, p75, , f]) => {
  const pos = v < p25 ? 'below' : v > p75 ? 'above' : 'within';
  const lo = Math.min(v, p25) - (p75 - p25) * 0.35, hi = Math.max(v, p75) + (p75 - p25) * 0.35, x = (n) => (((n - lo) / (hi - lo)) * 100).toFixed(1);
  return `<div class="pr2"><div class="ph"><span>${l}</span><b class="num">${f(v)}</b></div><div class="pband" role="img" aria-label="${l}: ${f(v)}, peer median ${f(med)}, ${POS[pos][1].toLowerCase()}"><i class="band" style="left:${x(p25)}%;width:${x(p75) - x(p25)}%"></i><i class="med" style="left:${x(med)}%"></i><i class="dot" style="left:${x(v)}%"></i></div><div class="pf"><span>${ic(POS[pos][0], 'xs')}${POS[pos][1]}</span><span class="num">median ${f(med)}</span></div></div>`;
};
const secPeers = () => `${secHead('Valuation and quality against peers', `<span class="gp">${CO.peerGroup}</span>`)}<div class="peers">${CO.peers.map(peerRow).join('')}</div><p class="adv">Shaded band: the middle half of peers. Tick: the median. Dot: ${CO.name}. Wording is neutral: lower is not automatically better.</p>`;
const secPeersNA = () => `${secHead('Valuation and quality', '<span class="gp">Peers unavailable</span>')}<div class="na"><b>No peer comparison</b><p>Too few comparable companies were found, so the raw values are shown without a verdict.</p></div><dl class="ff">${CO.peers.map(([l, v, , , , , f]) => `<div><dt>${l}</dt><dd class="num">${f(v)}</dd></div>`).join('')}</dl>`;
const claimList = (rows) => `<ul class="claims">${rows.map(([t, s, src]) => `<li><span class="ct">${t}</span><span class="cs">${stMark(s)}<small>${src}</small></span></li>`).join('')}</ul>`;
const secBull = () => `${secHead('Bull case', `<span class="gp">What could go right</span>`)}<div class="webbox">${claimList(CO.bull)}${aiLabel(2)}</div>`;
const secBear = () => `${secHead('Bear case', `<span class="gp">What could go wrong</span>`)}<div class="webbox">${claimList(CO.bear)}<h3 class="sub3">Material negative developments</h3><ul class="claims">${CO.negDev.map((d) => `<li><span class="ct">${d.s}<small class="imp">${d.impact}</small></span><span class="cs">${stMark(d.status)}${d.inv ? '<small>Invalidates the thesis</small>' : '<small>Thesis still stands</small>'}</span></li>`).join('')}</ul>${aiLabel(3)}</div>`;
const secRisk = () => `${secHead('Risk characteristics', `<span class="gp">Measured, not scored</span>`)}<dl class="rk">${CO.risk_chars.map(([l, v, d]) => `<div><dt>${l}</dt><dd><b class="num">${v}</b><small>${d}</small></dd></div>`).join('')}</dl>
  <div class="webbox slim"><p class="thesis" style="font-size:var(--fs-body)">${CO.riskText}</p><span class="wl">Industry and geopolitical risk · AI research summary</span></div>`;
const secFit = (state = 'found') => `${secHead('Portfolio fit')}${state === 'empty'
  ? `<div class="na"><b>Not applicable</b><p>You have no holdings yet, so there is nothing to compare this company with. Add a holding and the fit is calculated against it.</p></div>`
  : `<div class="fitk"><span class="num"><b>${CO.scores.fit}</b> fit, of 100 · computed</span></div><dl class="ff">${CO.fitFacts.map(([l, v]) => `<div><dt>${l}</dt><dd class="num">${v}</dd></div>`).join('')}</dl><div class="webbox slim"><p class="thesis" style="font-size:var(--fs-body)">${CO.fitText}</p><span class="wl">AI research summary</span></div>`}`;
const secSources = (open = false) => `<details class="srcs" ${open ? 'open' : ''}><summary><span class="sh"><h2>Sources and research transparency</h2></span><span class="sc2">${CO.src.length} sources · 2 unresolved ${ic('chevd', 'xs')}</span></summary>
  <ul class="sl">${CO.src.map(([t, n, d, dt]) => `<li><a href="#">${ic('link', 'xs')}${n}</a><span>${d}</span><span class="tier">${t}</span><time>${dt}</time></li>`).join('')}</ul>
  <div class="two2"><div><h3 class="sub3">Data timestamps and limits</h3><ul class="lim">${CO.limits.map((l) => `<li>${l}</li>`).join('')}</ul></div><div><h3 class="sub3">Unresolved or conflicting evidence</h3><ul class="lim">${CO.unresolved.map((l) => `<li>${ic('swap', 'xs')}${l}</li>`).join('')}</ul></div></div>
  <div class="webbox forum"><span class="fl">${ic('forum', 'xs')}Unverified community opinion</span><p class="thesis" style="font-size:var(--fs-body)">${CO.forum}</p></div></details>`;

/* ---- charts: drawn at the real pixel width so text never scales ---- */
function series() {
  let s = 7, p = 150; const out = [];
  const rnd = () => ((s = (s * 9301 + 49297) % 233280) / 233280 - 0.5);
  for (let i = 0; i < 250; i++) { const t = i / 249; const drift = t < 0.45 ? 0.00035 : t < 0.6 ? -0.0016 : 0.0021; p *= 1 + drift + rnd() * 0.016; out.push(p); }
  const k = 184.2 / out[out.length - 1]; return out.map((v) => v * k);
}
function drawCharts() {
  document.querySelectorAll('.chart').forEach((el) => {
    const w = el.clientWidth || 300, h = +el.dataset.h, S = series(), mn = Math.min(...S) - 4, mx = Math.max(...S) + 4, L = 40, B = 22;
    const x = (i) => L + (i / (S.length - 1)) * (w - L - 4), y = (v) => 6 + (1 - (v - mn) / (mx - mn)) * (h - 6 - B);
    const line = S.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('');
    const grid = [mn + (mx - mn) * 0.1, mn + (mx - mn) * 0.5, mn + (mx - mn) * 0.9].map((v) => `<line x1="${L}" x2="${w}" y1="${y(v)}" y2="${y(v)}" class="gl"/><text x="${L - 6}" y="${y(v) + 4}" text-anchor="end">${Math.round(v)}</text>`).join('');
    const months = ['Nov', 'Jan', 'Mar', 'May', 'Jul', 'Sep'].map((m, i) => `<text x="${x((i / 5.4) * 249)}" y="${h - 5}">${m}</text>`).join('');
    el.innerHTML = `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" aria-hidden="true"><defs><linearGradient id="ga" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="var(--accent)" stop-opacity=".22"/><stop offset="1" stop-color="var(--accent)" stop-opacity="0"/></linearGradient></defs>${grid}<path d="${line}L${x(S.length - 1)},${h - B}L${L},${h - B}Z" fill="url(#ga)"/><path d="${line}" class="ln2"/>${months}<circle cx="${x(S.length - 1)}" cy="${y(S[S.length - 1])}" r="4" class="pt"/></svg>`;
  });
}
window.addEventListener('load', () => { drawCharts(); document.body.dataset.h = document.documentElement.scrollHeight; });
window.addEventListener('resize', drawCharts);

/* ---- shells ---- */
const coDesktop = (inner) => `<div class="frame"><aside class="side"><div class="brand"><i>${ic('today')}</i>trade-agent</div>${navItems('today')}</aside><main class="main co">${inner}</main></div>`;
const coPhone = (inner, bar = '') => {
  const tabs = [['today', 'Today', 1], ['discover', 'Discover'], ['portfolio', 'Portfolio'], ['chat', 'Chat'], ['more', 'More']];
  return `<div class="phone"><div class="scr co">${inner}</div>${bar}<div class="tabbar">${tabs.map(([k, l, on]) => `<div class="${on ? 'on' : ''}">${ic(k)}${l}</div>`).join('')}</div></div>`;
};
