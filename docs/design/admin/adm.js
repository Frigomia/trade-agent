/* Admin (Users, Usage and limits) in the Soft direction: sample data, renderers and the page assembly. Fictional data; no requests. Needs lib.js (ic) and pf.js (PNAV). */
Object.assign(I, {
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  gauge: '<path d="m12 14 4-4"/><path d="M3.34 19a10 10 0 1 1 17.32 0"/>',
  cal: '<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M8 3v4M16 3v4M4 10h16"/>',
  mail: '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-10 5L2 7"/>',
  ban: '<circle cx="12" cy="12" r="10"/><path d="m4.9 4.9 14.2 14.2"/>',
  info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>',
  dots3: '<circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/>',
});

const USERS = [
  { e: 'alex@example.com', role: 'admin', st: 'active', cl: 'server', a: [9, 30], c: [22, 100] },
  { e: 'sam@example.com', role: 'user', st: 'active', cl: 'ok', a: [12, 30], c: [41, 100] },
  { e: 'riley@example.com', role: 'user', st: 'active', cl: 'warn', a: [28, 30], c: [100, 100] },
  { e: 'max@example.com', role: 'user', st: 'active', cl: 'none', a: [0, 30], c: [0, 100] },
  { e: 'jo@example.com', role: 'user', st: 'invited', cl: 'none', a: [0, 30], c: [0, 100] },
  { e: 'pat@example.com', role: 'user', st: 'disabled', cl: 'none', a: [3, 30], c: [8, 100] },
];
const monogram = (e) => e.split('@')[0].replace(/[^a-z0-9]/gi, '').slice(0, 2).toUpperCase();
const CHIP = {
  ok: `<span class="chip ok">${ic('check', 'xs')}Connected</span>`,
  warn: `<span class="chip warn">${ic('alert', 'xs')}Needs attention</span>`,
  none: '<span class="chip none">Not connected</span>',
  server: `<span class="chip ok">${ic('check', 'xs')}Server key</span>`,
};
const ST_ICON = { active: 'check', invited: 'mail', disabled: 'ban' };
const stPill = (s) => `<span class="st ${s}">${ic(ST_ICON[s], 'xs')}${s}</span>`;

/* ---- the shell: the Administration section is lit ---- */
const adNav = (on) => PNAV.map(([k, l, i, b]) => `<div class="nav ${b === 'sub' ? 'sub' : ''}">${ic(i)}${l}${b === 'new' ? '<em>new</em>' : ''}</div>`).join('')
  + `<div class="sect">Administration</div><div class="nav ${on === 'users' ? 'on' : ''}">${ic('users')}Users</div><div class="nav ${on === 'usage' ? 'on' : ''}">${ic('gauge')}Usage &amp; limits</div>`;
const adDesktop = (on, inner) => `<div class="frame"><aside class="side"><div class="brand"><i>${ic('today')}</i>trade-agent</div>${adNav(on)}</aside><main class="main co pfx ad">${inner}</main></div>`;
const adPhone = (inner) => {
  const tabs = [['today', 'Today'], ['portfolio', 'Portfolio'], ['chat', 'Chat'], ['more', 'More', 1]];
  return `<div class="phone"><div class="scr co pfx ad">${inner}</div><div class="tabbar">${tabs.map(([k, l, on]) => `<div class="${on ? 'on' : ''}">${ic(k)}${l}</div>`).join('')}</div></div>`;
};
const info = (t) => `<div class="info" role="note">${ic('info', 's')}<span>${t}</span></div>`;
const err = (t) => `<div class="errbox" role="alert">${ic('alert', 's')}<span>${t}</span></div>`;

/* ---- Users ---- */
const filter = (cur = 'all') => {
  const n = (s) => (s === 'all' ? USERS.length : USERS.filter((u) => u.st === s).length);
  return `<div class="flt" role="group" aria-label="Filter users">${['all', 'active', 'invited', 'disabled'].map((s) => `<button class="${s === cur ? 'on' : ''}" aria-pressed="${s === cur}">${s[0].toUpperCase()}${s.slice(1)}<i>${n(s)}</i></button>`).join('')}</div>`;
};
const actions = (u) => `<span class="c-act">${u.st === 'invited' ? '<button class="btn ghost sm">Resend</button><button class="btn ghost sm">Revoke</button>' : u.st === 'disabled' ? '<button class="btn ghost sm">Enable</button>' : ''}${u.st !== 'invited' ? `<button class="adots" aria-label="User details">${ic('dots3')}</button>` : ''}</span>`;
const urow = (u, on) => `<div class="arow${on ? ' on' : ''}"><span class="who"><span class="uavatar" aria-hidden="true">${monogram(u.e)}</span><span>${u.e}</span></span><span class="c-role"><span class="rl">${u.role}</span></span><span class="c-stat">${stPill(u.st)}</span><span class="c-cl">${CHIP[u.cl]}</span>${actions(u)}</div>`;
const list = (sel = 'sam@example.com', rows = USERS) => `<section class="panel"><div class="uhead" aria-hidden="true"><span>Person</span><span class="c-role">Role</span><span class="c-stat">Status</span><span class="c-cl">Claude</span><span class="c-act"></span></div>${rows.map((u) => urow(u, u.e === sel)).join('')}</section><p class="fnote">You see only whether a key is connected, never the key and never its digits.</p>`;

