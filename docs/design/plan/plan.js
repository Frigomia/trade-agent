/* Plan in the Soft direction: sample data, renderers and the page assembly. Fictional data; no requests. Needs lib.js (ic, logo) and pf.js (the shell). */
Object.assign(I, {
  copy: '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
  shield: '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="m9 12 2 2 4-4"/>',
  chev: '<path d="m6 9 6 6 6-6"/>',
  trash: '<path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
  circle: '<circle cx="12" cy="12" r="9"/>',
});

const fm = (n) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pct = (n) => `${n.toFixed(1)}%`;

/* ---- the plan: 500 EUR, three lines funded, two left out ---- */
const LINES = [
  { t: 'EUNL', name: 'iShares Core MSCI World', why: 'Below its target weight', b: 44.0, a: 45.8, tg: 48, price: 81.91, cur: 'EUR', add: 248.10, sh: 3.029, isin: 'IE00B4L5Y983' },
  { t: 'MSFT', name: 'Microsoft', why: 'Below its target weight, and its newest call is BUY', b: 16.1, a: 17.4, tg: 20, price: 392.16, cur: 'USD', rate: 'USD 1 = 0.9315', add: 156.65, sh: 0.4, isin: 'US5949181045' },
  { t: 'KO', name: 'Coca-Cola', why: 'Below its target weight', b: 6.9, a: 7.6, tg: 8, price: 62.31, cur: 'USD', rate: 'USD 1 = 0.9315', add: 95.25, sh: 1.529, isin: null },
];
const LEFT = [
  { t: 'AAPL', name: 'Apple', why: 'No money: its newest pending call is SELL.' },
  { t: 'NVDA', name: 'NVIDIA', why: 'Left out: no target weight is set for it.' },
];
const NOTES = ['1 ticker has no target weight and is left out. Set one in Portfolio to include it next month.'];
const TOTAL = LINES.reduce((s, l) => s + l.add, 0);

/* ---- the shell: Plan is the lit sub-item under Portfolio ---- */
const planNav = () => PNAV.map(([k, l, i, b]) => `<div class="nav ${b === 'sub' ? 'sub' : ''} ${k === 'cal' ? 'on' : ''}">${ic(i)}${l}${b === 'new' ? '<em>new</em>' : ''}</div>`).join('');
const plDesktop = (inner) => `<div class="frame"><aside class="side"><div class="brand"><i>${ic('today')}</i>trade-agent</div>${planNav()}</aside><main class="main co pfx pl">${inner}</main></div>`;
const plPhone = (inner) => {
  const tabs = [['today', 'Today'], ['portfolio', 'Portfolio', 1], ['chat', 'Chat'], ['more', 'More']];
  return `<div class="phone"><div class="scr co pfx pl">${inner}</div><div class="tabbar">${tabs.map(([k, l, on]) => `<div class="${on ? 'on' : ''}">${ic(k)}${l}</div>`).join('')}</div></div>`;
};
const TABS = ['Holdings', 'This month', 'Saved plans', 'Orders'];
const ptop = (cur, open = 2) => `<div class="pfh"><div><h1>Portfolio</h1></div></div>
  <nav class="seg2" aria-label="Portfolio views">${TABS.map((t) => `<a href="#"${t === cur ? ' aria-current="page"' : ''}>${t}${t === 'Orders' && open ? `<em class="n" aria-label="${open} open orders">${open}</em>` : ''}</a>`).join('')}</nav>`;
const disc = () => `<p class="disc">${ic('shield', 's')}Advisory only. Nothing is sent to a broker.</p>`;

/* ---- This month ---- */
const form = ({ amount = '500.00', whole = false, error = false, pending = false } = {}) => `<form class="panel pform" onsubmit="return false">
  <label class="fld"><small>Amount this month</small><span class="inp${error ? ' err' : ''}"><input value="${amount}" inputmode="decimal" autocomplete="off" aria-label="Amount this month"${error ? ' aria-invalid="true"' : ''}><i>EUR</i></span>${error ? '<span class="ferr" role="alert">Enter an amount between 1 and 1,000,000, for example 500.</span>' : ''}</label>
  <label class="sw"><span id="wl">Whole shares only</span><button type="button" class="tg" role="switch" aria-checked="${whole}" aria-labelledby="wl"></button></label>
  <button class="btn"${pending ? ' disabled' : ''}>Make plan</button>
  <p class="hint">Saved monthly amount. Change it in <a href="#">Preferences</a>.</p></form>`;

