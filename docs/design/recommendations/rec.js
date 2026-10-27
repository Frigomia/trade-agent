/* The recommendation page and Track record in the Soft direction: sample data, renderers and the page assembly. Fictional data; no requests. Needs lib.js (ic, chg) and pf.js (PNAV). */
Object.assign(I, {
  chevl: '<path d="m15 18-6-6 6-6"/>',
  globe: '<circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/>',
  clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
  info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>',
  checkc: '<circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>',
  minus: '<path d="M5 12h14"/>',
  plus: '<path d="M5 12h14"/><path d="M12 5v14"/>',
  pcirc: '<circle cx="12" cy="12" r="10"/><path d="M8 12h8"/><path d="M12 8v8"/>',
  mcirc: '<circle cx="12" cy="12" r="10"/><path d="M8 12h8"/>',
  pause: '<rect x="14" y="4" width="4" height="16" rx="1"/><rect x="6" y="4" width="4" height="16" rx="1"/>',
  scissors: '<circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M20 4 8.12 15.88"/><path d="M14.47 14.48 20 20"/><path d="M8.12 8.12 12 12"/>',
  msg: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
  moon: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>',
});

const ACT_ICON = { BUY: 'pcirc', ADD: 'plus', HOLD: 'pause', WATCH: 'eye', TRIM: 'scissors', SELL: 'mcirc' };
const actChip = (a) => `<span class="act">${ic(ACT_ICON[a] ?? 'plus', 'xs')}${a}</span>`;
const auto = () => `<span class="auto">${ic('clock', 'xs')}Automatic</span>`;
const SIG = { NEUTRAL: ['Neutral', 'mute'], OVERSOLD: ['Oversold', 'accent'], STRONG_UPTREND: ['Strong uptrend', 'accent'], WEAK_DOWNTREND: ['Weak downtrend', 'warn'] };
const sig = (s) => `<span class="sig tone-${SIG[s][1]}">${SIG[s][0]}</span>`;

/* ---- the shell ---- */
const rcNav = (on) => PNAV.map(([k, l, i, b]) => `<div class="nav ${b === 'sub' ? 'sub' : ''} ${k === on ? 'on' : ''}">${ic(i)}${l}${b === 'new' ? '<em>new</em>' : ''}</div>`).join('');
const rcDesktop = (on, inner) => `<div class="frame"><aside class="side"><div class="brand"><i>${ic('today')}</i>trade-agent</div>${rcNav(on)}</aside><main class="main co pfx rc">${inner}</main></div>`;
const rcPhone = (tab, inner) => {
  const tabs = [['today', 'Today'], ['portfolio', 'Portfolio'], ['chat', 'Chat'], ['more', 'More']];
  return `<div class="phone"><div class="scr co pfx rc">${inner}</div><div class="tabbar">${tabs.map(([k, l]) => `<div class="${k === tab ? 'on' : ''}">${ic(k)}${l}</div>`).join('')}</div></div>`;
};
const back = () => `<div class="back"><a href="#">${ic('chevl')}Today</a><span class="sp"></span><button class="theme2" aria-label="Switch theme">${ic('moon')}</button></div>`;

/* ---- a recommendation ---- */
const REC = { t: 'MSFT', a: 'ADD', px: 392.16, ch: 1.8, f: 78, sig: 'STRONG_UPTREND', pos: '4.0%' };
const WEB = `<p>Cloud revenue guided <b>above consensus</b> for the next quarter, and analysts note the stock already prices much of it in.</p><p>The main risk named is a slower enterprise spending cycle; nothing in the coverage changes the call.</p>`;
const web = () => `<div class="web2"><div class="wl">${ic('globe')}Web second opinion · not part of the score</div>${WEB}</div>`;
const ask = () => `<a class="ask" href="#">${ic('msg')}Ask about this</a>`;
const DECIDE_NOTE = 'Approving records your decision. Nothing is sent to a broker.';
const decide = (title = `Your decision on ${REC.t}`) => `<div class="dbar"><div class="t"><b>${title}</b><small>${DECIDE_NOTE}</small></div><button class="btn ghost">Dismiss</button><button class="btn">Approve</button></div>`;
const decideMobile = () => `<div class="dbar"><button class="btn">Approve</button><button class="btn ghost">Dismiss</button><small class="note2" style="flex:1 1 100%;text-align:center">${DECIDE_NOTE}</small></div>`;

