/* Account and Preferences in the Soft direction: sample data, renderers and the page assembly. Fictional data; no requests. Needs lib.js (ic) and pf.js (PNAV). */
Object.assign(I, {
  lock: '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/><path d="M12 15V3"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/>',
  chevr: '<path d="m9 18 6-6-6-6"/>',
  shield: '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="m9 12 2 2 4-4"/>',
  cal: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
  send: '<path d="m22 2-7 20-4-9-9-4z"/><path d="M22 2 11 13"/>',
});

let uid = 0;
const nid = (p) => `${p}${++uid}`;
const EMAIL = 'alex@example.com';
const RESET = '2026-11-01';

/* ---- the shell: Preferences and Account are the lit items ---- */
const acNav = (on) => PNAV.map(([k, l, i, b]) => `<div class="nav ${b === 'sub' ? 'sub' : ''} ${k === on ? 'on' : ''}">${ic(i)}${l}${b === 'new' ? '<em>new</em>' : ''}</div>`).join('');
const acDesktop = (on, inner) => `<div class="frame"><aside class="side"><div class="brand"><i>${ic('today')}</i>trade-agent</div>${acNav(on)}</aside><main class="main co pfx ac">${inner}</main></div>`;
const acPhone = (inner) => {
  const tabs = [['today', 'Today'], ['portfolio', 'Portfolio'], ['chat', 'Chat'], ['more', 'More', 1]];
  return `<div class="phone"><div class="scr co pfx ac">${inner}</div><div class="tabbar">${tabs.map(([k, l, on]) => `<div class="${on ? 'on' : ''}">${ic(k)}${l}</div>`).join('')}</div></div>`;
};
const head = (t, sub) => `<div class="pfh"><div><h1>${t}</h1>${sub ? `<div class="sub">${sub}</div>` : ''}</div></div>`;
const CHIP = {
  ok: `<span class="chip ok">${ic('check', 'xs')}Connected</span>`,
  warn: `<span class="chip warn">${ic('alert', 'xs')}Needs attention</span>`,
  none: '<span class="chip none">Not connected</span>',
};
const sw = (id, on, label) => `<button type="button" class="tg" role="switch" aria-checked="${on}" aria-labelledby="${id}"${label ? ` aria-label="${label}"` : ''}></button>`;
const field = (label, { value = '', type = 'text', suffix = '', err = '', ph = '' } = {}) => { const eid = err ? nid('fe') : ''; return `<label class="fld"><small>${label}</small><span class="inp${err ? ' err' : ''}"><input type="${type}" value="${value}" placeholder="${ph}"${err ? ` aria-invalid="true" aria-describedby="${eid}"` : ''}>${suffix ? `<i>${suffix}</i>` : ''}</span>${err ? `<span class="ferr" id="${eid}" role="alert">${err}</span>` : ''}</label>`; };

/* ---- Account ---- */
const identity = () => `<section class="panel"><div class="idn">${logo('Alex', 48)}<div><small>Signed in as</small><b>${EMAIL}</b></div></div></section>`;

const urow = (label, used, limit) => {
  const lvl = used >= limit ? 'lim' : used / limit > 0.9 ? 'nr' : '';
  const word = lvl === 'lim' ? 'At limit ' : lvl === 'nr' ? 'Near limit ' : '';
  return `<div class="urow ${lvl}"><span>${label}</span><span class="bar${lvl ? ' warn' : ''}" role="progressbar" aria-label="${label}" aria-valuemin="0" aria-valuemax="${limit}" aria-valuenow="${used}"><i style="width:${Math.min(100, (used / limit) * 100)}%"></i></span><span class="cnt">${word ? `<b>${word}</b>` : ''}${used} / ${limit}</span></div>`;
};
const usage = ({ runs = [12, 30], chat = [18, 100], atLimit = false } = {}) => `<section class="panel use">
  ${atLimit ? `<div class="warnbox" role="status">${ic('alert', 's')}<span>You have used your monthly allowance. It resets on ${RESET}. Ask your administrator if you need more.</span></div>` : ''}
  <div class="ph"><h2>Your usage</h2><small>Resets on ${RESET}</small></div>
  ${urow('Analysis runs', ...runs)}${urow('Chat messages', ...chat)}</section>`;

