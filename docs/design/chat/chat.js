/* Chat in the Soft direction: sample data, renderers and the page assembly. Fictional data; no requests. Needs lib.js (ic) and pf.js (PNAV). */
Object.assign(I, {
  arrowup: '<path d="m5 12 7-7 7 7"/><path d="M12 19V5"/>',
  arrowr: '<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>',
  globe: '<circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/>',
});

const NOTE = 'Advisory only, not investment advice.';
const STARTERS = ['How is my portfolio doing?', 'What changed in my recommendations lately?', 'Which holding has the most risk?'];

/* ---- the shell: Chat is the lit item ---- */
const chNav = () => PNAV.map(([k, l, i, b]) => `<div class="nav ${b === 'sub' ? 'sub' : ''} ${k === 'chat' ? 'on' : ''}">${ic(i)}${l}${b === 'new' ? '<em>new</em>' : ''}</div>`).join('');
const chDesktop = (inner) => `<div class="frame"><aside class="side"><div class="brand"><i>${ic('today')}</i>trade-agent</div>${chNav()}</aside><main class="main co pfx ch">${inner}</main></div>`;
const chPhone = (inner) => {
  const tabs = [['today', 'Today'], ['portfolio', 'Portfolio'], ['chat', 'Chat', 1], ['more', 'More']];
  return `<div class="phone"><div class="scr co pfx ch">${inner}</div><div class="tabbar">${tabs.map(([k, l, on]) => `<div class="${on ? 'on' : ''}">${ic(k)}${l}</div>`).join('')}</div></div>`;
};

/* ---- pieces ---- */
const allowance = (used, limit) => {
  const lvl = limit <= 0 ? '' : used >= limit ? 'lim' : used / limit > 0.9 ? 'nr' : '';
  return `<span class="um${lvl ? ' warn' : ''}" title="Chat messages used this month">${lvl === 'lim' ? '<b>At limit</b>' : lvl === 'nr' ? '<b>Near limit</b>' : ''}<span>${used} / ${limit}</span><span class="bar" aria-hidden="true"><i style="width:${limit <= 0 ? 0 : Math.min(100, (used / limit) * 100)}%"></i></span></span>`;
};
const header = ({ used = 44, limit = 100, canClear = true } = {}) => `<div class="chead"><h1>Chat</h1>${allowance(used, limit)}<button class="ib" aria-label="Clear chat" title="Clear chat"${canClear ? '' : ' disabled'}>${ic('trash')}</button></div>`;

const user = (t) => `<div class="ub">${t}</div>`;
const reply = (html, web = '') => `<div class="ab">${html}${web ? `<div class="web"><div class="wl">${ic('globe')}From the web · not part of the score</div>${web}</div>` : ''}</div>`;
const thinking = () => `<div class="think" role="status"><span class="d" aria-hidden="true"><i></i><i></i><i></i></span>Thinking…</div>`;

const CONVO = [
  user('How is my portfolio doing?'),
  reply(`<p>Your portfolio is up <b>2.4%</b> this month, led by Microsoft. Three things stand out:</p><ul><li><b>Concentration:</b> EUNL is 45.8% of the total, against a 48% target.</li><li><b>Pending calls:</b> AAPL has a SELL call waiting for your decision.</li><li><b>Plan:</b> this month's contribution is not placed yet.</li></ul>`, 'Analysts expect Microsoft\'s cloud revenue to keep growing faster than the market, but the stock already prices much of it in.'),
  user('Which holding has the most risk?'),
  reply('<p>NVIDIA. It moved more than 5% on four of the last ten trading days, and it is 9.1% of your portfolio with no target weight set.</p>'),
];

const starters = () => `<div class="hello">Ask about your portfolio, for example:</div><div class="starters">${STARTERS.map((s) => `<button class="starter"><span>${s}</span>${ic('arrowr')}</button>`).join('')}</div>`;

const composer = ({ value = '', placeholder = 'Ask about your portfolio', off = false } = {}) => `<div class="dock">
  <p class="adv3">${NOTE}</p>
  <form class="cmp${off ? ' off' : ''}" onsubmit="return false"><textarea rows="1" aria-label="Message" placeholder="${placeholder}"${off ? ' disabled' : ''}>${value}</textarea><button class="send" aria-label="Send"${off || !value.trim() ? ' disabled' : ''}>${ic('arrowup')}</button></form></div>`;

