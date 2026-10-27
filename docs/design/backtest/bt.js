/* The Signal backtest in the Soft direction: sample data, renderers and the page assembly. Fictional data; no requests. Needs lib.js (ic) and pf.js (PNAV). */
const fa = (n) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/* ---- the shell: Signal backtest is the lit item (it is the Backtests item) ---- */
const btNav = () => PNAV.map(([k, l, i, b]) => `<div class="nav ${b === 'sub' ? 'sub' : ''} ${k === 'back' ? 'on' : ''}">${ic(i)}${k === 'back' ? 'Signal backtest' : l}${b === 'new' ? '<em>new</em>' : ''}</div>`).join('');
const btDesktop = (inner) => `<div class="frame"><aside class="side"><div class="brand"><i>${ic('today')}</i>trade-agent</div>${btNav()}</aside><main class="main co pfx bt">${inner}</main></div>`;
const btPhone = (inner) => {
  const tabs = [['today', 'Today'], ['portfolio', 'Portfolio'], ['chat', 'Chat'], ['more', 'More', 1]];
  return `<div class="phone"><div class="scr co pfx bt">${inner}</div><div class="tabbar">${tabs.map(([k, l, on]) => `<div class="${on ? 'on' : ''}">${ic(k)}${l}</div>`).join('')}</div></div>`;
};
const head = () => `<div class="pfh"><div><h1>Signal backtest</h1><div class="sub">Tests the technical signals only, on one ticker, with no fundamentals. It does not test discovery ideas.</div></div></div>`;

/* ---- the form ---- */
const field = (label, value, { icon = '', err = false, type = 'text', ph = '' } = {}) => `<label class="fld"><small>${label}</small><span class="inp${err ? ' err' : ''}">${icon ? ic(icon) : ''}<input type="${type}" value="${value}" placeholder="${ph}"${err ? ' aria-invalid="true"' : ''}></span></label>`;
const form = ({ ticker = 'MSFT', from = '2023-10-27', to = '2026-10-27', running = false, error = '', bad = '' } = {}) => `<form class="panel form" onsubmit="return false"><h2>Run a backtest</h2>
  ${field('Ticker', ticker, { icon: 'search', ph: 'Search by name or ticker', err: bad === 'ticker' })}
  <div class="dates">${field('From', from, { type: 'date', err: bad === 'dates' })}${field('To', to, { type: 'date', err: bad === 'dates' })}</div>
  ${error ? `<div class="errbox" role="alert">${ic('alert', 's')}<span>${error}</span></div>` : ''}
  ${running ? `<p class="runstat" role="status"><span class="d" aria-hidden="true"><i></i><i></i><i></i></span>Running the backtest. This can take a little while.</p>` : ''}
  <button class="btn"${running ? ' disabled' : ''}>Run backtest</button>
  <small>Starts with 10,000 and replays the technical signal on past prices.</small></form>`;