const claude = (kind = 'ok') => {
  const body = {
    none: `<p class="dim">Connect your own Claude account to use Chat and scans.</p><div class="acts"><a class="btn sm" href="#">Connect Claude</a></div>`,
    ok: `<div class="keyrow"><span class="k">${ic('key')}sk-ant-…a4F9</span><span class="sp"></span><a class="btn ghost sm" href="#">Replace</a><button class="btn ghost sm">${ic('trash', 's')}Remove</button></div>
      <p class="note">Your key is stored encrypted and is never shown again; only the last four characters are.</p>`,
    warn: `<p class="dim">Anthropic did not accept your key. It may have been revoked, or the account may be out of credit. Chat and scans are paused.</p>
      <div class="keyrow"><span class="k">${ic('key')}sk-ant-…a4F9</span><span class="sp"></span><a class="btn sm" href="#">Reconnect</a><button class="btn ghost sm">${ic('trash', 's')}Remove</button></div>`,
    loading: '<div class="skel2 sm"></div>',
    error: `<div class="acts"><p class="dim">Could not load your Claude status.</p><button class="btn ghost sm">${ic('refresh', 's')}Try again</button></div>`,
  }[kind];
  return `<section class="panel" aria-busy="${kind === 'loading'}"><div class="ph"><h2>Claude</h2>${CHIP[kind] ?? ''}</div>${body}</section>`;
};
const removeKeyDialog = () => { const rk = nid('rk'); return `<div class="dlg" role="alertdialog" aria-labelledby="${rk}"><div class="top"><h2 id="${rk}">Remove your Claude key?</h2></div><p>Chat and scans stop working until you connect a key again. Your portfolio, watchlist and past recommendations stay as they are.</p><div class="acts"><button class="btn ghost">Keep it</button><button class="btn danger">Remove key</button></div></div>`; };

const NOTE = 'Messages list tickers and actions only, never amounts or reasoning. Advisory only.';
const srow = (label, hint, on) => { const id = nid('sw'); return `<div class="srow"><div><b id="${id}">${label}</b><small>${hint}</small></div>${sw(id, on)}</div>`; };
const preview = () => `<section class="panel pv"><h3>What a message looks like</h3><div style="display:grid;gap:6px"><span class="who">trade-agent bot</span>
  <div class="bub"><div>📋 3 new recommendations\n• AAPL  ADD\n• MSFT  HOLD\n• NVDA  TRIM</div><div>📈 Moved\n• AAPL  ▼ 6.2%\n• NVDA  ▲ 5.4%</div><div>🗓 Time to plan this month's contribution.</div><div>Today:  <span class="ln">https://app.example.com/today</span>\nPlan:   <span class="ln">https://app.example.com/portfolio/plan</span></div><small>Advisory only. Nothing is sent to a broker.</small></div><span class="tm">07:31</span></div></section>`;
const telegram = (kind = 'connected', { badThreshold = false } = {}) => {
  const head2 = (chip) => `<div class="ph"><h2>Telegram</h2>${chip}</div>`;
  if (kind === 'loading') return `<section class="panel" aria-busy="true">${head2('')}<div class="skel2 sm"></div></section>`;
  if (kind === 'error') return `<section class="panel">${head2('')}<div class="acts"><p class="dim">Could not load your Telegram status.</p><button class="btn ghost sm">${ic('refresh', 's')}Try again</button></div></section>`;
  if (kind === 'unavailable') return `<section class="panel">${head2('')}<p class="dim">Telegram is not available on this server.</p></section>`;
  const body = {
    off: `<p class="dim">Get a short message on weekday mornings when there is something to look at.</p><div class="acts"><button class="btn sm">Connect Telegram</button></div><p class="note">${NOTE}</p>`,
    waiting: `<div class="waiting" role="status"><span class="dots" aria-hidden="true"><i></i><i></i><i></i></span>Waiting for you to press Start in Telegram…</div><p class="note">The link works for 10 minutes.</p><div class="acts"><a class="btn ghost sm" href="#">Open Telegram again</a><button class="btn ghost sm">Cancel</button></div>`,
    connected: `${srow('Morning digest', 'New recommendations from the automatic analysis.', true)}${srow('Price moves', 'Tickers that moved at least the threshold since the previous close.', true)}${srow('Monthly plan reminder', 'Sent on the first weekday of the month, only if at least one holding or watchlist item has a target weight.', false)}
      <div class="thr">${field('Move threshold', { value: badThreshold ? '80' : '5', suffix: '%', err: badThreshold ? 'Enter a number from 1 to 50, one decimal at most.' : '' })}${badThreshold ? '' : '<small>1 to 50</small>'}</div>
      <div class="acts" style="justify-content:space-between"><p class="note" style="flex:1;min-width:200px">${NOTE}</p><button class="btn ghost sm">Disconnect</button></div>`,
    blocked: `<div class="warnline">${ic('alert', 's')}<span>Telegram stopped receiving messages. Reconnect to get them again.</span></div><div class="acts"><button class="btn sm">Reconnect</button><button class="btn ghost sm">Disconnect</button></div>`,
  }[kind];
  const chip = kind === 'connected' ? CHIP.ok : kind === 'blocked' ? CHIP.warn : CHIP.none;
  const main = `<section class="panel">${head2(chip)}${body}</section>`;
  return kind === 'connected' ? `<div class="tg3">${main}${preview()}</div>` : main;
};
const disconnectDialog = () => { const dt = nid('dt'); return `<div class="dlg" role="alertdialog" aria-labelledby="${dt}"><div class="top"><h2 id="${dt}">Disconnect Telegram?</h2></div><p>You stop getting messages until you connect again. Your portfolio and recommendations are not affected.</p><div class="acts"><button class="btn ghost">Keep connected</button><button class="btn danger">Disconnect Telegram</button></div></div>`; };