const field = (label, value = '', { err: e = false, ph = '' } = {}) => `<label class="fld"><small>${label}</small><span class="inp${e ? ' err' : ''}"><input value="${value}" placeholder="${ph}"${e ? ' aria-invalid="true"' : ''}></span></label>`;
const detail = (u = USERS[1], { typed = '', error = '' } = {}) => `<section class="panel det"><div><h2>${u.e}</h2><small style="text-transform:capitalize">${u.st}</small></div>
  <div class="meta"><b style="font-size:var(--fs-body)">Claude</b>${CHIP[u.cl]}</div><hr>
  <form style="display:grid;gap:10px" onsubmit="return false"><h3>Monthly limits</h3>
    ${field(`Analysis runs (used ${u.a[0]} of ${u.a[1]})`, '', { ph: `Default: ${u.a[1]}` })}<button type="button" class="btn ghost sm" style="justify-self:start">Use default</button>
    ${field(`Chat messages (used ${u.c[0]} of ${u.c[1]})`, '', { ph: `Default: ${u.c[1]}` })}<button type="button" class="btn ghost sm" style="justify-self:start">Use default</button>
    <button class="btn">Save limits</button></form><hr>
  ${u.st === 'disabled' ? '<button class="btn ghost">Enable</button>' : '<button class="btn ghost">Disable</button>'}<hr>
  <h3>Remove user</h3><p class="muted">Type ${u.e} to confirm. This permanently deletes their data.</p>
  ${field('Confirm email', typed)}
  <button class="btn danger"${typed === u.e ? '' : ' disabled'}>Remove</button>
  ${error ? err(error) : ''}</section>`;
const usersPage = ({ sel = 'sam@example.com', f = 'all', alerts = '', rows = USERS, side = detail() } = {}) => `${alerts}<div class="head2"><h1>Users</h1><button class="btn">${ic('plus', 's')}Invite user</button></div>${info('You manage access, not data.')}${filter(f)}<div class="ugrid"><div style="display:grid;gap:10px;min-width:0">${list(sel, rows)}</div>${side}</div>`;

const inviteDrawer = (error = '', sending = false) => `<div class="drawer" role="dialog" aria-label="Invite user"><h2>Invite user</h2>${field('Email', 'new@example.com')}${error ? err(error) : ''}<button class="btn"${sending ? ' disabled' : ''}>Send invite</button></div>`;

/* ---- Usage and limits ---- */
const defaultsPanel = ({ saved = false, error = '', a = '30', c = '100' } = {}) => `<section class="panel lim"><div><h2>Default limits</h2><small>For everyone without a personal limit. Personal limits are set per person on the Users page.</small></div>
  <div class="two">${field('Analysis runs', a, { err: !!error })}${field('Chat messages', c, { err: !!error })}</div>${error ? err(error) : ''}
  <div style="display:flex;align-items:center;gap:12px"><button class="btn">Save defaults</button>${saved ? `<span class="saved" role="status">${ic('check', 's')}Saved</span>` : ''}</div></section>`;
