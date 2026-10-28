/* Sign-in screens in the Soft direction: renderers and the page assembly. Fictional data; no requests. Needs lib.js (ic). */
Object.assign(I, {
  mail: '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-10 5L2 7"/>',
  lock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  eyeoff: '<path d="M9.9 4.2A10 10 0 0 1 12 4c6.5 0 10 8 10 8a17 17 0 0 1-2.2 3.2M6.6 6.6A16 16 0 0 0 2 12s3.5 8 10 8a9.7 9.7 0 0 0 5.4-1.6"/><path d="M14.1 14.1a3 3 0 1 1-4.2-4.2"/><path d="m2 2 20 20"/>',
});

const LOGO = '../../../frontend/public/los_trading_hermanos_logo.svg';
const ADVICE = 'Advisory information only, not investment advice.';
const err = (t) => `<div class="errbox" role="alert">${ic('alert', 's')}<span>${t}</span></div>`;
const warn = (t) => `<div class="warnbox" role="alert">${ic('alert', 's')}<span>${t}</span></div>`;
const info = (t) => `<div class="info" role="note">${ic('mail', 's')}<span>${t}</span></div>`;
const okbox = (t) => `<div class="ok" role="status">${ic('mail', 's')}<span>${t}</span></div>`;

/* a field: label above, optional leading icon, optional show/hide button (Sign in only, as in the app) */
let fid = 0;
const field = (label, value = '', { icon = '', type = '', shown = false, bad = false, off = false, msg = '', eye = false } = {}) => {
  const id = `f${++fid}`;
  const btn = eye ? `<button type="button" class="eye" aria-label="${shown ? 'Hide password' : 'Show password'}">${ic(shown ? 'eyeoff' : 'eye', 's')}</button>` : '';
  const dots = type === 'pw' && !shown ? '\u2022'.repeat(value.length) : value;
  return `<div class="fld"><label for="${id}"><small>${label}</small></label><span class="inp${bad ? ' err' : ''}${off ? ' off' : ''}${btn ? ' has-btn' : ''}">${icon ? ic(icon, 's') : ''}<input id="${id}" value="${dots}"${off ? ' disabled' : ''}${bad ? ' aria-invalid="true"' : ''}${msg ? ` aria-describedby="${id}e"` : ''}>${btn}</span>${msg ? `<span class="ferr" id="${id}e">${msg}</span>` : ''}</div>`;
};
const check = (on) => `<label class="chk"><input type="checkbox" class="cb"${on ? ' checked' : ''}><span>I understand trade-agent gives advisory information only and is not investment advice.</span></label>`;
const head = (title, sub) => `<div><img class="mk" src="${LOGO}" alt="" width="38" height="38"><h1>${title}</h1>${sub ? `<p class="sub1">${sub}</p>` : ''}</div>`;

/* the three screens: the heading and the panel */
const login = ({ error = '', shown = false, busy = false } = {}) => `<form class="si" onsubmit="return false">${head('Sign in', 'to your trade-agent account')}
  <div class="panel">${field('Email', 'alex@example.com', { icon: 'mail' })}${field('Password', shown ? 'correct horse' : 'password123', { icon: 'lock', type: 'pw', shown, bad: !!error, eye: true })}
    <div class="frow"><a href="#">Forgot password?</a></div>${error ? err(error) : ''}
    <button class="btn"${busy ? ' disabled' : ''}>Sign in</button></div>
  ${info("trade-agent is by invitation only. If you don't have an account, ask the administrator to invite you.")}</form>`;
const invite = ({ pw = 'longenough', pw2 = 'longenough', ok = true, short = false, diff = false, error = '' } = {}) => `<form class="si" onsubmit="return false">${head('Set your password', 'The administrator invited you to trade-agent. This link expires in 24 hours.')}
  <div class="panel">${field('Email', 'sam@example.com', { off: true })}${field('Create password', pw, { type: 'pw', bad: short, msg: short ? 'Use at least 8 characters.' : '' })}${field('Confirm password', pw2, { type: 'pw', bad: diff, msg: diff ? "Passwords don't match." : '' })}
    ${check(ok)}${error ? err(error) : ''}<button class="btn"${ok && !short && !diff && pw ? '' : ' disabled'}>Create account</button></div></form>`;