const links = () => `<nav class="panel rows" aria-label="More">${[['track', 'Track record'], ['back', 'Signal backtest'], ['pref', 'Preferences']].map(([i, l]) => `<a class="lk2" href="#">${ic(i)}<span>${l}</span>${ic('chevr')}</a>`).join('')}</nav>`;

const password = ({ error = '', done = false, mismatch = false } = {}) => `<form class="panel" onsubmit="return false"><h2>Change password</h2>
  ${field('Current password', { type: 'password', value: '••••••••••' })}${field('New password', { type: 'password', value: '••••••••••••' })}${field('Confirm new password', { type: 'password', value: mismatch ? '••••••••••' : '••••••••••••', err: mismatch ? 'The passwords do not match.' : '' })}
  ${error && !mismatch ? `<div class="errbox" role="alert">${ic('alert', 's')}<span>${error}</span></div>` : ''}${done ? `<p class="ok2" role="status">${ic('check', 's')}Password changed.</p>` : ''}
  <div class="acts"><button class="btn">Change password</button></div></form>`;
const passwordRow = (open) => `<section class="panel rows"><button class="lk2" aria-expanded="${open}">${ic('lock')}<span>Change password</span>${ic('chevr')}</button></section>`;

const data = ({ confirming = false, typed = '' } = {}) => `<section class="panel" style="gap:6px;padding:10px 12px"><button class="drow">${ic('download')}Export my data</button>
  ${confirming ? '' : `<button class="drow danger">${ic('trash')}Delete my data</button>`}
  ${confirming ? `<div class="confirm" role="group" aria-label="Delete my data" style="padding:12px 8px 8px"><p class="dim" style="color:var(--text)">This permanently deletes your holdings, watchlist, trades, recommendations, chats, backtests, preferences, snapshots and your Claude key.</p><p class="note">Your sign-in and access stay. Removing access is done by your administrator.</p>
    ${field('Type your email to confirm', { value: typed, ph: EMAIL })}
    <div class="acts"><button class="btn danger"${typed === EMAIL ? '' : ' disabled'}>Confirm delete my data</button><button class="btn ghost">Cancel</button></div></div>` : ''}</section>`;
const signout = (error = '') => `<button class="btn ghost" style="width:100%">${ic('logout', 's')}Sign out</button>${error ? `<div class="errbox" role="alert">${ic('alert', 's')}<span>${error}</span></div>` : ''}`;

const accountView = ({ claudeKind = 'ok', tg = 'connected', use = {}, pw = {}, dat = {}, out = '' } = {}) => `${head('Account')}
  <div class="cols"><div class="stack">${identity()}${usage(use)}${claude(claudeKind)}${telegram(tg)}${links()}</div>
  <div class="stack">${password(pw)}${data(dat)}${signout(out)}</div></div>`;
const accountPhone = (part = 'top') => part === 'top'
  ? `${head('Account')}${identity()}${usage({ runs: [28, 30] })}${claude('ok')}${telegram('off')}`
  : `${telegram('connected')}${links()}${passwordRow(false)}${data()}${signout()}`;