/* ---- the result ---- */
const curve = (n, end, wiggle, seed) => { let v = 10000, s = seed; const out = []; for (let i = 0; i < n; i++) { s = (s * 9301 + 49297) % 233280; v += (end - 10000) / n + ((s / 233280) - 0.5) * wiggle; out.push(v); } out[n - 1] = end; out[0] = 10000; return out; };
const CURVE_B = curve(60, 11950, 300, 31);
const CURVE_S_UP = curve(60, 12840, 330, 7), CURVE_S_DOWN = curve(60, 9210, 330, 11);
let chartN = 0;
const chart = (ahead = true) => {
  const CURVE_S = ahead ? CURVE_S_UP : CURVE_S_DOWN, gid = `eq${++chartN}`;
  const W = 640, H = 220, L = 52, R = 12, T = 12, B = 28;
  const all = [...CURVE_S, ...CURVE_B], lo = Math.floor(Math.min(...all) / 1000) * 1000, hi = Math.ceil(Math.max(...all) / 1000) * 1000;
  const x = (i) => L + (i / (CURVE_S.length - 1)) * (W - L - R), y = (v) => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);
  const path = (a) => a.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('');
  const ticks = []; for (let t = lo; t <= hi; t += 1000) ticks.push(t);
  return `<svg class="eqc" role="img" aria-label="Strategy value against buy-and-hold over the tested period" viewBox="0 0 ${W} ${H}"><defs><linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="var(--accent)" stop-opacity=".25"/><stop offset="1" stop-color="var(--accent)" stop-opacity="0"/></linearGradient></defs>
  ${ticks.map((t) => `<line x1="${L}" x2="${W - R}" y1="${y(t)}" y2="${y(t)}" stroke="var(--line)" stroke-width=".7"/><text x="${L - 8}" y="${y(t) + 4}" text-anchor="end" font-size="11" fill="var(--muted)">${(t / 1000).toFixed(0)}k</text>`).join('')}
  <path d="${path(CURVE_S)}L${x(CURVE_S.length - 1)},${H - B}L${x(0)},${H - B}Z" fill="url(#${gid})"/>
  <path d="${path(CURVE_B)}" fill="none" stroke="var(--muted)" stroke-width="2" stroke-dasharray="5 4"/>
  <path d="${path(CURVE_S)}" fill="none" stroke="var(--accent-solid)" stroke-width="2.5"/>
  <text x="${L}" y="${H - 8}" font-size="11" fill="var(--muted)">2023-10-27</text><text x="${W - R}" y="${H - 8}" text-anchor="end" font-size="11" fill="var(--muted)">2026-10-27</text></svg>
  <div class="legend"><span><i class="s"></i>Strategy ${fa(CURVE_S[0])} to ${fa(CURVE_S[CURVE_S.length - 1])}</span><span><i class="b"></i>Buy and hold ${fa(CURVE_B[0])} to ${fa(CURVE_B[CURVE_B.length - 1])}</span></div>`;
};
const SIGS = [['Strong uptrend', 31, 2.8, 64], ['Neutral', 24, 0.6, 54], ['Oversold', 9, 4.3, 78], ['Weak downtrend', 6, -3.1, 33], ['Weak uptrend', 3, 1.9, 67]];
const sigTable = (rows = SIGS) => `<table class="sigt" aria-label="Signal hit rates"><thead><tr><th>Technical signal</th><th>Times seen</th><th>Avg move (20d)</th><th>Rose afterwards</th></tr></thead><tbody>${rows.map(([n, c, m, r]) => `<tr><td>${n}</td><td>${c}</td><td class="${m < 0 ? 'down' : 'up'}">${m < 0 ? '−' : '+'}${Math.abs(m).toFixed(1)}%</td><td>${r}%</td></tr>`).join('')}</tbody></table>`;
const result = ({ ahead = true, rows = SIGS, small = true, chartOn = true } = {}) => `<section class="panel"><div class="rhead"><div class="t"><h2>MSFT, 2023-10-27 to 2026-10-27</h2><small>Signal strategy vs buy and hold</small></div><span class="edge ${ahead ? 'up' : 'down'}">${ic(ahead ? 'up' : 'down', 'xs')}${ahead ? 'Ahead of' : 'Behind'} buy-and-hold by ${ahead ? '+8.9' : '−27.4'}%</span></div>
  <div class="stats"><div class="stat"><div class="l">Strategy final value</div><div class="v">${fa(ahead ? 12840 : 9210)}</div></div><div class="stat"><div class="l">Buy and hold</div><div class="v">${fa(11950)}</div></div></div>
  <small>Both start from ${fa(10000)}.</small>
  ${chartOn ? chart(ahead) : ''}
  ${rows.length ? sigTable(rows) : '<p style="color:var(--text2)">No signals fired in this range.</p>'}
  ${small && rows.some((r) => r[1] < 5) ? '<p class="note3">Some signals were seen fewer than 5 times; treat those rows as anecdotes.</p>' : ''}
  <p class="note3">Past performance is not a forecast. Simulated on past prices only; nothing is sent to a broker.</p></section>`;

