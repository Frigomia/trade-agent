/* Renders one direction (a | b | c) of the Connect Claude flow from the same copy.
   Copy is from docs/superpowers/specs/2026-10-06-user-claude-keys-design.md; no prices, no limits.
   Menu names and links are checked against Anthropic's current pages when this is built. */
const K={key:'<circle cx="8" cy="15" r="4"/><path d="M11 12l9-9M16 7l3 3M14 9l2 2"/>',check:'<path d="M5 12.5l4.5 4.5L19 7"/>',ext:'<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',shield:'<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/><path d="M9 12l2 2 4-4"/>',alert:'<path d="M12 8v5M12 16.5v.01"/><path d="M10.3 4.3L2.5 18a2 2 0 0 0 1.7 3h15.6a2 2 0 0 0 1.7-3L13.7 4.3a2 2 0 0 0-3.4 0z"/>',rep:'<path d="M4 4v6h6M20 20v-6h-6"/><path d="M20 10a8 8 0 0 0-14-3M4 14a8 8 0 0 0 14 3"/>',trash:'<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>'};
const k=(n,x='')=>`<svg class="i ${x}" viewBox="0 0 24 24">${K[n]}</svg>`;
const D=window.DIR||'a';
const PHONE=new URLSearchParams(location.search).get('view')==='phone';
document.body.classList.toggle('phone',PHONE);
const LAST4='a1b2', MASK='sk-ant-…'+LAST4;
const STEPS=[
 ['Create an Anthropic account','Sign up at console.anthropic.com with any email.','Open console.anthropic.com'],
 ['Add a small amount of credit','Under Billing, add credit. Claude is pay-as-you-go: you pay Anthropic only for what you use. Their pricing page has the current rates.','Open Billing'],
 ['Set a monthly spend limit','In the console, set a monthly limit so usage can never go past what you chose.','Open limits'],
 ['Create a key','On the API keys page, create a key and name it trade-agent. Copy it straight away: Anthropic shows it only once.','Open API keys'],
 ['Paste it here','Paste the key and press Check and save. We check it with Anthropic before keeping it.','']
];
const SAFE='Stored encrypted. Used only for your own analyses and chat. You can remove it at any time. trade-agent never places trades.';
const ERR='Anthropic did not accept this key. Check that you copied all of it, then try again.';
const tag=t=>`<div class="tag">${t}</div>`;
const chip=(s)=>s==='ok'?`<span class="ckchip ok">${k('check')}Connected</span>`:s==='warn'?`<span class="ckchip warn">${k('alert')}Needs attention</span>`:`<span class="ckchip none">Not connected</span>`;
const frame=(act,h1,body,actions='')=>`<div class="frame" data-active="${act}"><main class="main"><div class="head"><div><h1>${h1}</h1></div><div class="actions">${actions}<span class="theme" data-theme-btn></span></div></div>${body}</main></div>`;
const safe=()=>`<div class="note safe">${k('shield')}<span>${SAFE}</span></div>`;
const pasteBox=(state)=>{ // state: empty | filled | err | busy
  const val=state==='empty'?'<span class="input ph">sk-ant-…</span>':`<span class="input key ${state==='err'?'err':''}">••••••••••••••••••••••••</span>`;
  return `<div class="paste"><div class="field"><label>Claude API key</label>${val}${state==='err'?`<div class="errmsg">${ERR}</div>`:''}</div><button class="btn ${state==='empty'?'dis':''}">${state==='busy'?'Checking with Anthropic…':'Check and save'}</button></div>`;
};
const linkBtn=(t)=>t?`<a class="btn ghost sm ext">${t}${k('ext','sm')}</a>`:'';