const lineRow = (l, whole) => `<div class="lrow" role="row">
  <div class="lc" role="cell">${logo(l.name.toUpperCase(), 36)}<span><b>${l.t}</b><small>${l.name}</small></span></div>
  <div class="lwhy" role="cell">${l.why}</div>
  <div class="lw" role="cell"><span class="wb" aria-hidden="true"><i class="af" style="width:${l.a / 0.55}%"></i><i class="bf" style="width:${l.b / 0.55}%"></i><span class="tk" style="left:${l.tg / 0.55}%"></span></span><small>Weight <b>${pct(l.b)}</b> to <b>${pct(l.a)}</b> · target ${pct(l.tg)}</small></div>
  <div class="lp" role="cell">${fm(l.price)} EUR${l.cur !== 'EUR' ? `<br>${l.rate}` : ''}</div>
  <div class="la" role="cell"><b>Add ${fm(l.add)} EUR</b><small>${whole ? `${Math.floor(l.sh)} sh` : `about ${+l.sh.toFixed(3)} sh`}</small></div></div>`;
const leftRow = (e) => `<div class="lrow out" role="row"><div class="lc" role="cell">${logo(e.name.toUpperCase(), 36)}<span><b>${e.t}</b><small>${e.name}</small></span></div><div class="lwhy lw2" role="cell">${e.why}</div><div class="la" role="cell"><b>0.00</b></div></div>`;

const ledger = ({ lines = LINES, left = LEFT, whole = false, amount = 500, head = null, sub = null } = {}) => {
  const total = lines.reduce((s, l) => s + l.add, 0);
  return `<section class="panel ledger">
  <div class="lhead"><div><h2>${head ?? `Plan for ${fm(amount)} EUR`}</h2><small>${sub ?? `${lines.length} funded · leftover ${fm(amount - total)} EUR`}</small></div>
    <span class="chips"><span class="chip ok">${lines.length} funded</span>${left.length ? `<span class="chip">${left.length} left out</span>` : ''}</span></div>
  <div role="table" aria-label="Plan lines"><div class="lrow lcols" role="row"><span role="columnheader">Ticker</span><span role="columnheader">Why</span><span role="columnheader">Weight, before to after</span><span role="columnheader" class="r">Price in EUR</span><span role="columnheader" class="r">Amount</span></div>
  ${lines.map((l) => lineRow(l, whole)).join('')}${left.map(leftRow).join('')}
  <div class="lrow ltot" role="row"><div role="cell">Total</div><div class="mid" role="cell">Leftover ${fm(amount - total)} EUR</div><div class="la" role="cell"><b>${fm(total)} EUR</b></div></div></div></section>`;
};
const notes = (n = NOTES) => `<ul class="notes" aria-label="Plan notes">${n.map((x) => `<li>${ic('alert', 's')}<span>${x}</span></li>`).join('')}</ul>`;
const legend = () => `<div class="legend"><span><i class="bf"></i>weight before</span><span><i class="af"></i>after this plan</span><span><i class="tk"></i>target (within this plan)</span></div>`;
const foot = (right) => `<div class="lfoot">${legend()}${right}</div>`;

const monthResult = (o = {}) => `${ptop('This month')}${form(o)}${ledger(o)}${notes()}${foot('<button class="btn">Save plan</button>')}${disc()}`;
const monthWhole = () => {
  const w = [{ ...LINES[0], add: 245.73, sh: 3 }, { ...LINES[2], add: 62.31, sh: 1, a: 7.4 }];
  const l = [{ t: 'MSFT', name: 'Microsoft', why: 'A whole share costs more than this line would get.' }, ...LEFT];
  return `${ptop('This month')}${form({ whole: true })}${ledger({ lines: w, left: l, whole: true })}${notes([...NOTES, '191.96 EUR is left over: whole shares only buys what fits. Turn the switch off to spend it all.'])}${foot('<button class="btn">Save plan</button>')}${disc()}`;
};
const noTargets = () => `${ptop('This month', 0)}<section class="panel callout"><h2>Set a target weight first</h2>
  <p>The plan shares your money out by the weight you want each holding or watchlist ticker to have. Nothing has a target yet.</p>
  <ol><li>Open Portfolio and edit a holding, or add a ticker to the watchlist.</li><li>Fill in Target weight, for example 20% for a fund you want to be a fifth of the portfolio.</li><li>Come back here and press Make plan.</li></ol>
  <a class="btn" href="#">Go to Portfolio</a></section>${disc()}`;
