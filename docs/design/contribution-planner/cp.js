/* Renders one direction (a | b | c) of the monthly contribution planner from the same copy and data.
   Copy follows docs/superpowers/specs/2026-10-08-contribution-planner-design.md. Tickers, prices, rates
   and weights are sample data, worked through the spec's calculation (500 EUR, pool 7,650 EUR). */
const K={alert:'<path d="M12 8v5M12 16.5v.01"/><path d="M10.3 4.3L2.5 18a2 2 0 0 0 1.7 3h15.6a2 2 0 0 0 1.7-3L13.7 4.3a2 2 0 0 0-3.4 0z"/>',check:'<path d="M5 12.5l4.5 4.5L19 7"/>',shield:'<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/><path d="M9 12l2 2 4-4"/>',trash:'<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',right:'<path d="M9 6l6 6-6 6"/>',down:'<path d="M6 9l6 6 6-6"/>',left:'<path d="M15 6l-6 6 6 6"/>',drift:'<path d="M3 17l6-6 4 4 8-8"/><path d="M15 7h6v6"/>'};
const k=(n,x='')=>`<svg class="i ${x}" viewBox="0 0 24 24">${K[n]}</svg>`;
const D=window.DIR||'a';
const PHONE=new URLSearchParams(location.search).get('view')==='phone';
document.body.classList.toggle('phone',PHONE);

