/* Renders one direction (a | b | c) of the scheduled-analysis UI from the same copy.
   Copy is from docs/superpowers/specs/2026-10-06-scheduled-analysis-design.md (verbatim). */
const K={clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',alert:'<path d="M12 8v5M12 16.5v.01"/><path d="M10.3 4.3L2.5 18a2 2 0 0 0 1.7 3h15.6a2 2 0 0 0 1.7-3L13.7 4.3a2 2 0 0 0-3.4 0z"/>',cal:'<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M3 10h18M8 3v4M16 3v4"/>'};
const k=(n,x='')=>`<svg class="i ${x}" viewBox="0 0 24 24">${K[n]}</svg>`;
const D=window.DIR||'a';
const PHONE=new URLSearchParams(location.search).get('view')==='phone';
document.body.classList.toggle('phone',PHONE);
const LABEL='Analyze my portfolio automatically each weekday';
const EXPLAIN='Runs once each weekday morning and counts as one run of your monthly limit.';
const P_LIMIT='Paused: you have used all 100 runs this month. It resumes on 1 November 2026.';
const P_KEY='Paused: connect your Claude key to turn this on.';
const tag=t=>`<div class="tag">${t}</div>`;
const frame=(act,h1,body)=>`<div class="frame" data-active="${act}"><main class="main"><div class="head"><div><h1>${h1}</h1></div><div class="actions"><span class="theme" data-theme-btn></span></div></div>${body}</main></div>`;
const ctx=`<div class="panel ctx"><div class="f"><label>Risk tolerance</label><span class="input">Moderate</span></div><div class="f"><label>Sectors to avoid</label><span class="input">Tobacco, Weapons</span></div></div>`;
const pz=(state)=>state==='limit'?`<div class="pz">${k('alert')}<span>${P_LIMIT}</span></div>`:state==='key'?`<div class="pz">${k('alert')}<span>${P_KEY.replace('connect your Claude key','<a>connect your Claude key</a>')}</span></div>`:'';
const swc=(state)=>`<span class="sw ${state==='off'?'':state==='on'?'on':'pause'}" role="switch"></span>`;

/* ---------- the Preferences switch in four states ---------- */
function prefs(state){
 if(D==='a') return `<div class="stack">${ctx}<div class="panel aRow"><div class="top"><div><b>${LABEL}</b><div class="hint">${EXPLAIN}</div></div>${swc(state)}</div>${pz(state)}</div></div>`;
 if(D==='b'){
  const st=state==='off'?`<span class="status off"><i></i>Off</span>`:state==='on'?`<span class="status on"><i></i>On</span>`:`<span class="status pause"><i></i>Paused</span>`;
  const banner=state==='limit'?`<div class="banner"><span class="t">${P_LIMIT}</span></div>`:state==='key'?`<div class="banner"><span class="t">${P_KEY}</span><button class="btn sm">Connect Claude</button></div>`:'';
  return `<div class="stack">${ctx}<div class="panel bCard"><div class="head2"><div class="row"><h2>Automatic analysis</h2>${st}</div>${swc(state)}</div><div><b style="font-size:14px">${LABEL}</b><div class="hint" style="margin-top:2px">${EXPLAIN}</div></div>${banner}</div></div>`;
 }
 const days=['M','T','W','T','F'];
 const cls=state==='on'?'lit':state==='off'?'':'dim';
 const strip=`<div class="week">${days.map(d=>`<div class="day ${cls}"><i></i>${d}</div>`).join('')}<div class="day we"><i></i>S</div><div class="day we"><i></i>S</div></div>`;
 return `<div class="stack">${ctx}<div class="panel cCard"><div class="row" style="justify-content:space-between;flex-wrap:nowrap"><div><b style="font-size:14px">${LABEL}</b><div class="hint" style="margin-top:2px">${EXPLAIN}</div></div>${swc(state)}</div>${strip}${pz(state)}</div></div>`;
}

/* ---------- Today: one manual and one automatic recommendation ---------- */
function today(){
 const t=D==='a'?`<span class="tagA">${k('clock')}Automatic</span>`:'';
 const tb=D==='b'?`<span class="tagB">${k('clock')}Automatic</span>`:'';
 const tc=D==='c'?`<span class="tagC">Automatic</span>`:'';
 const auto=`<div class="panel rec ${D==='c'?'autoC':''}"><div class="tk"><b>MSFT</b><span class="chip">ADD</span>${t}${tc}</div><span class="px">412.30</span><p>Fundamentals pass the gate; the trend is above its 50-day average.</p>${tb}</div>`;
 const manual=`<div class="panel rec"><div class="tk"><b>NVDA</b><span class="chip hold">HOLD</span></div><span class="px">118.45</span><p>Valuation is stretched against its own history; nothing new to act on.</p></div>`;
 return `<div class="lastline">Last analysis: this morning</div><div class="recs">${auto}${manual}</div>`;
}

const NAMES={a:'A · A row in Preferences',b:'B · Its own card with a status',c:'C · The weekday strip'};
function render(){
 let h=`<div class="tag">${NAMES[D]}. Copy is the spec's, verbatim. Amounts and dates are sample data.</div>`;
 const states=[['off','Preferences: off (the default)'],['on','Preferences: on'],['limit','Preferences: paused, limit reached'],['key','Preferences: paused, no Claude key']];
 for(const [s,t] of states) h+=tag(t)+frame('pref','Preferences',prefs(s));
 h+=tag('Today: an automatic and a manual recommendation')+frame('today','Today',today());
 document.getElementById('root').innerHTML=h;
}
render();
window.saFinish=()=>{if(!PHONE)return;const items=[['Today','today'],['Portfolio','portfolio'],['Chat','chat'],['Track','track'],['Account','acct']];document.querySelectorAll('.frame').forEach(f=>{const on=f.dataset.active;f.insertAdjacentHTML('beforeend',`<div class="tabbar">${items.map(([l,i])=>`<div class="${i===on?'on':''}">${ic(i)}${l}</div>`).join('')}</div>`)})};