const hero = ({ f = REC.f, s = REC.sig, pos = REC.pos, source = true, price = true } = {}) => `<section class="panel hero"><div class="top"><span class="tk">${REC.t}</span>${actChip(REC.a)}${source ? auto() : ''}<span class="sp"></span><span class="pend">${ic('clock', 'xs')}Pending</span></div>
  ${price ? `<div class="px">USD ${REC.px.toFixed(2)}${chg(REC.ch)}</div>` : ''}
  <div class="ev"><div><div class="l">Fundamentals</div>${f === null ? '<div class="v">—</div>' : `<div class="v">${f}<small style="color:var(--muted)"> /100</small></div><span class="bar${f < 60 ? ' warn' : ''}" role="progressbar" aria-label="Fundamentals" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${f}"><i style="width:${f}%"></i></span>`}</div>
  <div><div class="l">Technical timing</div><div class="pw">${s ? sig(s) : '<div class="v">—</div>'}</div></div>
  <div><div class="l">Suggested position</div><div class="v">${pos ?? '—'}</div></div></div></section>`;

const detailDesktop = ({ wb = true, extra = '' } = {}) => `${back()}<div class="col">${hero()}${ask()}${wb ? web() : ''}${extra}${decide()}</div>`;

const phoneDetail = () => `${back()}<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;row-gap:6px"><span style="font-size:30px;font-weight:650;letter-spacing:-.03em">${REC.t}</span>${actChip(REC.a)}${auto()}<span style="flex:1"></span><span class="pend">${ic('clock', 'xs')}Pending</span></div>
  <div class="px" style="display:flex;align-items:center;gap:10px;font-size:20px;font-weight:650">USD ${REC.px.toFixed(2)}${chg(REC.ch)}</div>
  <section class="panel erows"><div class="erow"><b>Fundamentals</b><span class="sig tone-${REC.f < 60 ? 'warn' : 'accent'}">${REC.f}/100</span></div><div class="erow"><b>Technical timing</b>${sig(REC.sig)}</div><div class="erow"><b>Suggested position</b><span class="n">${REC.pos} of portfolio</span></div></section>
  ${ask()}${web()}<div style="position:sticky;bottom:8px">${decideMobile()}</div>`;

const recorded = ({ approved = true, logged = false, err = '' } = {}) => `${back()}<div class="col"><section class="panel done"><span class="ic${approved ? '' : ' mute'}">${ic('checkc')}</span><h2>Decision recorded</h2>
  <p class="sub">You ${approved ? 'approved' : 'dismissed'} ${REC.t} · ${REC.a}.</p>
  ${approved ? `<div class="warnbox">${ic('alert', 's')}<span><b>No order was placed.</b> trade-agent never trades. If you decide to act, do it in your broker app.</span></div>${logged ? `<p class="ok2" role="status">${ic('check', 's')}Trade logged.</p>` : '<button class="btn">Log the trade I placed</button>'}` : ''}
  ${err ? `<div class="errbox" role="alert" style="width:100%;text-align:left">${ic('alert', 's')}<span>${err}</span></div>` : ''}
  <button class="btn ghost">Back to Today</button><button class="link">Change my decision</button></section></div>`;

const notice = (kind, t) => `${back()}<div class="col">${kind === 'err' ? `<div class="errbox" role="alert">${ic('alert', 's')}<span>${t}</span></div>` : `<div class="infobox" role="status">${ic('info', 's')}<span>${t}</span></div>`}</div>`;

/* ---- Track record ---- */
const ROWS = [
  ['NVDA', 'TRIM', '2026-08-14', 'Holdings call', 'Approved', -6.2, 'matched', null],
  ['MSFT', 'ADD', '2026-08-20', 'Holdings call', 'Approved', 4.1, 'matched', null],
  ['KO', 'BUY', '2026-08-27', 'Discovery idea', 'Dismissed', 1.2, 'matched', '2026-08-26'],
  ['AAPL', 'SELL', '2026-09-02', 'Holdings call', 'Approved', 3.4, 'missed', null],
  ['ASML', 'BUY', '2026-09-30', 'Discovery idea', 'Pending', null, 'unscored', null],
];
const VW = { matched: ['Matched', 'check'], missed: ['Missed', 'x'], unscored: ['Not scored', 'minus'] };
const tRow = ([t, a, d, kind, dec, mv, v, from]) => `<li class="trow"><div class="m"><div class="h"><b>${t}</b>${actChip(a)}</div><small>${d} · ${kind} · ${dec}</small>${from ? `<small>Measured from the first close on or after ${from}</small>` : ''}</div>
  <div class="r"><b class="${mv === null ? 'nm' : mv < 0 ? 'down' : 'up'}">${mv === null ? '—' : `${mv < 0 ? '−' : '+'}${Math.abs(mv).toFixed(1)}%`}</b><span class="vd">${ic(VW[v][1], 'xs')}${VW[v][0]}</span></div></li>`;
const tSum = () => `<section class="panel sum"><div class="sums">
  <section aria-label="Holdings calls"><h2>Holdings calls</h2><small>3 calls, 3 scored</small><div class="big">2 <span>of 3</span></div><div class="what">calls moved the way the action implied</div><span class="bar" role="progressbar" aria-label="Holdings calls matched" aria-valuemin="0" aria-valuemax="100" aria-valuenow="67"><i style="width:67%"></i></span></section>
  <section aria-label="Discovery ideas"><h2>Discovery ideas</h2><small>2 calls, 1 scored</small><div class="big">1 <span>of 1</span></div><div class="what">calls moved the way the action implied</div><span class="bar" role="progressbar" aria-label="Discovery ideas matched" aria-valuemin="0" aria-valuemax="100" aria-valuenow="100"><i style="width:100%"></i></span></section></div>
  <p class="note2">Each percentage below is the stock's own price change over 20 trading days from the call's day, or, when a row says "Measured from", from that earlier close (a discovery idea uses the close its saved snapshot was taken at): no benchmark, no dividends. HOLD and WATCH aren't scored, and a company that a later scan found again counts again. A small sample, not a forecast.</p></section>`;