const nothing = () => `${ptop('This month')}${form()}<section class="panel callout"><h2>Nothing to fund this month</h2>
  <p>Every ticker with a target is left out, so the plan proposes nothing. Your 500.00 EUR stays with you.</p>${notes(LEFT.map((e) => `<b>${e.t}</b> ${e.why}`))}
  <p class="muted">A plan comes back when a pending call changes or a price is available again. You can also set a target on another ticker.</p></section>${disc()}`;
const stale = () => `${ptop('This month')}${form({ amount: '750.00' })}<p role="status" style="margin:0;color:var(--warn);font-size:var(--fs-body)">This plan is for 500.00 EUR. Press Make plan to update.</p>${ledger()}${notes()}${foot('<button class="btn" disabled>Save plan</button>')}${disc()}`;
const badAmount = () => `${ptop('This month')}${form({ amount: '5oo', error: true })}${disc()}`;
const loading = () => `${ptop('This month')}<div class="skel2" style="height:72px"></div><div class="skel2" style="height:240px"></div>`;
const savedNote = () => `${ptop('This month')}${form()}<div class="banner info">${ic('check', 's')}<span>Saved 8 Oct 2026, 09:14. You find it under Saved plans, and its lines wait on the Orders tab.</span></div>${ledger()}${disc()}`;

/* ---- Saved plans ---- */
const PLANS = [
  ['October 2026', '8 Oct 2026, 09:14', 500, 3, 'Open'], ['September 2026', '1 Sep 2026, 08:02', 500, 3, 'Open'],
  ['August 2026', '3 Aug 2026, 19:40', 500, 3, 'All placed'], ['July 2026', '1 Jul 2026, 07:55', 450, 3, 'All placed'],
];
const histTable = (sel = 1) => `<section class="panel hist" aria-label="Saved plans">
  <div class="hrow2 hd" aria-hidden="true"><span>Month</span><span class="hs">Saved</span><span class="r">Amount</span><span class="r hl">Lines</span><span class="r">Orders</span></div>
  ${PLANS.map((p, i) => `<button class="hrow2" aria-current="${i === sel}" aria-label="Open the ${p[0]} plan, ${p[4].toLowerCase()}"><b>${p[0]}</b><span class="hs">${p[1]}</span><span class="r">${fm(p[2])} EUR</span><span class="r hl">${p[3]}</span><span class="r"><span class="chip ${p[4] === 'Open' ? 'ok' : ''}">${p[4]}</span></span></button>`).join('')}</section>`;
const openedPlan = () => `<div class="opened"><div><h2>September 2026, as saved</h2><small>Saved 1 Sep 2026, 08:02. Prices and rates of that day.</small></div><button class="btn danger sm">${ic('trash', 's')}Delete plan</button></div>
  ${ledger({ head: 'Plan for 500.00 EUR', sub: '3 funded · leftover 0.00 EUR' })}`;
const savedView = () => `${ptop('Saved plans')}${histTable()}${openedPlan()}${disc()}`;
const savedEmpty = () => `${ptop('Saved plans', 0)}<section class="panel callout"><h2>No saved plans yet</h2><p>Make this month's plan and press Save plan. It is kept here, with the prices of that day.</p><a class="btn" href="#">Go to This month</a></section>${disc()}`;
const over = (page, dialog) => `<div class="ovl">${page}<div class="scr2">${dialog}</div></div>`;
const deleteDialog = () => `<div class="dlg" role="alertdialog" aria-labelledby="dd"><div class="top"><h2 id="dd">Delete the September 2026 plan?</h2></div><p style="margin:0;color:var(--text2)">It is removed from your saved plans (500.00 EUR, 3 lines). This cannot be undone.</p><div class="acts"><button class="btn ghost">Cancel</button><button class="btn danger">Delete plan</button></div></div>`;