const SAFE=`<p class="safe">${k('shield')}Advisory only. Nothing is sent to a broker.</p>`;
// lines of the October plan (POST /plans/preview {amount: 500, whole_shares: false})
const LINES=[
 {t:'SAP',n:'SAP SE',amt:'312.04',sh:'1.357',p:'229.95',cur:'EUR',wb:0.0,wa:3.8,tg:10,why:'A new position that starts at 0 %'},
 {t:'MSFT',n:'Microsoft',amt:'115.74',sh:'0.295',p:'392.18',cur:'USD',rate:'0.9226',wb:18.0,wa:18.4,tg:20,why:'Below its target, and its newest call is ADD or BUY'},
 {t:'KO',n:'Coca-Cola',amt:'72.22',sh:'1.144',p:'63.11',cur:'USD',rate:'0.9226',wb:8.1,wa:8.5,tg:10,why:'Below its target weight'},
];
// the same plan with "Whole shares only" on
const WHOLE=[
 {...LINES[0],amt:'229.95',sh:'1',wa:2.9},
 {...LINES[1],amt:'0.00',sh:'0',wa:17.4,zero:true},
 {...LINES[2],amt:'63.11',sh:'1',wa:8.6},
];
const NOTES=['NVDA is left out: no price available.','AAPL gets no money: its newest pending call is SELL.','1 holding has no target weight and is left out of the plan (VUSA).'];
const PLANS=[
 {y:'2026',m:'October 2026',d:'8 Oct 2026, 09:14',a:'500.00',n:3},
 {y:'2026',m:'September 2026',d:'1 Sep 2026, 08:02',a:'500.00',n:3},
 {y:'2026',m:'August 2026',d:'3 Aug 2026, 19:40',a:'450.00',n:3},
 {y:'2026',m:'July 2026',d:'1 Jul 2026, 07:55',a:'450.00',n:2},
];
const SEP=[
 {t:'EUNL',n:'iShares Core MSCI World',amt:'248.10',sh:'2.466',p:'100.61',cur:'EUR',wb:44.9,wa:45.9,tg:45,why:'Below its target weight'},
 {t:'MSFT',n:'Microsoft',amt:'156.65',sh:'0.385',p:'406.48',cur:'USD',rate:'0.9132',wb:16.8,wa:17.6,tg:20,why:'Below its target, and its newest call is ADD or BUY'},
 {t:'KO',n:'Coca-Cola',amt:'95.25',sh:'1.513',p:'62.95',cur:'USD',rate:'0.9132',wb:7.2,wa:8.1,tg:10,why:'Below its target weight'},
];
const shares=l=>l.zero?`Less than one whole share at ${l.p} EUR`:(l.sh==='1'||(+l.sh>=1&&!l.sh.includes('.'))?`${l.sh} share at ${l.p} EUR`:`about ${l.sh} shares at ${l.p} EUR`);
const fx=l=>l.cur==='EUR'?'EUR':`${l.cur}, 1 ${l.cur} = ${l.rate} EUR`;
const add=l=>l.zero?"Nothing added":`Add ${l.amt}`;
const sum=L=>L.reduce((a,l)=>a+(+l.amt),0).toFixed(2);
const pct=v=>v.toFixed(1)+' %';
const bar=l=>{const s=l.tg*1.6;return `<div class="wb" aria-hidden="true"><span class="af" style="width:${l.wa/s*100}%"></span><span class="bf" style="width:${l.wb/s*100}%"></span><span class="tg" style="left:${l.tg/s*100}%"></span></div>`};
const sw=on=>`<span class="sw ${on?'on':''}" role="switch" aria-checked="${on}"></span>`;
const tag=t=>`<div class="tag">${t}</div>`;
const frame=(act,h1,sub,body,right='')=>`<div class="frame" data-active="${act}"><main class="main"><div class="head"><div><h1>${h1}</h1>${sub?`<div class="sub">${sub}</div>`:''}</div><div class="actions">${right}<span class="theme" data-theme-btn></span></div></div>${body}</main></div>`;
const PSUB=`<a>Portfolio</a> / Plan`;
const notesList=(n=NOTES)=>`<ul class="notes">${n.map(x=>`<li>${k('alert')}<span>${x}</span></li>`).join('')}</ul>`;
const switchRow=(on)=>`<div class="opt"><div><b>Whole shares only</b><span class="hint">Round each line down to whole shares and show what is left over.</span></div>${sw(on)}</div>`;
const NOTARGET={h:'Set a target weight first',p:'The plan shares your money out by the weight you want each holding or watchlist ticker to have. Nothing has a target yet.',steps:['Open Portfolio and edit a holding, or add a ticker to the watchlist.','Fill in Target weight, for example 20 % for a fund you want to be a fifth of the portfolio.','Come back here and press Make plan.'],btn:'Go to Portfolio'};
const NOFUND={h:'Nothing to fund this month',p:'Every ticker with a target is left out, so the plan proposes nothing. Your 500.00 EUR stays with you.'};
const NOFUND_NOTES=['AAPL gets no money: its newest pending call is SELL.','MSFT gets no money: its newest pending call is TRIM.','NVDA is left out: no price available.'];
const emptyTargets=`<div class="panel empty"><h2>${NOTARGET.h}</h2><p class="t2">${NOTARGET.p}</p><ol>${NOTARGET.steps.map(s=>`<li>${s}</li>`).join('')}</ol><div><button class="btn sm">${NOTARGET.btn}</button></div>${SAFE}</div>`;
const emptyFund=`<div class="panel empty"><h2>${NOFUND.h}</h2><p class="t2">${NOFUND.p}</p>${notesList(NOFUND_NOTES)}<p class="hint">A plan comes back when a pending call changes or a price is available again. You can also set a target on another ticker.</p>${SAFE}</div>`;
const dialog=`<div class="scrim"><div class="dlg" role="dialog" aria-modal="true"><h2>Delete the September 2026 plan?</h2><p class="t2">It is removed from your saved plans (500.00 EUR, 3 lines). This cannot be undone.</p><div class="row"><button class="btn ghost sm">Cancel</button><button class="btn danger sm">Delete plan</button></div></div></div>`;

/* ---------------- A · one column, amount first ---------------- */
function aAmount(on,big='500.00'){return `<section class="panel aAmt"><div class="field"><label>Amount this month</label><div class="big"><span class="num">${big}</span><em>EUR</em></div><span class="hint">Your saved monthly amount. Change it here or in Preferences.</span></div>${switchRow(on)}<button class="btn">Make plan</button></section>`}
function aLines(L){return `<ol class="aLines">${L.map(l=>`<li class="${l.zero?'dim':''}"><div><span class="tk">${l.t}</span> <span class="nm">${l.n}</span><div class="why">${l.why}</div></div><div><div class="amt num">${add(l)}${l.zero?"":" EUR"}</div><div class="sh num">${shares(l)}</div></div><div class="w num">Weight <b>${pct(l.wb)}</b><span class="arrow">to</span><b>${pct(l.wa)}</b><span>· target ${l.tg} %</span></div></li>`).join('')}</ol>`}
function aResult(L,left){return `<section class="panel aRes"><div><h2>Add ${sum(L)} EUR across ${L.filter(l=>!l.zero).length} tickers</h2><p class="hint">Prices of 8 Oct 2026, 09:14, converted to EUR. Your targeted holdings are worth 7,650.00 EUR now.</p></div>${aLines(L)}${notesList()}<div class="aFoot"><span class="num">Leftover <b>${left} EUR</b></span><button class="btn">Save plan</button></div>${SAFE}</section>`}
function aHistory(open){return `<section class="panel aRes"><div class="split"><h2>Saved plans</h2><span class="hint">Newest first</span></div><ul class="aHist"><li class="yr">2026</li>${PLANS.map((p,i)=>`<li><div><b>${p.m}</b><div class="hint num">${p.a} EUR · ${p.n} lines · saved ${p.d}</div></div>${k(open&&i===1?'down':'right')}</li>${open&&i===1?`<li style="display:block;border:0;padding:0"><div class="aOpen"><p class="hint">As saved on 1 Sep 2026, with the prices and rates of that day.</p><div class="num">${SEP.map(l=>`<div class="ol"><span class="tk">${l.t}</span><b>Add ${l.amt} EUR</b><span class="hint">${shares(l)} · ${fx(l)}</span></div>`).join('')}</div><div class="row" style="justify-content:space-between"><span class="hint">Leftover 0.00 EUR</span><button class="btn ghost sm">${k('trash','sm')}Delete plan</button></div></div></li>`:''}`).join('')}</ul></section>`}