const required = (reconnect = false) => `<div class="req${reconnect ? ' warn' : ''}">${ic(reconnect ? 'alert' : 'key')}<div class="t"><b>${reconnect ? 'Your Claude key needs attention' : 'Connect Claude to use Chat'}</b><small>${reconnect ? 'Anthropic did not accept your key. It may have been revoked, or the account may be out of credit.' : 'Chat and analysis run on your own Claude account. Setting it up takes about five minutes, once.'}</small></div><a class="btn ${reconnect ? 'ghost' : ''} sm" href="#">${reconnect ? 'Reconnect' : 'Connect Claude'}</a></div>`;
const err = (t) => `<div class="errbox" role="alert">${ic('alert', 's')}<span>${t}</span></div>`;
const warn = (t) => `<div class="warnbox" role="status">${ic('alert', 's')}<span>${t}</span></div>`;

const page = ({ head = header(), body = '', dock = composer(), alerts = '' } = {}) => `<div class="col">${head}<div class="msgs">${body}</div>${alerts}${dock}</div>`;

const clearDialog = () => `<div class="dlg" role="alertdialog" aria-describedby="cd"><p id="cd" style="margin:0;color:var(--text)">Delete this conversation? This cannot be undone.</p><div class="acts" style="display:flex;gap:12px"><button class="btn ghost" style="flex:1">Cancel</button><button class="btn danger" style="flex:1">Delete</button></div></div>`;

/* ---- views ---- */
const talk = () => page({ body: CONVO.join(''), dock: composer() });
const emptyView = () => page({ head: header({ used: 0, canClear: false }), body: starters() });

/* ---- page assembly ---- */
const over = (pg, dialog) => `<div class="ovl">${pg}<div class="scr2">${dialog}</div></div>`;
const cap = (t) => `<div class="cap">${t}</div>`;
const state = (t, html) => `<div class="region co pfx">${cap(t)}<div class="ch">${html}</div></div>`;

document.getElementById('d-chat').innerHTML = chDesktop(talk());
document.getElementById('d-empty').innerHTML = chDesktop(emptyView());
document.getElementById('phones').innerHTML = [
  ['A conversation', chPhone(page({ head: header(), body: CONVO.slice(0, 2).join(''), dock: composer() }))],
  ['Empty: the starters', chPhone(emptyView())],
  ['A reply is coming', chPhone(page({ body: user('Which holding has the most risk?') + thinking(), dock: composer({ off: true, placeholder: 'Ask about your portfolio' }) }))],
].map(([l, h]) => `<div>${cap(l)}${h}</div>`).join('');

const msg = (t) => user(t);
document.getElementById('states').innerHTML = [
  ['A reply is coming (the box is off)', page({ head: '', body: user('Which holding has the most risk?') + thinking(), dock: composer({ off: true }) })],
  ['Opened from "Ask AI" on a company: the question is typed, not sent', page({ head: '', body: '', dock: composer({ value: 'Walk me through the research on ASML Holding (ASML).' }) })],
  ['Could not get a reply (the question comes back into the box)', page({ head: '', body: user('Which holding has the most risk?'), alerts: err('Could not get a reply. Try again.'), dock: composer({ value: 'Which holding has the most risk?' }) })],
  ['Monthly allowance used', page({ head: header({ used: 100, limit: 100 }), body: reply('<p>NVIDIA is the most volatile holding.</p>'), alerts: warn('You\'ve used all 100 chat messages this month. They reset on 2026-11-01. Need more sooner? Ask the administrator to raise your limit.'), dock: composer({ off: true, placeholder: 'Chat is paused until 2026-11-01' }) })],
  ['Chat turned off for the account', page({ head: header({ used: 0, limit: 0, canClear: false }), alerts: warn('Chat is turned off for your account. Ask the administrator if you need it.'), dock: composer({ off: true, placeholder: 'Chat is paused until 2026-11-01' }) })],
  ['No Claude key yet', page({ head: header({ used: 0, canClear: false }), dock: `<div class="dock">${required(false)}</div>` })],
  ['Claude key needs attention', page({ head: header(), body: CONVO.slice(0, 2).join(''), dock: `<div class="dock">${required(true)}</div>` })],
  ['Clear chat: confirmation', over(page({ head: header(), body: CONVO.slice(2).join(''), dock: composer() }), clearDialog())],
].map(([l, h]) => state(l, h)).join('');

/* ?show=d-chat,phones shows only those blocks; ?st=2-4 keeps only those states (0 based, inclusive). */
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