const accountPhone2 = () => `${links()}${password({})}${data({ confirming: true, typed: 'alex@exa' })}${signout()}`;

/* ---- Preferences ---- */
const SECT = ['Tobacco', 'Weapons', 'Fossil fuels'];
const riskSeg = (v) => `<div class="seg3 wide" role="group" aria-label="Risk tolerance">${['conservative', 'moderate', 'aggressive'].map((r) => `<button type="button" class="${r === v ? 'on' : ''}" aria-pressed="${r === v}">${r}</button>`).join('')}</div>`;
const sectors = (list, { full = false } = {}) => `<div class="tags">${list.map((s) => `<span class="tag2">${s}<button type="button" aria-label="Remove ${s}">${ic('x', 's')}</button></span>`).join('')}</div>
  <div class="addrow"><span class="inp"><input value="" placeholder="Add a sector" aria-label="Add a sector"${full ? ' disabled' : ''}></span><button class="btn ghost"${full ? ' disabled' : ''}>${ic('plus', 's')}Add</button></div>${full ? '<small>At most 20 sectors.</small>' : ''}`;
const sect = (title, hint, inner) => `<section class="panel"><div class="hd"><h2>${title}</h2>${hint ? `<small>${hint}</small>` : ''}</div>${inner}</section>`;
const PAUSED = {
  nokey: 'Paused: <a href="#">connect your Claude key</a> to turn this on.',
  used: 'Paused: you have used all 30 runs this month. It resumes on 1 November 2026.',
  reserved: 'Paused: your last monthly run is kept available for portfolio analysis or a manual run. It resumes on 1 November 2026.',
};
const autoSw = (kind, on, paused = '') => {
  const d = kind === 'discovery';
  const id = nid(d ? 'auto_discovery' : 'auto_analysis');
  return `<section class="panel"><div class="swp"><div><h2 id="${id}-l">${d ? 'Discover new ideas automatically each weekday' : 'Analyze my portfolio automatically each weekday'}</h2><small>${d ? 'Uses your Claude key to research up to 8 candidates each weekday, even without holdings. Counts as one additional run of your monthly limit; portfolio analysis uses a separate run. Keeps your last run available.' : 'Runs once each weekday morning and counts as one run of your monthly limit.'}</small></div>${sw(`${id}-l`, on)}</div>
  ${paused ? `<div class="pnote" role="status">${ic('alert', 's')}<span>${paused}</span></div>` : ''}</section>`;
};
const savebar = (st = 'clean') => `<div class="savebar">
  <div class="st">${st === 'dirty' ? `<span class="pillw">${ic('alert', 'xs')}Unsaved changes</span>` : st === 'saved' ? `${ic('check', 's')}Saved` : ''}</div>
  <button class="btn ghost"${st === 'dirty' ? '' : ' disabled'}>Discard</button><button class="btn">Save preferences</button></div>`;

const contrib = ({ amount = '600.00', drift = '5', amountErr = '', driftErr = '' } = {}) => sect('Contribution plan', 'Your monthly amount prefills the Plan page. Drift is how far a holding may sit from its target weight before Today flags it.', `<div class="pair">
    <div>${field('Monthly contribution', { value: amount, suffix: 'EUR', err: amountErr })}${amountErr ? '' : '<small style="display:block;margin-top:6px">EUR, 0.01 to 1,000,000. Leave empty for none.</small>'}</div>
    <div>${field('Drift threshold', { value: drift, suffix: 'pp', err: driftErr })}${driftErr ? '' : '<small style="display:block;margin-top:6px">Percentage points, 1 to 50. Default 5.</small>'}</div></div>`);
const sectSect = (list, full) => sect('Sectors to avoid', '', sectors(list, { full }));
const prefs = ({ r = 'moderate', sect2 = SECT, full = false, notes = 'Prefer broad index funds. No single position over 15%.', amount = '600.00', drift = '5', amountErr = '', driftErr = '', st = 'clean', a1 = [true, ''], a2 = [false, ''], err = '' } = {}) => `${head('Preferences', 'Preferences shape the explanations and the web second opinion. They never change the score or the call.')}
  <div class="pw">
  ${sect('Risk tolerance', 'How bold explanations may be about position size.', riskSeg(r))}
  ${sectSect(sect2, full)}
  ${sect('Notes', '', `<textarea class="ta" aria-label="Notes">${notes}</textarea><span class="cnt2">${notes.length} / 2000</span>`)}
  ${contrib({ amount, drift, amountErr, driftErr })}
  ${sect('Appearance', '', `<div class="seg3 wide free" role="group" aria-label="Appearance">${['System', 'Light', 'Dark'].map((t) => `<button type="button" class="${t === 'System' ? 'on' : ''}" aria-pressed="${t === 'System'}">${t}</button>`).join('')}</div>`)}
  ${autoSw('analysis', ...a1)}${autoSw('discovery', ...a2)}
  ${err ? `<div class="errbox" role="alert">${ic('alert', 's')}<span>${err}</span></div>` : ''}
  ${savebar(st)}</div>`;