/* ---------------- B · split workspace with a history rail ---------------- */
function bForm(on){return `<div class="bForm"><div class="field"><label>Amount this month</label><div class="input num"><span>500.00</span><em>EUR</em></div></div>${switchRow(on)}<button class="btn">Make plan</button></div>`}
function bComp(L,left){const tot=500,seg=L.filter(l=>!l.zero).map((l,i)=>`<span class="s${i+1}" style="flex:${+l.amt}">${l.t}</span>`).join('');return `<div class="bComp"><div class="split"><h2>Where the 500.00 EUR goes</h2><span class="hint num">Pool now 7,650.00 EUR</span></div><div class="bBar num">${seg}${+left>0?`<span class="s4" style="flex:${left}">Leftover</span>`:''}</div></div>`}
function bCards(L){return `<div class="bCards">${L.map(l=>`<div class="bCard ${l.zero?'zero dim':''}"><div class="split"><span class="tk">${l.t}</span><span class="nm">${l.n}</span></div><div class="amt num">${add(l)}${l.zero?"":" EUR"}</div><div class="hint num">${shares(l)}</div>${bar(l)}<div class="w num"><span>Weight <b>${pct(l.wb)}</b> to <b>${pct(l.wa)}</b></span><span>target ${l.tg} %</span></div><div class="why">${l.why}</div></div>`).join('')}</div>`}
function bRail(sel){return `<aside class="panel rail ${sel==='cur'?'hideph':''}"><h2>Saved plans</h2><div class="ri cur ${sel==='cur'?'on':''}"><span>This month<small>Not saved yet</small></span></div><div class="yr">2026</div>${PLANS.map((p,i)=>`<div class="ri ${sel===i?'on':''}"><span>${p.m}<small class="num">${p.a} EUR · ${p.n} lines</small></span>${k('right','sm')}</div>`).join('')}</aside>`}
const seg=(a)=>`<div class="seg"><span class="${a?'on':''}">This month</span><span class="${a?'':'on'}">Saved plans (4)</span></div>`;
function bPlan(L,left,on){return `${seg(true)}<div class="bGrid"><section class="panel bMain">${bForm(on)}${bComp(L,left)}${bCards(L)}${notesList()}<div class="bFoot"><span class="num">Leftover <b>${left} EUR</b></span><button class="btn">Save plan</button></div>${SAFE}</section>${bRail('cur')}</div>`}
function bHistory(){return `${seg(false)}<div class="bGrid"><section class="panel bMain"><div class="split"><h2>September 2026</h2><button class="btn ghost sm">${k('trash','sm')}Delete plan</button></div><div class="saved">${k('check')}<span>Saved 1 Sep 2026, 08:02, with the prices and rates of that day.</span></div>${bComp(SEP,'0.00')}${bCards(SEP)}<div class="bFoot"><span class="num">Leftover <b>0.00 EUR</b></span><span class="hint">1 USD = 0.9132 EUR on that day</span></div>${SAFE}</section>${bRail(1)}</div>`}