/* ---- Orders ---- */
const PLACED = { t: 'KO', name: 'Coca-Cola', add: 95.25, note: 'Placed 8 Oct · 1.529 sh at 62.31' };
const oline = (l, state) => {
  if (state === 'done') return `<button class="oline done" aria-expanded="false"><span class="lc">${logo(l.name.toUpperCase(), 36)}<span><b>${l.t}</b><small class="ok">${ic('check', 'xs')}${l.note}</small></span></span><span class="a"><b>${fm(l.add)} EUR</b></span>${ic('chev', 'xs cv')}</button>`;
  return `<button class="oline" aria-expanded="${state === 'open'}"><span class="lc">${logo(l.name.toUpperCase(), 36)}<span><b>${l.t}</b><small>${l.name}</small></span></span><span class="a"><b>Add ${fm(l.add)} EUR</b><small class="muted">about ${+l.sh.toFixed(3)} sh</small></span>${ic('chev', 'xs cv')}</button>`;
};
const ticketOf = (l) => `Order (amount): ${fm(l.add)} EUR · ${l.name}${l.isin ? ` · ISIN ${l.isin}` : ''} · about ${+l.sh.toFixed(3)} shares at ${fm(l.price)} EUR`;
const ticketBody = (l, { copied = false, isinState = 'saved' } = {}) => `<div class="ticket"><div class="acts"><button class="btn ghost">${ic(copied ? 'check' : 'copy', 's')}${copied ? 'Copied' : 'Copy'}</button><button class="btn">${ic('circle', 's')}Placed</button></div>
  <div class="tx"><small>Ticket, the text Copy copies</small><p>${ticketOf(l)}</p></div>
  <div class="isin">${isinState === 'saved' ? `<span>ISIN <span class="mono">${l.isin}</span></span><button>Change</button><button>Remove</button>` : '<span>No ISIN on this ticket.</span><button>Add ISIN</button>'}</div></div>`;
const MSFT_PLACED = { note: 'Placed 8 Oct · 0.4 sh at 421.00' };
const ordersPlan = ({ open = 'MSFT', copied = false, old = false, msftPlaced = false } = {}) => {
  const L = [{ ...LINES[0] }, msftPlaced ? { ...LINES[1], ...MSFT_PLACED } : { ...LINES[1] }, { ...LINES[2], ...PLACED }];
  const done = msftPlaced ? 2 : 1, left = 3 - done;
  const body = [oline(L[0], open === 'EUNL' ? 'open' : 'closed'), open === 'EUNL' ? ticketBody(L[0], { copied }) : '', oline(L[1], msftPlaced ? 'done' : open === 'MSFT' ? 'open' : 'closed'), !msftPlaced && open === 'MSFT' ? ticketBody(L[1], { copied }) : '', oline(L[2], 'done')].join('');
  return `<section class="panel oplan" aria-labelledby="op1"><div class="ohd"><div><h2 id="op1">September 2026<span style="font-weight:500;color:var(--text2)">, ${left} open</span></h2><small>Saved 1 Sep 2026 · 500.00 EUR plan</small>
    <div class="prog" aria-label="${done} of 3 placed">${[0, 1, 2].map((i) => `<i${i < done ? ' class="on"' : ''}></i>`).join('')}<em>${done} of 3 placed</em></div></div><button class="btn ghost sm">${ic('copy', 's')}Copy all lines</button></div>
    ${old ? `<div style="padding:0 20px 14px"><div class="banner">${ic('clock', 's')}<span>Planned 1 Sep 2026. Prices and weights have moved since; make a new plan if this is no longer what you want.</span></div></div>` : ''}
    ${body}<div class="ofoot"><p>Left out of this plan: AAPL, NVDA.</p><p>Tap a line to open its order. After Placed, the next open line of that plan opens by itself.</p></div></section>`;
};
const ordersView = (o) => `${ptop('Orders', o && o.msftPlaced ? 1 : 2)}${ordersPlan(o)}${disc()}`;
const ordersStatus = () => `${ptop('Orders', 1)}<div class="status" role="status">${ic('check', 's')}<span>MSFT recorded as placed. Next: EUNL, opened for you.</span></div>${ordersPlan({ open: 'EUNL', msftPlaced: true })}${disc()}`;
const ordersEmpty = () => `${ptop('Orders', 0)}<section class="panel callout"><h2>No open orders.</h2><p>Orders come from saving a plan. Make this month's plan and press Save plan; each of its lines then waits here until you mark it placed.</p><a class="btn" href="#">Go to This month</a></section>${disc()}`;
const ordersError = () => `${ptop('Orders', 0)}<div class="banner" role="alert">${ic('alert', 's')}<span>Could not load your open orders.</span><button class="btn ghost sm" style="margin-left:auto">Retry</button></div>`;
const sheet = ({ newAsset = false } = {}) => `<div class="dlg" role="dialog" aria-labelledby="ps"><div class="top"><h2 id="ps">Record placed order</h2><button class="x" aria-label="Close">${ic('x', 's')}</button></div>
  <div class="who"><b>MSFT</b><small>Microsoft</small></div>
  <div class="row2"><label class="fld"><small>Date</small><span class="inp"><input type="text" value="8 Oct 2026" aria-label="Date"></span></label>
  <label class="fld"><small>Shares</small><span class="inp"><input value="0.4" aria-label="Shares"></span><small>From the plan: about 0.4 shares. Change it if your broker filled a different number.</small></label>
  <label class="fld"><small>Price per share</small><span class="inp"><input value="421.00" aria-label="Price per share"></span><small>Price in the currency of this holding (USD)</small></label></div>
  <p class="sanity">Shares × price = 168.40</p>
  ${newAsset ? `<div class="fld"><small>Asset type</small><div class="seg3" role="group" aria-label="Asset type"><button>ETF</button><button class="on">Stock</button></div><small>MSFT is not a holding yet. Recording this order adds it to your holdings. Prefilled from your watchlist.</small></div>` : ''}
  <p class="disc">${ic('shield', 's')}This only records the order here. Nothing is sent to a broker.</p>
  <div class="acts"><button class="btn ghost">Cancel</button><button class="btn">Record order</button></div></div>`;

