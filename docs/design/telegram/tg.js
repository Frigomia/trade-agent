/* Renders one direction (a | b | c) of the Account Telegram panel from the same copy.
   Copy follows docs/superpowers/specs/2026-10-06-telegram-notifications-design.md. Tickers, numbers
   and the web address are sample data. */
const K={alert:'<path d="M12 8v5M12 16.5v.01"/><path d="M10.3 4.3L2.5 18a2 2 0 0 0 1.7 3h15.6a2 2 0 0 0 1.7-3L13.7 4.3a2 2 0 0 0-3.4 0z"/>',check:'<path d="M5 12.5l4.5 4.5L19 7"/>',ext:'<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>'};
const k=(n,x='')=>`<svg class="i ${x}" viewBox="0 0 24 24">${K[n]}</svg>`;
const D=window.DIR||'a';
const PHONE=new URLSearchParams(location.search).get('view')==='phone';
document.body.classList.toggle('phone',PHONE);
const NOTE='Messages list tickers and actions only, never amounts or reasoning. Advisory only.';
const PITCH='Get a short message on weekday mornings when there is something to look at.';
const BLOCKED='Telegram stopped receiving messages. Reconnect to get them again.';
const tag=t=>`<div class="tag">${t}</div>`;
const frame=(act,h1,body)=>`<div class="frame" data-active="${act}"><main class="main"><div class="head"><div><h1>${h1}</h1></div><div class="actions"><span class="theme" data-theme-btn></span></div></div>${body}</main></div>`;
const ctx=`<div class="panel ctx"><h2>Claude</h2><div class="hint">Connected. sk-ant-…a1b2</div></div>`;
const chip=s=>s==='ok'?`<span class="chip ok">${k('check')}Connected</span>`:s==='warn'?`<span class="chip warn">${k('alert')}Needs attention</span>`:`<span class="chip none">Not connected</span>`;
const sw=on=>`<span class="sw ${on?'on':''}" role="switch"></span>`;
const bubble=(digest=true,moves=true)=>{const l=[];if(digest)l.push('3 new: AAPL ADD, MSFT HOLD, NVDA TRIM');if(moves)l.push('Moved: AAPL -6.2%, NVDA +5.4%');l.push('Open Today: <span class="lnk">https://app.example.com/today</span>');return `<div class="chat"><span class="who">trade-agent bot</span><div class="bubble">${l.join('\n')}\n<span class="foot">Advisory only. Nothing is sent to a broker.</span></div><span class="time">07:31</span></div>`};
const threshold=`<div class="field"><label>Move threshold</label><span class="input">5.0 %</span><span class="hint">1 to 50</span></div>`;