const trackHead = () => `<div class="pfh"><div><h1>Track record</h1><div class="sub">How past calls looked 20 trading days later</div></div></div>`;
const trackView = () => `${trackHead()}<div class="col wide">${tSum()}<section class="panel rows"><ul style="list-style:none;margin:0;padding:0">${ROWS.map(tRow).join('')}</ul></section></div>`;
const trackEmpty = () => `${trackHead()}<div class="col wide"><div class="empty"><div class="ringe"><div><b>20</b><small>trading days</small></div></div><h2>No scored calls yet</h2><p>A call is scored 20 trading days after it is made. Then you see how many moved the way the action implied.</p><a class="btn ghost" href="#">See today's recommendations</a><small style="margin-top:14px">HOLD and WATCH aren't scored.</small></div></div>`;
const trackErr = () => `${trackHead()}<div class="col wide"><div class="errbox" role="alert">${ic('alert', 's')}<span>Could not load your track record.</span></div></div>`;
const trackPhone = () => `${trackHead()}${tSum()}<section class="panel rows"><ul style="list-style:none;margin:0;padding:0">${ROWS.map(tRow).join('')}</ul></section>`;

/* ---- page assembly ---- */
const cap = (t) => `<div class="cap">${t}</div>`;
const state = (t, html) => `<div class="region co pfx">${cap(t)}<div class="rc">${html}</div></div>`;

document.getElementById('d-rec').innerHTML = rcDesktop('today', detailDesktop());
document.getElementById('d-done').innerHTML = rcDesktop('today', recorded());
document.getElementById('d-track').innerHTML = rcDesktop('track', trackView());
document.getElementById('phones').innerHTML = [
  ['The recommendation', rcPhone('today', phoneDetail())],
  ['Decision recorded', rcPhone('today', recorded({ logged: false }))],
  ['Track record', rcPhone('more', trackPhone())],
].map(([l, h]) => `<div>${cap(l)}${h}</div>`).join('');
document.getElementById('states').innerHTML = [
  ['No price, no fundamentals yet (the evidence that exists is shown)', `<div class="col">${hero({ f: null, price: false, source: false })}${decide()}</div>`],
  ['Fundamentals below 60 and a weak downtrend: a caution tone, still a word', `<div class="col">${hero({ f: 48, s: 'WEAK_DOWNTREND' })}</div>`],
  ['A decision could not be saved', `<div class="col">${decide()}<div class="errbox" role="alert">${ic('alert', 's')}<span>Something went wrong. Try again.</span></div></div>`],
  ['Dismissed', recorded({ approved: false })],
  ['Approved and the trade logged', recorded({ logged: true })],
  ['Changing the decision failed', recorded({ err: 'Something went wrong. Try again.' })],
  ['Replaced by a newer analysis', notice('info', 'A newer analysis replaced this recommendation for MSFT.')],
  ['Not found or could not load', notice('err', 'Recommendation not found.')],
  ['Track record: no scored calls yet', trackEmpty()],
  ['Track record: could not load', trackErr()],
].map(([l, h]) => state(l, h)).join('');

/* ?show=d-rec,phones shows only those blocks; ?st=2-4 keeps only those states (0 based, inclusive). */
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
