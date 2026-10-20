/* Shared sample data and helpers for the three Today directions.
   Field names follow the backend: IdeaOut / CandidateMetrics / ScanRun / job status.
   All companies are fictional: this is sample data, not a claim about any real firm. */
const I = {
  today: '<path d="M9 11l3 3 8-8"/><path d="M20 12v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h9"/>',
  discover: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/><path d="M11 8v6M8 11h6"/>',
  portfolio: '<path d="M21 12A9 9 0 1 1 12 3v9z"/><path d="M15 3.5A9 9 0 0 1 20.5 9H15z"/>',
  chat: '<path d="M21 15a2 2 0 0 1-2 2H8l-5 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
  track: '<path d="M3 6l2 2 3-3M3 13l2 2 3-3M11 7h10M11 14h10M11 20h10"/>',
  back: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5M12 7v5l3 2"/>',
  pref: '<path d="M4 7h10M18 7h2M4 17h2M10 17h10"/><circle cx="16" cy="7" r="2"/><circle cx="8" cy="17" r="2"/>',
  acct: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  more: '<circle cx="5" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="19" cy="12" r="1.4"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  play: '<path d="M6 4l14 8-14 8z"/>',
  refresh: '<path d="M20 11a8 8 0 0 0-14.5-4M4 4v4h4"/><path d="M4 13a8 8 0 0 0 14.5 4M20 20v-4h-4"/>',
  history: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5M12 7v5l3 2"/>',
  bookmark: '<path d="M6 3h12v18l-6-4-6 4z"/>',
  arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  spark: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/>',
  alert: '<path d="M12 3l10 18H2z"/><path d="M12 10v5M12 18v.01"/>',
  news: '<path d="M5 4h11a3 3 0 0 1 3 3v12H8a3 3 0 0 1-3-3z"/><path d="M9 8h6M9 12h6M9 16h3"/>',
  check: '<path d="M5 12l5 5 9-10"/>',
  key: '<circle cx="8" cy="15" r="4"/><path d="M11 12l9-9M16 7l3 3"/>',
  eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
};
const cap1 = (s) => s[0].toUpperCase() + s.slice(1);
const ic = (n, c = '') => `<svg class="i ${c}" viewBox="0 0 24 24">${I[n]}</svg>`;