/* ---------- the guide (a page, reached from Today, Chat and Account) ---------- */
function guide(){
 if(D==='a'){
  const rail=c=>`<div class="panel rail">${STEPS.map((s,i)=>{const n=i+1,st=n<c?'done':n===c?'cur':'';return `<div class="r ${st}"><span class="num ${st}">${st==='done'?k('check'):n}</span>${s[0]}</div>`}).join('')}</div>`;
  const dots=c=>`<div class="dots">${[1,2,3,4,5].map(n=>`<i class="${n<=c?'on':''}"></i>`).join('')}</div>`;
  const card=(c,inner)=>`<div class="gA">${rail(c)}<div class="stack"><div class="panel stepcard">${dots(c)}<span class="k">Step ${c} of 5</span><h2>${STEPS[c-1][0]}</h2>${inner}</div>${safe()}</div></div>`;
  const s4=card(4,`<p>${STEPS[3][1]}</p><div class="row">${linkBtn(STEPS[3][2])}</div><div class="row" style="margin-top:6px"><button class="btn ghost sm">Back</button><button class="btn sm">I have the key, next</button></div>`);
  const s5=card(5,`<p>${STEPS[4][1]}</p>${pasteBox('err')}<div class="row"><button class="btn ghost sm">Back</button></div>`);
  const ok=`<div class="gA"><div class="stack" style="grid-column:1/-1"><div class="panel stepcard"><div class="big-ok"><span class="ok">${k('check')}</span><div><h2>Claude is connected</h2><p style="margin-top:4px">Chat and Run analysis now use your own Claude account.</p></div></div><div class="shown"><span class="mono">${MASK}</span>${chip('ok')}</div><div class="row"><button class="btn sm">Go to Today</button></div></div>${safe()}</div></div>`;
  return [['Step 4: create a key (mid-way)',frame('acct','Connect Claude',s4)],['Step 5: paste, with a rejected key',frame('acct','Connect Claude',s5)],['Saved',frame('acct','Connect Claude',ok)]];
 }
 if(D==='b'){
  const row=(i,state,extra='')=>{const s=STEPS[i],n=i+1;return `<div class="st ${state}"><span class="num ${state==='done'?'done':state==='open'?'cur':''}">${state==='done'?k('check'):n}</span><div><b>${s[0]}</b><p>${s[1]}</p>${extra}</div><span class="ext-btn">${linkBtn(s[2])}</span></div>`};
  const head=`<div class="hd"><h2>Connect your Claude account</h2><p>About five minutes, once. Already have a key? Go straight to step 5.</p></div>`;
  const list=(five,done)=>`<div class="stack"><div class="panel gB">${head}${[0,1,2,3].map(i=>row(i,done?'done':'')).join('')}${five}</div>${safe()}</div>`;
  const open=`<div class="st open"><span class="num cur">5</span><div><b>${STEPS[4][0]}</b><p>${STEPS[4][1]}</p><div class="inl">${pasteBox('err')}</div></div><span></span></div>`;
  const fresh=`<div class="st open"><span class="num cur">5</span><div><b>${STEPS[4][0]}</b><p>${STEPS[4][1]}</p><div class="inl">${pasteBox('empty')}</div></div><span></span></div>`;
  const saved=`<div class="st"><span class="num done">${k('check')}</span><div><b>Connected</b><p><span class="mono">${MASK}</span> is saved and checked.</p></div>${chip('ok')}</div>`;
  return [['All five steps on one page (nothing typed yet)',frame('acct','Connect Claude',list(fresh,false))],['Step 5 with a rejected key',frame('acct','Connect Claude',list(open,false))],['Saved',frame('acct','Connect Claude',list(saved,true))]];
 }
 const left=`<div class="stack"><div class="panel gC"><div class="steps" style="grid-column:1/-1">${STEPS.slice(0,4).map((s,i)=>`<div class="s"><span class="num">${i+1}</span><div><b>${s[0]}</b><small>${s[1].split('. ')[0].replace(/\.$/,'')}.</small></div>${linkBtn(s[2])}</div>`).join('')}</div></div>${safe()}</div>`;
 const vault=(inner,cls='')=>`<div class="vault ${cls}"><div class="top"><span class="lg">${k('key')}Your Claude key</span>${cls==='warn'?chip('warn'):''}</div>${inner}</div>`;
 const empty=vault(`<div class="slot"><span class="input ph">sk-ant-…</span><button class="btn dis">Check and save</button></div><div class="note" style="margin-top:auto">Step 5: paste the key from step 4 here.</div>`);
 const err=vault(`<div class="slot" style="border-color:var(--down)"><span class="input key err">••••••••••••••••••••••••</span><div class="errmsg">${ERR}</div><button class="btn">Check and save</button></div>`);
 const full=vault(`<div class="digits mono">${MASK}</div><div>${chip('ok')}</div><div class="foot"><button class="btn ghost sm">Replace</button><button class="btn ghost sm">Remove</button></div>`);
 const wrap=v=>`<div class="gC">${left.replace('class="panel gC"','class="panel"')}${v}</div>`;
 return [['Nothing pasted yet',frame('acct','Connect Claude',wrap(empty))],['A rejected key',frame('acct','Connect Claude',wrap(err))],['Saved',frame('acct','Connect Claude',wrap(full))]];
}