/* ---------------- C · ledger ---------------- */
function cBar(on){return `<section class="panel cBar"><span class="lab">Amount this month</span><div class="input num"><span>500.00</span><em>EUR</em></div><div class="row" style="gap:10px"><span>Whole shares only</span>${sw(on)}</div><button class="btn">Make plan</button><span class="hint grow" style="text-align:right">Saved monthly amount, change it in Preferences</span></section>`}
function cRow(l,saved){return `<div class="lr"><div class="c1"><span class="tk">${l.t}</span><div class="nm">${l.n}</div></div><div class="c2 why">${l.why}</div><div class="c3 wcell">${bar(l)}<span class="t num"><b>${pct(l.wb)}</b> to <b>${pct(l.wa)}</b> · target ${l.tg} %</span></div><div class="c4 r num hint">${l.p} EUR${l.cur!=='EUR'?`<br>${l.cur} at ${l.rate}`:''}</div><div class="c5 r"><div class="amt num">${add(l)}</div><div class="hint num">${l.zero?'under 1 share':(l.sh.includes('.')?'about '+l.sh:l.sh)+' sh'}</div></div></div>`}
function cOut(t,n,why){return `<div class="lr out"><div class="c1"><span class="tk">${t}</span><div class="nm">${n}</div></div><div class="c2">${why}</div><div class="c3"></div><div class="c4"></div><div class="c5 r">0.00</div></div>`}
function cLedger(L,left,head='Amount, EUR'){return `<section class="panel led"><div class="lr h"><span>Ticker</span><span>Why</span><span>Weight, before to after</span><span class="r">Price in EUR</span><span class="r">${head}</span></div>${L.map(l=>cRow(l)).join('')}${cOut('AAPL','Apple','No money: its newest pending call is SELL.')}${cOut('NVDA','NVIDIA','Left out: no price available.')}<div class="lr tot"><div class="c1">Total</div><div class="c2 hint">Leftover ${left} EUR</div><div class="c3"></div><div class="c4"></div><div class="c5 r num">${sum(L)} EUR</div></div></section>`}
const legend=`<div class="legend"><span><i style="background:color-mix(in oklab,var(--accent-solid) 42%,var(--bg))"></i>weight before</span><span><i style="background:var(--accent-solid)"></i>added by this plan</span><span><i style="background:var(--text);width:2px;height:12px"></i>target</span></div>`;
function cPlan(L,left,on){return `${cBar(on)}${cLedger(L,left)}<div class="cUnder">${legend}<div class="row"><span class="hint">1 holding has no target weight and is left out (VUSA).</span><button class="btn">Save plan</button></div></div><div style="margin-top:12px">${SAFE}</div>`}
function cHistory(){return `<section class="panel led" style="margin-bottom:16px"><div class="hr h"><span>Month</span><span>Saved</span><span class="r">Amount</span><span class="r">Lines</span><span class="r"></span></div>${PLANS.map((p,i)=>`<div class="hr ${i===1?'on':''}"><div class="c1"><b>${p.m}</b></div><div class="c2 hint num">${p.d}</div><div class="c3 r num">${p.a} EUR</div><div class="c4 r num">${p.n}</div><div class="c5 r hint num">${i===1?'Open':'Open'}</div></div>`).join('')}</section><div class="split" style="margin-bottom:10px"><div><h2>September 2026, as saved</h2><p class="hint">Saved 1 Sep 2026, 08:02. Prices and rates of that day.</p></div><button class="btn ghost sm">${k('trash','sm')}Delete plan</button></div><section class="panel led"><div class="lr h"><span>Ticker</span><span>Why</span><span>Weight, before to after</span><span class="r">Price in EUR</span><span class="r">Amount, EUR</span></div>${SEP.map(l=>cRow(l,true)).join('')}<div class="lr tot"><div class="c1">Total</div><div class="c2 hint">Leftover 0.00 EUR</div><div class="c3"></div><div class="c4"></div><div class="c5 r num">500.00 EUR</div></div></section><div style="margin-top:12px">${SAFE}</div>`}