const DATA = {
  scan: { when: 'Today 06:12', outcome: 'ideas', universe: 600, eligible: 412, shortlisted: 8, researched: 8, opportunities: 5, budget: { used: 23, limit: 100 } },
  ideas: [
    { ticker: 'HLDN', name: 'Halden Systems', exch: 'NASDAQ', sector: 'Software · Infrastructure', country: 'United States', cur: 'USD', price: '184.20', asOf: 'Mon close',
      overall: 82, quality: 84, valuation: 76, fit: 61, confidence: 'high', risk: 'medium', sources: 3,
      thesis: 'Recurring infrastructure revenue and widening margins, priced below its peer median.',
      catalyst: 'Q3 results on 6 Nov follow two quarters of margin expansion.',
      why: 'Margins widening while the multiple sits below peers.' },
    { ticker: 'BRVK', name: 'Brevik Medical', exch: 'Stockholm', sector: 'Health Care · Devices', country: 'Sweden', cur: 'SEK', price: '412.60', asOf: 'Mon close',
      overall: 74, quality: 78, valuation: 69, fit: 58, confidence: 'medium', risk: 'low', sources: 2,
      why: 'Steady cash generation, low debt, valuation in line with peers.' },
    { ticker: 'TNKP', name: 'Tanaka Precision', exch: 'Tokyo', sector: 'Industrials · Machinery', country: 'Japan', cur: 'JPY', price: '3,845', asOf: 'Mon close',
      overall: 71, quality: 80, valuation: 59, fit: 66, confidence: 'medium', risk: 'medium', sources: 2,
      why: 'Order backlog growing; returns above the sector upper quartile.' },
    { ticker: 'MRLW', name: 'Marlow Water', exch: 'London', sector: 'Utilities · Water', country: 'United Kingdom', cur: 'GBP', price: '12.84', asOf: 'Mon close',
      overall: 66, quality: 61, valuation: 72, fit: 70, confidence: 'medium', risk: 'low', sources: 2,
      why: 'Regulated income and a yield above peers; check the debt load.' },
    { ticker: 'CRVN', name: 'Corvane Energy', exch: 'Toronto', sector: 'Energy · Midstream', country: 'Canada', cur: 'CAD', price: '38.10', asOf: 'Mon close',
      overall: 62, quality: 55, valuation: 70, fit: 49, confidence: 'medium', risk: 'high', sources: 1,
      why: 'Cheap on earnings multiples, with high debt and volatility.' },
  ],
  misses: [{ ticker: 'ZNTR', overall: 58, confidence: 'medium' }, { ticker: 'OKLA', overall: 55, confidence: 'low' }, { ticker: 'PRVX', overall: 52, confidence: 'medium' }],
  alerts: [
    { kind: 'earnings', tone: 'attn', ticker: 'AURL', name: 'Aurelle Foods', when: 'Today 07:40', text: 'Reported Q3: revenue up 4%, margin outlook lowered.', tag: 'Earnings' },
    { kind: 'risk', tone: 'risk', ticker: 'CSTR', name: 'Castor Logistics', when: 'Yesterday', text: 'Net debt rose above 3x EBITDA, a change from the thesis you approved on 3 Sep.', tag: 'Thesis change' },
    { kind: 'rec', tone: 'rec', ticker: 'VNTR', name: 'Vantor Retail', when: 'Today 05:31', text: 'New AI recommendation: TRIM. Review it in To review.', tag: 'AI recommendation' },
  ],
  watch: 'Two watchlist names moved into your target price range.',
  job: { stage: 'researching', total: 8, done: 3 },
  stages: [['screening', 'Screening 600 companies'], ['admitting', 'Checking companies from research'], ['researching', 'Researching candidates'], ['evaluating', 'Scoring and ranking'], ['writing', 'Saving results']],
  errors: { snapshot: 'Discovery snapshot unavailable. Refresh the universe snapshot, then try again.', key: 'Your Claude key needs attention.', generic: 'Discovery scan failed. Please try again.' },
};
const meter = (level, noun) => { const n = { low: 1, medium: 2, high: 3 }[level]; return `<span class="mt" role="img" aria-label="${cap1(level)} ${noun}">${[1, 2, 3].map((k) => `<i class="${k <= n ? "on" : ""}"></i>`).join("")}</span>`; };
const ADV = "Advisory research for human review, not investment advice. Saving or approving only records your decision; nothing is sent to a broker.";
const adv = () => `<p class="adv">${ADV}</p>`;
const initials = (n) => n.split(' ').map((w) => w[0]).slice(0, 2).join('');
/* Logo placeholder: the backend carries no logo or website field yet (see SPEC.md, gap 1). */
const logo = (n, sz = 40, cls = '') => `<span class="logo ${cls}" style="--sz:${sz}px" role="img" aria-label="${n} logo placeholder">${initials(n)}</span>`;
const money = (i) => `${i.cur} ${i.price}`;