/* ---- the page ---- */
const cap = (t) => `<div class="cap">${t}</div>`;
const state = (t, html) => `<div class="region co pfx pl">${cap(t)}${html}</div>`;
document.getElementById('d-month').innerHTML = plDesktop(monthResult());
document.getElementById('d-saved').innerHTML = plDesktop(savedView());
document.getElementById('d-orders').innerHTML = plDesktop(ordersView());
document.getElementById('phones').innerHTML = [
  ['This month', monthResult()], ['Saved plans', savedView()], ['Orders', ordersView()], ['Placed sheet', over(ordersView({ open: 'MSFT' }), sheet())],
].map(([l, h]) => `<div>${cap(l)}${plPhone(h)}</div>`).join('');
document.getElementById('states').innerHTML = [
  ['This month: Whole shares only', monthWhole()], ['This month: the amount changed since the plan', stale()],
  ['This month: not a valid amount', badAmount()], ['This month: saved', savedNote()],
  ['This month: no targets yet', noTargets()], ['This month: nothing to fund', nothing()], ['This month: loading', loading()],
  ['Saved plans: none yet', savedEmpty()], ['Saved plans: delete confirmation', over(savedView(), deleteDialog())],
  ['Orders: Copy pressed (Copied in place)', ordersView({ copied: true })], ['Orders: next line opened after Placed', ordersStatus()],
  ['Orders: an old plan', ordersView({ old: true })], ['Orders: none open', ordersEmpty()], ['Orders: could not load', ordersError()],
  ['Placed sheet', over(ordersView(), sheet())], ['Placed sheet: the ticker is not a holding yet', over(ordersView(), sheet({ newAsset: true }))],
].map(([l, h]) => state(l, h)).join('');

/* ?show=d-orders,phones shows only those blocks (handy for a screenshot of one part). */
const only = new URLSearchParams(location.search).get('show');
if (only) {
  const ids = only.split(',');
  [...document.body.children].forEach((el, i, all) => {
    if (el.tagName === 'SCRIPT') return;
    const own = el.id ? ids.includes(el.id) : all[i + 1] && ids.includes(all[i + 1].id);
    el.hidden = !own;
  });
}
/* ?st=2-4 keeps only those states (0 based, inclusive). */
const st = new URLSearchParams(location.search).get('st');
if (st) {
  const [from, to] = st.split('-').map(Number);
  [...document.getElementById('states').children].forEach((el, i) => { el.hidden = i < from || i > (to ?? from); });
}