const umeter = ([u, l], name = '') => { const f = l ? u / l : 0, lvl = l && f > 0.9; return `<div class="um"><b>${u} / ${l || '—'}</b><span class="bar${lvl ? ' warn' : ''}" role="progressbar" aria-label="${name}" aria-valuetext="${u} of ${l}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(f * 100)}"><i style="width:${Math.min(100, f * 100)}%"></i></span></div>`; };
const level = (u) => { const worst = [u.a, u.c].map(([x, l]) => (l && x >= l ? 2 : l && x / l > 0.9 ? 1 : 0)); const w = Math.max(...worst); return w === 2 ? `<span class="lv warn">${ic('alert', 'xs')}At limit</span>` : w === 1 ? `<span class="lv warn">${ic('alert', 'xs')}Near limit</span>` : '<span class="lv ok">OK</span>'; };
const usageTable = () => `<section class="panel"><table class="utab"><thead><tr><th>User</th><th>Analysis runs</th><th>Chat messages</th><th></th></tr></thead><tbody>${USERS.map((u) => `<tr><td><span class="who" style="display:flex;align-items:center;gap:10px"><span class="uavatar" aria-hidden="true">${monogram(u.e)}</span>${u.e}</span></td><td>${umeter(u.a, `${u.e}, analysis runs`)}</td><td>${umeter(u.c, `${u.e}, chat messages`)}</td><td style="text-align:right">${level(u)}</td></tr>`).join('')}<tr class="tot"><td>Total</td><td>${USERS.reduce((s, u) => s + u.a[0], 0)} runs</td><td>${USERS.reduce((s, u) => s + u.c[0], 0)} messages</td><td></td></tr></tbody></table></section>`;
const usageCards = () => `<section class="panel">${USERS.map((u) => `<div class="ucard"><div class="who"><span class="uavatar" aria-hidden="true">${monogram(u.e)}</span><span>${u.e}</span></div><div><div class="l">Analysis runs</div>${umeter(u.a, `${u.e}, analysis runs`)}</div><div><div class="l">Chat messages</div>${umeter(u.c, `${u.e}, chat messages`)}</div>${level(u)}</div>`).join('')}<div class="ucard"><div class="who">Total</div><div><div class="l">Analysis runs</div><b>${USERS.reduce((t, u) => t + u.a[0], 0)} runs</b></div><div><div class="l">Chat messages</div><b>${USERS.reduce((t, u) => t + u.c[0], 0)} messages</b></div></div></section>`;
const usagePage = ({ alerts = '', defaults = defaultsPanel(), table = usageTable() } = {}) => `${alerts}<div class="head2"><h1>Usage and limits</h1></div>${info('You manage access, not data. Usage shows how much each person used the service, never what they asked or received.')}<div class="lgrid">${defaults}${table}</div>`;

/* ---- page assembly ---- */
const over = (pg, d) => `<div class="ovl">${pg}<div class="scr2">${d}</div></div>`;
const cap = (t) => `<div class="cap">${t}</div>`;
const state = (t, html) => `<div class="region co pfx">${cap(t)}<div class="ad">${html}</div></div>`;

document.getElementById('d-users').innerHTML = adDesktop('users', usersPage());
document.getElementById('d-usage').innerHTML = adDesktop('usage', usagePage());
document.getElementById('phones').innerHTML = [
  ['Users', adPhone(`<div class="head2"><h1>Users</h1><button class="btn">${ic('plus', 's')}Invite user</button></div>${info('You manage access, not data.')}${filter('all')}<div class="ugrid"><div style="display:grid;gap:10px">${list('', USERS.slice(1, 6))}</div></div>`)],
  ['User details: a bottom sheet', adPhone(over(`<div class="head2"><h1>Users</h1></div>${filter('all')}<div class="ugrid"><div>${list('', USERS.slice(1, 4))}</div></div>`, `<div class="sheet"><div class="grab"></div>${detail().replace('class="panel det"', 'class="det" style="padding:0;position:static;border:0;box-shadow:none;background:none"')}</div>`))],
  ['Usage and limits', adPhone(`<div class="head2"><h1>Usage and limits</h1></div>${info('You manage access, not data. Usage shows how much each person used the service, never what they asked or received.')}<div class="lgrid">${defaultsPanel()}${usageCards()}</div>`)],
].map(([l, h]) => `<div>${cap(l)}${h}</div>`).join('');
document.getElementById('states').innerHTML = [
  ['Invite user: the drawer', over(usersPage({ side: '' }), inviteDrawer())],
  ['Invite user: refused', over(usersPage({ side: '' }), inviteDrawer('That email already has an account.'))],
  ['Users: an action failed', usersPage({ alerts: err('Something went wrong.'), side: '' })],
  ['Users: could not load', `${err('Could not load users.')}<div class="head2"><h1>Users</h1></div>`],
  ['Details: Remove needs the email typed', detail(USERS[1], { typed: 'sam@exa' })],
  ['Details: the email matches', detail(USERS[1], { typed: 'sam@example.com' })],
  ['Details: a disabled person', detail(USERS[5])],
  ['Details: nothing selected (a desktop)', `<section class="panel det"><p class="empty2">Select a user to see their limits and access.</p></section>`],
  ['Details: the change failed', detail(USERS[1], { error: 'Something went wrong.' })],
  ['Filter: Invited', `${filter('invited')}<div style="margin-top:12px">${list('', USERS.filter((u) => u.st === 'invited'))}</div>`],
  ['Default limits: saved', defaultsPanel({ saved: true })],
  ['Default limits: not a whole number', defaultsPanel({ a: '2.5', error: 'Enter whole numbers, zero or more.' })],
  ['Usage: could not load', `${err('Could not load usage.')}<div class="head2"><h1>Usage and limits</h1></div>`],
].map(([l, h]) => state(l, h)).join('');

/* ?show=d-users,phones shows only those blocks; ?st=2-4 keeps only those states (0 based, inclusive). */
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