/* a panel per state, per direction */
function panel(state){
 const connectBtn=l=>`<button class="btn sm">${l}</button>`;
 if(D==='a'){
  const head=s=>`<div class="top"><h2>Telegram</h2>${chip(s)}</div>`;
  if(state==='off') return `<div class="panel aPanel">${head('none')}<p class="t2" style="font-size:13px">${PITCH}</p><div>${connectBtn('Connect Telegram')}</div><p class="safe">${NOTE}</p></div>`;
  if(state==='wait') return `<div class="panel aPanel">${head('none')}<div class="row"><span class="dots"><i></i><i></i><i></i></span><span class="t2" style="font-size:13px">Waiting for you to press Start in Telegram…</span></div><p class="hint">The link works for 10 minutes.</p><div class="row"><button class="btn ghost sm">Open Telegram again</button><button class="btn ghost sm">Cancel</button></div></div>`;
  if(state==='on') return `<div class="panel aPanel">${head('ok')}<div class="opt"><div><b>Morning digest</b><span class="hint">New recommendations from the automatic analysis.</span></div>${sw(true)}</div><div class="opt"><div><b>Price moves</b><span class="hint">Holdings and watchlist tickers that moved at least the threshold since the previous close.</span></div>${sw(true)}</div>${threshold}<div class="row" style="justify-content:space-between"><p class="safe grow">${NOTE}</p><button class="btn ghost sm">Disconnect</button></div></div>`;
  if(state==='blocked') return `<div class="panel aPanel">${head('warn')}<div class="warnline">${k('alert')}<span>${BLOCKED}</span></div><div class="row">${connectBtn('Reconnect')}<button class="btn ghost sm">Disconnect</button></div></div>`;
  return `<div class="panel aPanel"><div class="top"><h2>Telegram</h2></div><p class="hint">Telegram is not available on this server.</p></div>`;
 }
 if(D==='b'){
  const step=(n,t,s)=>`<div class="step ${s}"><span class="n">${s==='done'?k('check'):n}</span><span>${t}</span></div>`;
  const types=(d,m)=>`<div class="type"><div class="h"><div><b>Morning digest</b><div class="hint">New recommendations from the automatic analysis.</div></div>${sw(d)}</div><div class="ex">3 new: AAPL ADD, MSFT HOLD, NVDA TRIM</div></div><div class="type"><div class="h"><div><b>Price moves</b><div class="hint">Holdings and watchlist tickers that moved at least the threshold since the previous close.</div></div>${sw(m)}</div><div class="ex">Moved: AAPL -6.2%, NVDA +5.4%</div>${threshold}</div>`;
  const head=s=>`<div class="top"><h2>Telegram</h2>${chip(s)}</div>`;
  if(state==='off') return `<div class="panel bPanel">${head('none')}<p class="t2" style="font-size:13px">${PITCH}</p><div class="steps">${step(1,'Open the link in Telegram','')}${step(2,'Press Start','')}${step(3,'Done: you are connected','')}</div><div>${connectBtn('Connect Telegram')}</div><p class="safe">${NOTE}</p></div>`;
  if(state==='wait') return `<div class="panel bPanel">${head('none')}<div class="steps">${step(1,'Open the link in Telegram','done')}${step(2,'Press Start in the chat','cur')}${step(3,'Done: you are connected','')}</div><p class="hint">Waiting for you… The link works for 10 minutes.</p><div class="row"><button class="btn ghost sm">Open Telegram again</button><button class="btn ghost sm">Cancel</button></div></div>`;
  if(state==='on') return `<div class="panel bPanel">${head('ok')}${types(true,true)}<div class="row" style="justify-content:space-between"><p class="safe grow">${NOTE}</p><button class="btn ghost sm">Disconnect</button></div></div>`;
  if(state==='blocked') return `<div class="panel bPanel">${head('warn')}<div class="warnline">${k('alert')}<span>${BLOCKED}</span></div>${types(true,true)}<div class="row">${connectBtn('Reconnect')}<button class="btn ghost sm">Disconnect</button></div></div>`;
  return `<div class="panel bPanel"><div class="top"><h2>Telegram</h2></div><p class="hint">Telegram is not available on this server.</p></div>`;
 }
 const head=s=>`<div class="top"><h2>Telegram</h2>${chip(s)}</div>`;
 const opts=(d,m)=>`<div class="opt"><div><b>Morning digest</b><span class="hint">New recommendations from the automatic analysis.</span></div>${sw(d)}</div><div class="opt"><div><b>Price moves</b><span class="hint">Tickers that moved at least the threshold since the previous close.</span></div>${sw(m)}</div>${threshold}`;
 const prev=(d,m)=>`<div class="pv"><span class="cap">What a message looks like</span>${bubble(d,m)}</div>`;
 if(state==='off') return `<div class="cWrap"><div class="panel cPanel">${head('none')}<p class="t2" style="font-size:13px">${PITCH}</p><div>${connectBtn('Connect Telegram')}</div><p class="safe">${NOTE}</p></div>${prev(true,true)}</div>`;
 if(state==='wait') return `<div class="cWrap"><div class="panel cPanel">${head('none')}<div class="row"><span class="dots"><i></i><i></i><i></i></span><span class="t2" style="font-size:13px">Waiting for you to press Start in Telegram…</span></div><p class="hint">The link works for 10 minutes.</p><div class="row"><button class="btn ghost sm">Open Telegram again</button><button class="btn ghost sm">Cancel</button></div></div>${prev(true,true)}</div>`;
 if(state==='on') return `<div class="cWrap"><div class="panel cPanel">${head('ok')}${opts(true,true)}<div class="row" style="justify-content:space-between"><p class="safe grow">${NOTE}</p><button class="btn ghost sm">Disconnect</button></div></div>${prev(true,true)}</div>`;
 if(state==='blocked') return `<div class="cWrap"><div class="panel cPanel">${head('warn')}<div class="warnline">${k('alert')}<span>${BLOCKED}</span></div><div class="row">${connectBtn('Reconnect')}<button class="btn ghost sm">Disconnect</button></div></div>${prev(true,true)}</div>`;
 return `<div class="cWrap"><div class="panel cPanel"><div class="top"><h2>Telegram</h2></div><p class="hint">Telegram is not available on this server.</p></div></div>`;
}

const NAMES={a:'A · A quiet panel',b:'B · Steps while connecting, message types as rows',c:'C · Settings beside a live preview'};
function render(){
 let h=tag(`${NAMES[D]}. The panel sits on Account under the Claude panel. Tickers and numbers are sample data.`);
 const states=[['off','Not connected'],['wait','Waiting for Start'],['on','Connected'],['blocked','Blocked (needs attention)'],['na','Not available on this server']];
 for(const [s,t] of states) h+=tag(t)+frame('acct','Account',`<div class="stack">${ctx}${panel(s)}</div>`);
 if(D!=='c') h+=tag('A sample message in the chat')+frame('acct','Account',`<div class="stack">${bubble(true,true)}</div>`);
 document.getElementById('root').innerHTML=h;
}
render();
window.tgFinish=()=>{if(!PHONE)return;const items=[['Today','today'],['Portfolio','portfolio'],['Chat','chat'],['Track','track'],['Account','acct']];document.querySelectorAll('.frame').forEach(f=>{const on=f.dataset.active;f.insertAdjacentHTML('beforeend',`<div class="tabbar">${items.map(([l,i])=>`<div class="${i===on?'on':''}">${ic(i)}${l}</div>`).join('')}</div>`)})};