function navItems(active) {
  const items = [['today', 'Today', 'today'], ['discover', 'Discover', 'discover', 'new'], ['portfolio', 'Portfolio', 'portfolio'], ['chat', 'Chat', 'chat'], ['track', 'Track record', 'track'], ['back', 'Backtests', 'back'], ['pref', 'Preferences', 'pref'], ['acct', 'Account', 'acct']];
  return items.map(([k, l, i, badge]) => `<div class="nav ${k === active ? 'on' : ''}">${ic(i)}${l}${badge ? `<em>${badge}</em>` : ''}</div>`).join('');
}
function Desktop(inner, { active = 'today', sub = 'Last analysis 06:31', ctx = true } = {}) {
  return `<div class="frame"><aside class="side"><div class="brand"><i>${ic('today')}</i>trade-agent</div>${navItems(active)}</aside>
  <main class="main"><div class="head"><div><h1>Today</h1><div class="sub">${sub}</div></div><div class="actions"><button class="pill">${ic('play', 's')}Run analysis</button><button class="theme" aria-label="Toggle theme">${ic('sun')}</button></div></div>
  ${ctx ? '<div class="ctx"><div><b>Portfolio value</b>existing tile</div><div><b>Cost basis</b>existing tile</div><div><b>Awaiting you</b>existing tile</div></div>' : ''}
  ${inner}</main></div>`;
}
function Phone(inner, { sub = 'Last analysis 06:31' } = {}) {
  const tabs = [['today', 'Today', 1], ['discover', 'Discover'], ['portfolio', 'Portfolio'], ['chat', 'Chat'], ['more', 'More']];
  return `<div class="phone"><div class="scr"><div class="head"><div><h1>Today</h1><div class="sub">${sub}</div></div><div class="actions"><button class="pill" style="padding:6px 14px">${ic('play', 'xs')}Run</button></div></div>${inner}</div>
  <div class="tabbar">${tabs.map(([k, l, on]) => `<div class="${on ? 'on' : ''}">${ic(k)}${l}</div>`).join('')}</div></div>`;
}
const q = new URLSearchParams(location.search);
if (q.get('theme')) document.documentElement.dataset.theme = q.get('theme');
document.body.insertAdjacentHTML('beforeend', '<div class="sample">Sample data · fictional companies</div>');

window.addEventListener("load", () => {
  const only = q.get("only");
  if (only) { // 0-1 description and desktop, 2-3 phones, 4-5 states
    const kids = [...document.body.children].filter((e) => !e.classList.contains("sample"));
    const keep = { desk: [0, 1], phones: [2, 3], states: [4, 5] }[only] || [];
    kids.forEach((e, n) => { if (!keep.includes(n)) e.style.display = "none"; });
  }
  setTimeout(() => { document.body.dataset.h = document.documentElement.scrollHeight; }, 400);
});

/* ---- v2 additions (reference-based options): day change, status pills, watchlist ---- */
I.up = '<path d="M7 17L17 7M9 7h8v8"/>';
I.down = '<path d="M7 7l10 10M17 9v8H9"/>';
I.search = '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>';
I.globe = '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>';
I.layers = '<path d="M12 3l9 5-9 5-9-5z"/><path d="M3 13l9 5 9-5"/>';
I.chev = '<path d="M9 6l6 6-6 6"/>';
I.bell = '<path d="M6 16V11a6 6 0 0 1 12 0v5l2 2H4z"/><path d="M10 21h4"/>';
[2.1, -0.8, 1.8, 0.3, 3.4].forEach((v, k) => { DATA.ideas[k].chg = v; });
DATA.alerts2 = [
  { ticker: 'AURL', name: 'Aurelle Foods', text: 'Earnings tomorrow', pill: 'Up next', tone: 'neutral' },
  { ticker: 'CSTR', name: 'Castor Logistics', text: '+6.8% since your last purchase', pill: 'Positive move', tone: 'up' },
  { ticker: 'VNTR', name: 'Vantor Retail', text: 'New AI recommendation: TRIM', pill: 'New insight', tone: 'rec' },
];
DATA.watchlist = [
  { ticker: 'NVKC', name: 'Norvik Cloud', text: 'Analyst note: cloud margins improving.', action: 'Watch' },
  { ticker: 'PLMN', name: 'Pellman Stores', text: 'Entered your target price range.', action: 'Watch' },
  { ticker: 'QSMC', name: 'Quade Semiconductors', text: 'A filing suggests the regulatory overhang is easing.', action: 'Monitor' },
];
const chg = (v) => `<span class="chg ${v >= 0 ? 'up' : 'down'}">${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(1)}%${ic(v >= 0 ? 'up' : 'down', 'xs')}</span>`;
I.cal = '<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M8 3v4M16 3v4M4 10h16"/>';