/* ---------------- Today drift card, per direction ---------------- */
function drift(){
 const s='AAPL is 7.2 points above its target, NVDA 6.1 below';
 if(D==='a') return `<section class="panel aRes" style="max-width:720px"><h2>Two holdings drifted from their target</h2><p class="t2">${s}.</p><a class="lnkb">Plan this month's contribution</a></section>`;
 if(D==='b') return `<section class="panel bMain" style="max-width:720px;flex-direction:row;align-items:center;gap:16px;flex-wrap:wrap"><span class="chip ok">${k('drift')}Drift</span><p class="grow t2" style="min-width:220px">${s}.</p><button class="btn ghost sm">Open the plan</button></section>`;
 const rows=[{t:'AAPL',wb:22.2,wa:22.2,tg:15,txt:'7.2 points above'},{t:'NVDA',wb:3.9,wa:3.9,tg:10,txt:'6.1 points below'}];
 return `<section class="panel led" style="max-width:720px"><div class="split" style="padding:10px 20px 8px"><h2>Away from target</h2><a class="lnkb">Open the plan</a></div>${rows.map(r=>`<div class="lr lr5" style="grid-template-columns:90px 1fr 140px"><span class="tk">${r.t}</span>${bar(r)}<span class="r num t2">${r.txt}</span></div>`).join('')}<p class="hint" style="padding:8px 20px 14px">${s}. Shown at 5 points or more (Preferences).</p></section>`;
}
const todayCtx=`<section class="panel recmini" style="max-width:720px;margin-bottom:16px"><div><span class="tk">MSFT</span> <span class="act">ADD</span><div class="hint">Pending · from this morning's analysis</div></div><button class="btn ghost sm">Review</button></section>`;

/* ---------------- targets and preferences, Telegram ---------------- */
const tfield=(v,hl)=>`<div class="field ${hl?'hl':''}"><label>Target weight</label><div class="input num ${v?'':'ph'}"><span>${v||'Optional'}</span><em>%</em></div><span class="hint">The share of the portfolio you want this ticker to reach. The plan uses it. 0 to 100, empty for none.</span></div>`;
const targets=`<div class="forms"><section class="panel fcard"><h2>Add to watchlist</h2><div class="field"><label>Ticker</label><div class="input"><span>SAP</span><em>SAP SE · XETRA</em></div></div>${tfield('10',true)}<div class="row"><button class="btn sm">Add to watchlist</button><button class="btn ghost sm">Cancel</button></div></section><section class="panel fcard"><h2>Edit holding</h2><div class="f2"><div class="field"><label>Ticker</label><div class="input"><span>MSFT</span></div></div><div class="field"><label>Shares</label><div class="input num"><span>3.52</span></div></div></div>${tfield('20',true)}<div class="row"><button class="btn sm">Save</button><button class="btn ghost sm">Cancel</button></div></section></div>`;
const prefs=`<div class="prefs"><section class="panel fcard"><h2>Monthly plan</h2><div class="f2"><div class="field"><label>Saved monthly amount</label><div class="input num"><span>500.00</span><em>EUR</em></div><span class="hint">Fills the amount on the Plan page. Leave empty to type it each month. 1 to 1,000,000.</span></div><div class="field"><label>Drift threshold</label><div class="input num"><span>5.0</span><em>points</em></div><span class="hint">Today shows a holding once it is this far from its target. 1 to 50.</span></div></div><div class="row"><button class="btn sm">Save</button><span class="hint">Only the fields you change are saved.</span></div></section><section class="panel fcard dim"><h2>Risk tolerance</h2><p class="hint">Existing preferences continue below.</p></section></div>`;
const tgSw=(b,h,on,nw)=>`<div class="opt"><div><b>${b}${nw?'<span class="new">New</span>':''}</b><span class="hint">${h}</span></div>${sw(on)}</div>`;
const telegram=`<div class="cWrap"><div class="panel cPanel"><div class="top"><h2>Telegram</h2><span class="chip ok">${k('check')}Connected</span></div>${tgSw('Morning digest','New recommendations from the automatic analysis.',true)}${tgSw('Price moves','Tickers that moved at least the threshold since the previous close.',true)}${tgSw('Monthly plan reminder','On the first weekday of each month, one line with a link to the Plan page. No amounts, no tickers.',true,true)}<div class="field"><label>Move threshold</label><div class="input num" style="width:120px"><span>5.0</span><em>%</em></div><span class="hint">1 to 50</span></div><div class="row" style="justify-content:space-between"><p class="hint grow">Messages list tickers and actions only, never amounts or reasoning. Advisory only.</p><button class="btn ghost sm">Disconnect</button></div></div><div class="pv"><span class="cap">The reminder, on the first weekday</span><div class="chat"><span class="who">trade-agent bot</span><div class="bubble"><span>Plan this month's contribution: <span class="lnk">https://trade-agent-navy.vercel.app/portfolio/plan</span></span><span>Open Today: <span class="lnk">https://trade-agent-navy.vercel.app/today</span></span><span class="foot">Advisory only. Nothing is sent to a broker.</span></div><span class="time">07:31</span></div></div></div>`;