/* ---- page assembly ---- */
const over = (page, dialog) => `<div class="ovl">${page}<div class="scr2">${dialog}</div></div>`;
const cap = (t) => `<div class="cap">${t}</div>`;
const state = (t, html) => `<div class="region co pfx ac">${cap(t)}${html}</div>`;

document.getElementById('d-account').innerHTML = acDesktop('acct', accountView());
document.getElementById('d-prefs').innerHTML = acDesktop('pref', prefs({ st: 'dirty', sect2: SECT }));
document.getElementById('phones').innerHTML = [
  ['Account, top', accountPhone('top')], ['Account, lower', accountPhone('low')], ['Account, password open and delete confirm', accountPhone2()],
  ['Preferences, top', prefs({ st: 'clean' })], ['Preferences, unsaved', prefs({ st: 'dirty', amountErr: 'Enter an amount from 0.01 to 1,000,000, two decimals at most, or leave it empty.', amount: '0' })],
].map(([l, h]) => `<div>${cap(l)}${acPhone(h)}</div>`).join('');
document.getElementById('states').innerHTML = [
  ['Claude: not connected', claude('none')], ['Claude: needs attention', claude('warn')],
  ['Claude: loading', claude('loading')], ['Claude: could not load', claude('error')],
  ['Claude: remove confirmation', over(claude('ok'), removeKeyDialog())],
  ['Usage: near limit and at limit', usage({ runs: [28, 30], chat: [100, 100], atLimit: true })],
  ['Telegram: not connected', telegram('off')], ['Telegram: waiting for Start', telegram('waiting')],
  ['Telegram: blocked', telegram('blocked')], ['Telegram: threshold not valid', telegram('connected', { badThreshold: true })],
  ['Telegram: not available on this server', telegram('unavailable')], ['Telegram: could not load', telegram('error')],
  ['Telegram: disconnect confirmation', over(telegram('connected'), disconnectDialog())],
  ['Change password: wrong current password', password({ error: 'The current password is not correct.' })],
  ['Change password: passwords differ', password({ error: 'The passwords do not match.', mismatch: true })], ['Change password: done', password({ done: true })],
  ['Delete my data: type your email', data({ confirming: true, typed: 'alex@exa' })], ['Delete my data: email matches', data({ confirming: true, typed: EMAIL })],
  ['Sign out: failed', signout('Something went wrong. Try again.')],
  ['Preferences: nothing changed', savebar('clean')], ['Preferences: saved', savebar('saved')],
  ['Preferences: amounts not valid', contrib({ amount: '0', amountErr: 'Enter an amount from 0.01 to 1,000,000, two decimals at most, or leave it empty.', drift: '80', driftErr: 'Enter a number from 1 to 50, one decimal at most.' })],
  ['Preferences: sector list full', sectSect(Array.from({ length: 20 }, (_, i) => `Sector ${i + 1}`), true)],
  ['Preferences: automatic analysis paused (used all runs) and discovery paused (no key)', autoSw('analysis', true, PAUSED.used) + autoSw('discovery', true, PAUSED.nokey)],
  ['Preferences: automatic discovery keeps the last run', autoSw('discovery', true, PAUSED.reserved)],
  ['Preferences: could not save', `<div class="errbox" role="alert">${ic('alert', 's')}<span>Something went wrong. Try again.</span></div>${savebar('dirty')}`],
  ['Preferences: could not load', `${head('Preferences')}<div class="errbox" role="alert">${ic('alert', 's')}<span>Could not load your preferences.</span></div>`],
].map(([l, h]) => state(l, h)).join('');

/* ?show=d-account,phones shows only those blocks. */
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
  const [from, to = from] = st.split('-').map(Number);
  [...document.getElementById('states').children].forEach((el, i) => { el.hidden = i < from || i > to; });
}