/* ---- recent runs ---- */
const RUNS = [['MSFT', '2023-10-27 to 2026-10-27', 8.9, 1], ['KO', '2022-01-03 to 2026-01-02', -4.1], ['EUNL', '2021-06-01 to 2026-06-01', 0.0], ['NVDA', '2024-01-02 to 2026-10-01', 21.4]];
const runs = (list = RUNS) => `<section class="panel runs"><h2>Recent runs</h2>${list.length ? `<div class="rl">${list.map(([t, r, e, on]) => `<button class="rrow${on ? ' on' : ''}"${on ? ' aria-current="true"' : ''}><span class="m"><b>${t}</b><small>${r}</small></span><span class="edge ${e === 0 ? 'flat' : e < 0 ? 'down' : 'up'}">${e === 0 ? '' : ic(e < 0 ? 'down' : 'up', 'xs')}${e === 0 ? '' : e < 0 ? '−' : '+'}${Math.abs(e).toFixed(1)}%</span></button>`).join('')}</div>` : '<p style="color:var(--text2)">No backtests yet.</p>'}</section>`;
const listErr = () => `<section class="panel runs"><h2>Recent runs</h2><div class="errbox" role="alert">${ic('alert', 's')}<span>Could not load your recent runs.</span></div></section>`;

const page = ({ f = form(), res = result(), r = runs() } = {}) => `${head()}<div class="bgrid"><div class="bg-form">${f}</div><div class="bg-res">${res}</div><div class="bg-runs">${r}</div></div>`;

/* ---- page assembly ---- */
const cap = (t) => `<div class="cap">${t}</div>`;
const state = (t, html) => `<div class="region co pfx">${cap(t)}<div class="bt">${html}</div></div>`;

document.getElementById('d-bt').innerHTML = btDesktop(page());
document.getElementById('d-empty').innerHTML = btDesktop(page({ res: '', r: runs([]) }));
document.getElementById('phones').innerHTML = [
  ['The form and a result', btPhone(`${head()}<div class="bgrid"><div class="bg-form">${form()}</div><div class="bg-res">${result({ rows: SIGS.slice(0, 3), small: false })}</div><div class="bg-runs">${runs()}</div></div>`)],
  ['Running', btPhone(`${head()}<div class="bgrid"><div class="bg-form">${form({ running: true })}</div><div class="bg-res"></div><div class="bg-runs">${runs()}</div></div>`)],
].map(([l, h]) => `<div>${cap(l)}${h}</div>`).join('');
document.getElementById('states').innerHTML = [
  ['Running: the button is off and a status is announced', form({ running: true })],
  ['Not a valid ticker', form({ ticker: '$$', bad: 'ticker', error: 'Enter a ticker: letters, digits, . - or ^, up to 20 characters.' })],
  ['The start date is after the end date', form({ from: '2026-10-27', to: '2023-10-27', bad: 'dates', error: 'The start date must not be after the end date.' })],
  ['The backtest could not run', `<div class="warnbox" role="alert">${ic('alert', 's')}<span>The backtest could not run for that ticker and range. Check the ticker and dates.</span></div>`],
  ['Could not load that backtest', `<div class="errbox" role="alert">${ic('alert', 's')}<span>Could not load that backtest.</span></div>`],
  ['Behind buy-and-hold', result({ ahead: false, rows: SIGS.slice(0, 3), small: false })],
  ['No signals fired in this range', result({ rows: [], chartOn: true })],
  ['Recent runs: none yet / could not load', `${runs([])}${listErr()}`],
].map(([l, h]) => state(l, `<div style="display:grid;gap:12px">${h}</div>`)).join('');

/* ?show=d-bt,phones shows only those blocks; ?st=2-4 keeps only those states (0 based, inclusive). */
const only = new URLSearchParams(location.search).get('show');
if (only) {
  const ids = only.split(',');
  [...document.body.children].forEach((el, i, all) => {
    if (el.tagName === 'SCRIPT') return;
    const own = el.id ? ids.includes(el.id) : all[i + 1] && ids.includes(all[i + 1].id);
    el.hidden = !own;
  });
}
const stq = new URLSearchParams(location.search).get('st');
if (stq) {
  const [from, to = from] = stq.split('-').map(Number);
  [...document.getElementById('states').children].forEach((el, i) => { el.hidden = i < from || i > to; });
}