/* ---------- locked Chat, locked Run analysis, reconnect variant ---------- */
function lockedMarkup(warn){
 const title=warn?'Your Claude key needs attention':'Connect Claude to use Chat';
 const body=warn?'Anthropic did not accept your key. It may have been revoked, or the account may be out of credit.':'Chat and analysis run on your own Claude account. Setting it up takes about five minutes, once.';
 const cta=warn?'Reconnect':'Connect Claude';
 if(D==='a') return `<div class="panel lockcard ${warn?'warn':''}"><span class="ic">${k(warn?'alert':'key')}</span><div class="grow"><b>${title}</b><p>${body}</p></div><button class="btn sm">${cta}</button></div>`;
 if(D==='b') return `<div class="lockbar ${warn?'warn':''}">${k(warn?'alert':'key')}<span class="t"><b>${title}.</b> ${body}</span><button class="btn sm">${cta}</button></div><div class="composer" style="margin-top:8px"><span class="input">Ask about your portfolio…</span><button class="btn dis">Send</button></div>`;
 return `<div class="lockslot ${warn?'warn':''}"><span class="kk mono">${warn?MASK:'sk-ant-…'}</span><span class="t"><b>${title}</b>${body}</span><button class="btn sm">${cta}</button></div>`;
}
function chatFrame(warn){
 const msg=`<div class="bubble">Ask about your holdings, a ticker on your watchlist, or why a recommendation was made.</div>`;
 return frame('chat','Chat',`<div class="chatbox">${msg}${lockedMarkup(warn)}</div>`);
}
function runFrame(warn){
 const why=warn?'Reconnect Claude to run an analysis':'Connect Claude to run an analysis';
 const btn=`<button class="pill dis"><span data-play></span>Run analysis</button>`;
 const tiles=`<div class="tiles"><div class="panel tile"><div class="l">Portfolio</div><div class="v">—</div></div><div class="panel tile"><div class="l">Awaiting you</div><div class="v">0</div></div></div>`;
 const link=`<div class="hint" style="text-align:left;margin:0 0 12px"><a class="lnk">${why}</a>. Everything else works without it.</div>`;
 return frame('today','Today',link+tiles,btn);
}

/* ---------- Today reminder ---------- */
function todayFrame(){
 const t='Connect Claude to start analyzing', b='Run analysis and Chat use your own Claude account. About five minutes, once.';
 let r;
 if(D==='a') r=`<div class="panel remind"><span class="ic">${k('key')}</span><div class="t"><b>${t}</b><p>${b}</p></div><button class="btn sm">Set up</button></div>`;
 else if(D==='b') r=`<div class="remind strip panel">${k('key')}<div class="t"><b style="display:inline">${t}.</b> <span class="muted">${b}</span></div><button class="btn sm">Set up</button></div>`;
 else r=`<div class="remind ghost"><span class="mono lockslot kk" style="border:0;padding:0;background:none;color:var(--muted)">sk-ant-…</span><div class="t"><b>${t}</b><p>${b}</p></div><button class="btn sm">Set up</button></div>`;
 const tiles=`<div class="tiles"><div class="panel tile"><div class="l">Portfolio</div><div class="v">—</div></div><div class="panel tile"><div class="l">Awaiting you</div><div class="v">0</div></div></div>`;
 return frame('today','Today',r+tiles,`<button class="pill dis"><span data-play></span>Run analysis</button>`);
}