const invalid = () => `<div class="si">${warn('This invitation link is no longer valid — it may have expired or already been used. Ask your administrator to resend it.')}</div>`;
const reset = ({ error = '' } = {}) => `<form class="si" onsubmit="return false">${head('Reset your password', 'We will email you a link to choose a new one.')}
  <div class="panel">${field('Email', 'alex@example.com', { icon: 'mail' })}${error ? err(error) : ''}<button class="btn">Send reset link</button></div></form>`;
const sent = () => `<div class="si">${okbox('Check your email for a link to reset your password.')}</div>`;
const choose = ({ error = '' } = {}) => `<form class="si" onsubmit="return false">${head('Choose a new password', 'alex@example.com')}
  <div class="panel">${field('New password', 'newpassword1', { icon: 'lock', type: 'pw' })}${error ? err(error) : ''}<button class="btn">Save password</button></div></form>`;

/* the frame: brand panel + form column (desktop), or the form column alone (phone) */
const desktop = (inner) => `<div class="afr"><aside class="bp"><div class="nm"><img src="${LOGO}" alt="">trade-agent</div><div><p class="promise">It shows its work, remembers how past calls turned out, and never places a trade.</p><p class="sub">An advisory-only reasoning partner. You stay the decision-maker.</p><p class="adv">${ADVICE}</p></div></aside><main class="fp"><div class="top"><button class="theme" aria-label="Switch theme">${ic('sun')}</button></div><div class="mid">${inner}</div><p class="advm">${ADVICE}</p><a class="cr" href="#">Logos provided by Logo.dev</a></main></div>`;
const phone = (inner) => `<div class="phone"><div class="scr si"><div class="top"><button class="theme" aria-label="Switch theme">${ic('sun')}</button></div><div class="mid">${inner}</div><p class="advm">${ADVICE}</p><a class="cr" href="#">Logos provided by Logo.dev</a></div></div>`;
const cap = (t) => `<div class="cap">${t}</div>`;
const state = (t, html) => `<div class="region co pfx">${cap(t)}<div class="afr"><main class="fp"><div class="mid">${html}</div></main></div></div>`;

document.getElementById('d-login').innerHTML = desktop(login());
document.getElementById('d-invite').innerHTML = desktop(invite());
document.getElementById('d-reset').innerHTML = desktop(reset());
document.getElementById('phones').innerHTML = [
  ['Sign in', phone(login())],
  ['Set your password', phone(invite())],
  ['Reset your password', phone(reset())],
  ['Link sent', phone(sent())],
  ['Choose a new password', phone(choose())],
].map(([l, h]) => `<div>${cap(l)}${h}</div>`).join('');
document.getElementById('states').innerHTML = [
  ['Sign in: wrong password', login({ error: 'Email or password is incorrect. Try again or reset your password.' })],
  ['Sign in: no access', login({ error: "This account doesn't have access. Contact your administrator." })],
  ['Sign in: signing in, password shown', login({ shown: true, busy: true })],
  ['Set your password: too short', invite({ pw: 'short', pw2: '', ok: false, short: true })],
  ['Set your password: not matching', invite({ pw: 'longenough', pw2: 'longenoug', ok: true, diff: true })],
  ['Set your password: could not record', invite({ error: 'Something went wrong recording your acceptance. Try again.' })],
  ['Set your password: link not valid', invalid()],
  ['Reset: choose a new password', choose()],
  ['Reset: the request failed', reset({ error: 'Email rate limit exceeded' })],
  ['Reset: link sent', sent()],
  ['Reset: new password failed', choose({ error: 'New password should be different from the old password.' })],
].map(([l, h]) => state(l, h)).join('');

/* ?show=d-login,phones shows only those blocks; ?st=2-4 keeps only those states (0 based, inclusive). */
const only = new URLSearchParams(location.search).get('show');
if (only) {
  const ids = only.split(',');
  [...document.body.children].forEach((el, i, all) => {
    if (el.tagName === 'SCRIPT' || el.classList.contains('sample')) return;
    const own = el.id ? ids.includes(el.id) : all[i + 1] && ids.includes(all[i + 1].id);
    el.hidden = !own;
  });
}
const stq = new URLSearchParams(location.search).get('st');
if (stq) {
  const [from, to = from] = stq.split('-').map(Number);
  [...document.getElementById('states').children].forEach((el, i) => { el.hidden = i < from || i > to; });
}