const NAMES={a:'A · One column: amount first, the plan reads top to bottom',b:'B · Split workspace: the plan beside a rail of saved plans',c:'C · Ledger: one table of lines with inline weight bars'};
function render(){
 let h=tag(`${NAMES[D]}. Sample data: 500 EUR, targeted holdings worth 7,650 EUR.`);
 const P=(t,b,right='')=>tag(t)+frame('portfolio','Plan',PSUB,b,right);
 const histBtn=`<button class="btn ghost sm" style="margin-right:4px">Saved plans</button>`;
 if(D==='a'){
  h+=P('Plan: result',`<div class="aCol">${aAmount(false)}${aResult(LINES,'0.00')}</div>`,histBtn);
  h+=P('Plan: Whole shares only on',`<div class="aCol">${aAmount(true)}${aResult(WHOLE,'206.94')}</div>`,histBtn);
  h+=P('Empty: no target weights yet',`<div class="aCol">${emptyTargets}</div>`);
  h+=P('Empty: nothing to fund',`<div class="aCol">${aAmount(false)}${emptyFund}</div>`);
  h+=P('History: saved plans, September opened',`<div class="aCol">${aHistory(true)}</div>`);
  h+=P('History: delete, with confirm',`<div class="aCol">${aHistory(true)}</div>${dialog}`);
 }
 if(D==='b'){
  h+=P('Plan: result',bPlan(LINES,'0.00',false));
  h+=P('Plan: Whole shares only on',bPlan(WHOLE,'206.94',true));
  h+=P('Empty: no target weights yet',`${seg(true)}<div class="bGrid">${emptyTargets}${bRail('cur')}</div>`);
  h+=P('Empty: nothing to fund',`${seg(true)}<div class="bGrid"><div style="display:flex;flex-direction:column;gap:16px"><section class="panel bMain">${bForm(false)}</section>${emptyFund}</div>${bRail('cur')}</div>`);
  h+=P('History: September opened from the rail',bHistory());
  h+=P('History: delete, with confirm',bHistory()+dialog);
 }
 if(D==='c'){
  const tabs=a=>`<div class="seg" style="display:flex;max-width:360px;border:1px solid var(--line2);border-radius:12px;padding:3px;margin-bottom:14px">${['This month','Saved plans'].map((t,i)=>`<span class="${i===a?'on':''}" style="flex:1;text-align:center;padding:8px;border-radius:9px;font-size:13px;${i===a?'background:var(--up-bg);color:var(--accent);font-weight:650':'color:var(--muted)'}">${t}</span>`).join('')}</div>`;
  h+=P('Plan: result',tabs(0)+cPlan(LINES,'0.00',false));
  h+=P('Plan: Whole shares only on',tabs(0)+cPlan(WHOLE,'206.94',true));
  h+=P('Empty: no target weights yet',tabs(0)+emptyTargets);
  h+=P('Empty: nothing to fund',tabs(0)+cBar(false)+emptyFund);
  h+=P('History: saved plans, September opened',tabs(1)+cHistory());
  h+=P('History: delete, with confirm',tabs(1)+cHistory()+dialog);
 }
 h+=tag('Today: the drift card (only when GET /plans/drift returns something)')+frame('today','Today','',todayCtx+drift());
 h+=tag('Targets: the watchlist add form gets the same field the holding form has')+frame('portfolio','Portfolio','',targets);
 h+=tag('Preferences: the saved monthly amount and the drift threshold')+frame('pref','Preferences','',prefs);
 h+=tag('Account: the Telegram panel (approved direction C) with the third switch and a sample reminder')+frame('acct','Account','',telegram);
 document.getElementById('root').innerHTML=h;
}
render();
window.cpFinish=()=>{if(!PHONE)return;const items=[['Today','today'],['Portfolio','portfolio'],['Chat','chat'],['More','pref']];const map={acct:'pref'};document.querySelectorAll('.frame').forEach(f=>{const on=map[f.dataset.active]||f.dataset.active;f.insertAdjacentHTML('beforeend',`<div class="tabbar">${items.map(([l,i])=>`<div class="${i===on?'on':''}">${ic(i)}${l}</div>`).join('')}</div>`)})};