/* ---------- Account panel ---------- */
function accountFrame(){
 const dlg=`<div class="dlg"><h3>Remove your Claude key?</h3><p>Chat and Run analysis stop working until you connect a key again. Your portfolio, watchlist and past recommendations stay as they are.</p><div class="row" style="justify-content:flex-end"><button class="btn ghost sm">Keep it</button><button class="btn danger sm">Remove key</button></div></div>`;
 const conn=`<div class="panel acc"><div class="row" style="justify-content:space-between"><h3>Claude</h3>${chip('ok')}</div><div class="rowk"><span class="kv mono">${k('key')}${MASK}</span><span class="grow"></span><button class="btn ghost sm">${k('rep','sm')}Replace</button><button class="btn ghost sm">${k('trash','sm')}Remove</button></div><p class="note">Your key is stored encrypted and is never shown again; only the last four characters are.</p></div>`;
 const warn=`<div class="panel acc"><div class="row" style="justify-content:space-between"><h3>Claude</h3>${chip('warn')}</div><p class="t2" style="font-size:13px">Anthropic did not accept your key. It may have been revoked, or the account may be out of credit. Chat and Run analysis are paused.</p><div class="rowk"><span class="kv mono">${k('key')}${MASK}</span><span class="grow"></span><button class="btn sm">Reconnect</button><button class="btn ghost sm">Remove</button></div></div>`;
 const none=`<div class="panel acc"><div class="row" style="justify-content:space-between"><h3>Claude</h3>${chip('none')}</div><p class="t2" style="font-size:13px">Connect your own Claude account to use Chat and Run analysis.</p><div class="rowk"><button class="btn sm">Connect Claude</button></div></div>`;
 return [['Not connected',frame('acct','Account',`<div class="stack">${none}</div>`)],['Connected, with the remove confirmation',frame('acct','Account',`<div class="stack">${conn}${dlg}</div>`)],['Needs attention',frame('acct','Account',`<div class="stack">${warn}</div>`)]];
}

/* ---------- admin Users ---------- */
function adminFrame(){
 const rows=[['Marta K.','marta@example.com','User','Active','ok'],['Joao P.','joao@example.com','User','Active','warn'],['Lena S.','lena@example.com','User','Invited','none']];
 const tr=r=>`<div class="tr"><div class="n">${r[0]}<small>${r[1]}</small></div><div class="role">${r[2]}</div><div class="stat">${r[3]}</div><div class="use muted">usage counts</div><div class="c">${chip(r[4])}</div></div>`;
 return frame('acct','Users',`<div class="panel tbl"><div class="tr h"><div>Person</div><div>Role</div><div>Status</div><div>Usage</div><div>Claude</div></div>${rows.map(tr).join('')}</div><div class="fine">You see only whether a key is connected, never the key and never its digits.</div>`);
}

/* ---------- page ---------- */
const NAMES={a:'A · One step at a time',b:'B · The whole page',c:'C · The key card'};
function render(){
 let h=`<div class="tag">${NAMES[D]}. The guide is a page, reached from Today, Chat and Account.</div>`;
 const sec=(title,items)=>items.map(([t,f])=>tag(`${title}: ${t}`)+f).join('');
 h+=sec('Guide',guide());
 h+=tag('Locked: Chat')+chatFrame(false)+tag('Locked: Chat, reconnect')+chatFrame(true);
 h+=tag('Locked: Run analysis (Today)')+runFrame(false);
 h+=tag('Today reminder')+todayFrame();
 h+=sec('Account',accountFrame());
 h+=tag('Admin: Users')+adminFrame();
 document.getElementById('root').innerHTML=h;
}
render();
window.ckFinish=()=>{if(!PHONE)return;const items=[['Today','today'],['Portfolio','portfolio'],['Chat','chat'],['Track','track'],['Account','acct']];document.querySelectorAll('.frame').forEach(f=>{const on=f.dataset.active;f.insertAdjacentHTML('beforeend',`<div class="tabbar">${items.map(([l,i])=>`<div class="${i===on?'on':''}">${ic(i)}${l}</div>`).join('')}</div>`)})};
