/* Order tickets: four directions (window.OT = a | b | c | d) on the approved Portfolio views and saved-plan ledger.
   Loads after shell.js (ic, I), cp.js (k, K, PHONE, bar, pct, SAFE, cpFinish) and pn.js (side, strip, head).
   Copy follows docs/superpowers/specs/2026-10-09-order-tickets-design.md. Numbers are sample data. */
Object.assign(K,{
 copy:'<rect x="8" y="8" width="12" height="12" rx="2.5"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>',
 cal:'<rect x="3.5" y="5" width="17" height="15.5" rx="2"/><path d="M8 3v4M16 3v4M3.5 10h17"/>',
 circ:'<circle cx="12" cy="12" r="8.5"/>',
 done:'<circle cx="12" cy="12" r="9"/><path d="M8 12.3l2.8 2.8L16.2 9.6"/>',
 x:'<path d="M18 6L6 18M6 6l12 12"/>',
 lock:'<rect x="5" y="10.5" width="14" height="10" rx="2"/><path d="M8.5 10.5V7.5a3.5 3.5 0 0 1 7 0v3"/>'});
const OT=window.OT||'a';

// The October plan, saved 8 Oct 2026 (600.00 EUR, 3 lines). NVDA starts a new position and has no ISIN yet.
const L=[
 {t:'EIMI.L',n:'iShares Core MSCI EM IMI UCITS ETF USD (Acc)',amt:'92.30',sh:'1.69',p:'54.64',isin:'IE00BKM4GZ66',wb:17.9,wa:18.4,tg:19,why:'Below its target weight',chip:'Placed 8 Oct · 1.69 sh at 54.60'},
 {t:'IWDA.L',n:'iShares Core MSCI World UCITS ETF USD (Acc)',amt:'407.70',sh:'2.772',p:'147.07',isin:'IE00B4L5Y983',wb:26.4,wa:29.4,tg:30,why:'Below its target weight',chip:'Placed 8 Oct · 2.772 sh at 147.20'},
 {t:'NVDA',n:'NVIDIA Corporation',amt:'100.00',sh:'0.86',p:'116.31',isin:null,wb:0,wa:1.8,tg:5,why:'A new position that starts at 0 %',chip:'Placed 8 Oct · 0.86 sh at 134.20',fresh:true},
];
const NOTE_A=`<span class="sr" aria-live="polite">Copied to the clipboard</span>`;

/* ---------- pieces shared by the three directions ---------- */
const esc=s=>s.replace(/&/g,'&amp;').replace(/</g,'&lt;');
// the ticket, one plain-text string; spans only colour the parts
function ticket(l,isin=l.isin){return `<span class="tw">Order (amount):</span> <b>${l.amt} EUR</b> · ${esc(l.n)}${isin?` · <span class="isin">ISIN ${isin}</span>`:''} · about ${l.sh} shares at ${l.p} EUR`}
const copyBtn=(st)=>st==='copied'?`<button class="cbtn ok">${k('check')}Copied</button>${NOTE_A}`:`<button class="cbtn" ${st==='dis'?'disabled':''}>${k('copy')}Copy</button>`;
const placedBtn=(cls='')=>`<button class="btn ghost sm pbtn ${cls}">${k('circ')}Placed</button>`;
const chip=l=>`<span class="chip ok pchip">${k('check')}${l.chip}</span>`;
const addIsinLink=`<button class="isinlnk">Add ISIN</button>`;
// Add ISIN, five states
function isinUI(st){
 if(st==='empty')return addIsinLink;
 const v={open:'',typing:'US67066G104',error:'US67066G1041'}[st];
 const err=st==='error';
 return `<div class="isinf ${err?'err':''}"><div class="field"><label>ISIN for NVDA</label><div class="input num ${v?'':'ph'}"><span>${v||'12 characters'}${st!=='open'?'<i class="caret"></i>':'<i class="caret"></i>'}</span><em>${v.length} of 12</em></div>${err?`<span class="ferr">${k('alert')}Not a valid ISIN: 12 characters with a correct check digit.</span>`:`<span class="hint">Found on your broker's page for the instrument. It is added to every ticket for NVDA.</span>`}</div><div class="row"><button class="btn sm" ${st==='open'||st==='typing'?'disabled':''}>Save ISIN</button><button class="btn ghost sm">Cancel</button></div></div>`;
}
const savedIsin=`<span class="chip ok">${k('check')}ISIN saved</span>`;

function savedHead(view){
 if(view==='month')return `<div class="shead"><div class="banner">${k('check')}<span><b>Plan saved.</b> Copy each order into your broker app, place it there, then press Placed here.</span></div></div><div class="ptitle"><h2>October 2026</h2><span class="hint num">Saved 8 Oct 2026, 09:14 · 600.00 EUR · 3 lines</span></div>`;
 return `<div class="ptitle"><div><h2>October 2026, as saved</h2><span class="hint num">Saved 8 Oct 2026, 09:14, with the prices and rates of that day.</span></div><button class="btn ghost sm">${k('trash','sm')}Delete plan</button></div>`;
}
// placed: array of booleans; returns the Copy all bar
function copyAll(placed,label='Orders'){
 const n=placed.filter(Boolean).length,all=n===placed.length;
 const prog=`<span class="prog" aria-hidden="true">${placed.map(p=>`<i class="${p?'on':''}"></i>`).join('')}</span>`;
 return `<div class="cabar ${all?'all':''}"><div class="cal">${all?`<b class="alldone">${k('done')}All lines placed</b>`:`<b>${label}</b>`}<span class="hint num">${n} of ${placed.length} placed</span>${prog}</div><button class="btn ghost sm" ${all?'disabled':''}>${k('copy','sm')}Copy all lines</button></div>`;
}

/* ---------- A · ticket under each ledger line ---------- */
function aRow(l,o){
 const placed=o.placed,cp=o.copied?'copied':'';
 const isin=o.isin||(l.isin?null:'empty');
 const ticketTxt=o.isin==='saved'?ticket(l,'US67066G1040'):ticket(l);
 return `<div class="lr tl ${placed?'settled':''}"><div class="c1"><span class="tk">${l.t}</span><div class="nm">${l.fresh?'New position':'Holding'}</div></div><div class="c2 why">${l.why}</div><div class="c3 wcell">${bar(l)}<span class="t num"><b>${pct(l.wb)}</b> to <b>${pct(l.wa)}</b> · target ${l.tg} %</span></div><div class="c4 r num hint">${l.p} EUR</div><div class="c5 r"><div class="amt num">${l.amt}</div><div class="hint num">about ${l.sh} sh</div></div></div>
 <div class="tstrip ${placed?'settled':''}"><p class="ttext num">${ticketTxt}${isin==='empty'?' '+addIsinLink:''}${o.isin==='saved'?' '+savedIsin:''}</p>${isin&&isin!=='empty'&&isin!=='saved'?isinUI(isin):''}<div class="tact">${placed?`${chip(l)}${copyBtn('')}`:`${copyBtn(cp)}${placedBtn()}`}</div></div>`;
}
function aPlanT(placed,o={}){
 const head=`<div class="lr h"><span>Ticker</span><span>Why</span><span>Weight, before to after</span><span class="r">Price in EUR</span><span class="r">Amount, EUR</span></div>`;
 return `${copyAll(placed)}<section class="panel led aled">${head}${L.map((l,i)=>aRow(l,{placed:placed[i],copied:o.copied===i,isin:i===2?o.isin:undefined})).join('')}<div class="lr tot"><div class="c1">Total</div><div class="c2 hint">Leftover 0.00 EUR</div><div class="c3"></div><div class="c4"></div><div class="c5 r num">600.00 EUR</div></div></section><div style="margin-top:12px">${SAFE}</div>`;
}

/* ---------- B · an Orders checklist above the untouched ledger ---------- */
function bItem(l,o){
 const placed=o.placed,isin=o.isin||(l.isin?null:'empty');
 const ticketTxt=o.isin==='saved'?ticket(l,'US67066G1040'):ticket(l);
 return `<li class="oi ${placed?'settled':''}"><span class="mark" aria-label="${placed?'Placed':'Not placed yet'}">${k(placed?'done':'circ')}</span><div class="ob"><div class="oh"><span class="tk">${l.t}</span>${l.fresh?'<span class="newp">New position</span>':''}<span class="oamt num">${l.amt} EUR</span></div><p class="ttext num">${ticketTxt}${isin==='empty'?' '+addIsinLink:''}${o.isin==='saved'?' '+savedIsin:''}</p>${isin&&isin!=='empty'&&isin!=='saved'?isinUI(isin):''}${placed?`<div class="tact">${chip(l)}</div>`:''}</div><div class="oact">${placed?copyBtn(''):`${copyBtn(o.copied?'copied':'')}${placedBtn()}`}</div></li>`;
}
function bLedger(){return `<section class="panel led"><div class="lr h"><span>Ticker</span><span>Why</span><span>Weight, before to after</span><span class="r">Price in EUR</span><span class="r">Amount, EUR</span></div>${L.map(l=>`<div class="lr"><div class="c1"><span class="tk">${l.t}</span><div class="nm">${l.n.length>24?l.n.slice(0,22)+'…':l.n}</div></div><div class="c2 why">${l.why}</div><div class="c3 wcell">${bar(l)}<span class="t num"><b>${pct(l.wb)}</b> to <b>${pct(l.wa)}</b> · target ${l.tg} %</span></div><div class="c4 r num hint">${l.p} EUR</div><div class="c5 r"><div class="amt num">${l.amt}</div><div class="hint num">about ${l.sh} sh</div></div></div>`).join('')}<div class="lr tot"><div class="c1">Total</div><div class="c2 hint">Leftover 0.00 EUR</div><div class="c3"></div><div class="c4"></div><div class="c5 r num">600.00 EUR</div></div></section>`}
function bPlanT(placed,o={}){
 return `<section class="panel orders">${copyAll(placed,'Orders to place')}<ol class="olist">${L.map((l,i)=>bItem(l,{placed:placed[i],copied:o.copied===i,isin:i===2?o.isin:undefined})).join('')}</ol><div class="ofoot">${SAFE}</div></section><div class="ptitle sm"><h3>Plan details</h3><span class="hint">How the 600.00 EUR was shared out</span></div>${o.noLedger?'':bLedger()}`;
}

/* ---------- C · expandable rows: the ticket opens on tap ---------- */
function cRowX(l,o){
 const placed=o.placed,open=o.open,isin=o.isin||(l.isin?null:'empty');
 const ticketTxt=o.isin==='saved'?ticket(l,'US67066G1040'):ticket(l);
 const st=placed?chip(l):`<span class="chip none">Not placed</span>`;
 const row=`<div class="lr xr ${placed?'settled':''} ${open?'open':''}" aria-expanded="${!!open}"><div class="c1"><span class="tk">${l.t}</span><div class="nm">${l.fresh?'New position':'Holding'}</div></div><div class="c3 wcell">${bar(l)}<span class="t num"><b>${pct(l.wb)}</b> to <b>${pct(l.wa)}</b> · target ${l.tg} %</span></div><div class="c5 r"><div class="amt num">${l.amt}</div><div class="hint num">about ${l.sh} sh</div></div><div class="c6">${st}</div><span class="chev">${k(open?'down':'right')}</span></div>`;
 if(!open)return row;
 return row+`<div class="xpanel"><div class="slip"><div class="sliph"><span class="lab">Ticket</span>${copyBtn(o.copied?'copied':'')}</div><p class="ttext num">${ticketTxt}</p></div><div class="xside"><div class="xmeta"><span class="lab">ISIN</span>${l.isin?`<span class="num">${l.isin}</span>`:o.isin==='saved'?`<span class="num">US67066G1040</span>${savedIsin}`:isin==='empty'?`<span class="muted">None saved</span> ${addIsinLink}`:''}</div>${isin&&isin!=='empty'&&isin!=='saved'?isinUI(isin):''}<div class="xmeta"><span class="lab">Why</span><span class="t2">${l.why}</span></div>${placed?'':`<button class="btn sm pbtn">${k('circ')}Placed</button>`}</div></div>`;
}
function cPlanT(placed,o={}){
 const head=`<div class="lr xr h"><span>Ticker</span><span>Weight, before to after</span><span class="r">Amount, EUR</span><span>Order</span><span></span></div>`;
 return `${copyAll(placed)}<section class="panel led cled">${head}${L.map((l,i)=>cRowX(l,{placed:placed[i],open:o.open===i,copied:o.copied===i,isin:i===2?o.isin:undefined})).join('')}<div class="lr xr tot"><div class="c1">Total</div><div class="c3 hint">Leftover 0.00 EUR</div><div class="c5 r num">600.00 EUR</div><div class="c6"></div><span></span></div></section><p class="hint" style="margin:10px 2px 0">Tap a line to see its ticket.</p><div style="margin-top:8px">${SAFE}</div>`;
}

/* ---------- D · hybrid: the approved ledger row as a card; opening it shows Copy, Placed, the ticket and the ISIN ---------- */
K.up='<path d="M6 15l6-6 6 6"/>';
// D's NVDA after-weight fits the pool the IWDA.L numbers imply (about 7,710 EUR before, 8,310 after: 100 EUR is 1.2 %)
const LD=L.map(l=>l.fresh?{...l,wa:1.2,chip:'Placed 8 Oct · 0.86 sh at 116.40'}:l);
// the ISIN row inside an opened line: have one, none (Add ISIN), saved just now, or the field (typing / error)
function dIsin(l,st){
 if(st==='typing'||st==='error')return isinUI(st);
 const v=l.isin?`<span class="num">${l.isin}</span>`:st==='saved'?`<span class="num">US67066G1040</span>${savedIsin}`:`<span class="muted">None saved</span>${addIsinLink}`;
 return `<div class="xmeta"><span class="lab">ISIN</span>${v}</div>`;
}
const dSlip=(l,st)=>`<div class="slip"><span class="lab">Ticket, the text Copy copies</span><p class="ttext num">${st==='saved'?ticket(l,'US67066G1040'):ticket(l)}</p></div>`;
function dRow(l,o){
 const placed=o.placed,open=!!o.open,st=o.isin||'empty';
 const label=`${l.t}, ${l.amt} EUR, ${placed?'placed 8 Oct':'not placed'}, press to ${open?'close':'open'}`;
 const w=placed?`<span class="c3 dset num">${l.chip}</span>`
  :`<span class="c3 wcell">${bar(l).replace(/<(\/?)div/g,'<$1span')}<span class="t num"><b>${pct(l.wb)}</b> to <b>${pct(l.wa)}</b> · target ${l.tg} %</span></span>`;
 const card=`<button class="lr dr dcard ${placed?'settled':''}" aria-expanded="${open}" aria-label="${label}"><span class="c1"><span class="tk">${l.t}</span><span class="nm">${esc(l.n)}</span></span><span class="c2 why">${l.why}</span>${w}<span class="c5 r"><span class="amt num">${l.amt}<i class="cur"> EUR</i></span><span class="hint num">about ${l.sh} sh</span></span><span class="dmark ${placed?'on':''}" aria-hidden="true">${placed?k('check'):''}</span><span class="dchev" aria-hidden="true">${k(open?'up':'down')}</span></button>`;
 if(!open)return card;
 const acts=placed?'':`<div class="dacts">${copyBtn(o.copied?'copied':'')}<button class="btn pbtn">${k('circ')}Placed</button></div>`;
 return card+`<div class="dpanel ${placed?'ro':''}">${acts}${dSlip(l,st)}${dIsin(l,st)}</div>`;
}
function dPlanT(placed,o={}){
 const head=`<div class="lr dr h"><span>Ticker</span><span>Why</span><span>Weight, before to after</span><span class="r">Amount, EUR</span><span></span><span></span></div>`;
 const next=o.next?`<p class="dnext" role="status">${k('check')}<span>EIMI.L recorded as placed. Next: IWDA.L, opened for you.</span></p>`:'';
 return `<div class="dwrap">${copyAll(placed)}${next}<section class="panel led dled">${head}${LD.map((l,i)=>dRow(l,{placed:placed[i],open:o.open===i,copied:o.copied===i})).join('')}<div class="lr dr tot"><span class="c1">Total</span><span class="c2 hint">Leftover 0.00 EUR</span><span class="c3"></span><span class="c5 r num">600.00 EUR</span><span></span><span></span></div></section><p class="hint dfoot">Tap a line to open its order. After Placed, the next open line opens by itself.</p><div style="margin-top:8px">${SAFE}</div></div>`;
}
// the D frames: (a) none placed, (b) EIMI.L open with Copied, (c) Add ISIN on NVDA, (d) auto-advance, (e) all placed
function dFrames(){
 const st=(s,t)=>`<div class="tag" data-st="${s}">${t}</div>`;
 const nv=LD[2];
 let h=st('a','(a) Saved plan, none placed. Shown on This month right after Save plan. Every line is the approved ledger row with an open status circle; tap a line to open it.')+oframe(1,savedHead('month')+dPlanT(none));
 h+=st('b','(b) EIMI.L opened: Copy and Placed side by side, Copy just pressed shows "Copied" in place, then the ticket and the ISIN.')+oframe(1,savedHead('month')+dPlanT(none,{open:0,copied:0}));
 h+=st('c','(c) Add ISIN inside the opened NVDA line: empty, typing, wrong check digit, saved.')+`<div class="frame isinf-frame" data-active="portfolio">${side(true)}<main class="main"><div class="ilab">Empty: NVDA opened, no ISIN saved yet</div><section class="panel led dled">${dRow(nv,{open:true})}</section><div class="ilab">Typing (11 of 12)</div><div class="dvar">${isinUI('typing')}</div><div class="ilab">Wrong check digit</div><div class="dvar">${isinUI('error')}</div><div class="ilab">Saved: Copy now copies the ticket with ISIN US67066G1040</div><div class="dvar dpanel ro">${dIsin(nv,'saved')}</div></main></div>`;
 h+=st('d','(d) Right after Placed on EIMI.L: it settles with a check and its placed line, and IWDA.L, the next open line, opens by itself.')+oframe(2,savedHead('saved')+dPlanT(one,{open:1,next:true}));
 h+=st('e','(e) All placed: "All lines placed", Copy all lines disabled. A placed line still opens to show its ticket, with no buttons (EIMI.L here).')+oframe(2,savedHead('saved')+dPlanT(all,{open:0}));
 const under=savedHead('saved')+dPlanT(none);
 h+=otag('Record placed order, an existing holding: shares prefilled, price empty, date today.')+oframe(2,under,sheet(0,''),'sf');
 h+=otag('Record placed order, a new position (NVDA): the extra Asset type choice.')+oframe(2,under,sheet(2,''),'sf');
 h+=otag('Error 422: an invalid number. The sheet stays open with the message.')+oframe(2,under,sheet(0,'422'),'sf');
 h+=otag('Error 409: the line is already placed (for example placed from another tab). Record order is disabled.')+oframe(2,under,sheet(0,'409'),'sf');
 return h;
}

/* ---------- the Record placed order sheet ---------- */
function sheet(i,st){
 const l=L[i],nw=!!l.fresh;
 const priceV=st==='422'?'0':'';
 const alert=st==='409'?`<div class="alert">${k('alert')}<div><b>Already placed.</b> This line was recorded as placed on 8 Oct 2026, 09:31, so nothing was recorded again. Close this and the plan shows it.</div></div>`
  :st==='422'?`<div class="alert">${k('alert')}<div><b>Not recorded.</b> The price must be a number above 0.</div></div>`:'';
 const planned=OT==='b'?`<div class="cmp num"><div><span class="lab">Planned</span><b>about ${l.sh} shares</b><span class="hint">at ${l.p} EUR, the plan's price on 8 Oct</span></div><div><span class="lab">You record</span><b>what your broker filled</b><span class="hint">shares and price from the order confirmation</span></div></div>`
  :OT==='c'||OT==='d'?`<div class="slip mini"><span class="lab">The ticket you copied</span><p class="ttext num">${ticket(l)}</p></div>`
  :`<p class="t2 lead">${l.t} · ${esc(l.n)}<br><span class="hint num">Planned: ${l.amt} EUR, about ${l.sh} shares at ${l.p} EUR</span></p>`;
 const type=nw?`<div class="field"><label>Asset type</label><div class="seg2" role="radiogroup"><span role="radio" aria-checked="false">ETF</span><span role="radio" aria-checked="true" class="on">${k('check','sm')}Stock</span></div><span class="hint">NVDA is not a holding yet. Recording this order adds it to your holdings. Prefilled from your watchlist.</span></div>`:'';
 return `<div class="scrim2"></div><aside class="sheet" role="dialog" aria-modal="true" aria-labelledby="st${i}"><span class="grab" aria-hidden="true"></span><div class="sh-h"><h2 id="st${i}">Record placed order</h2><span class="xb" aria-label="Close">${k('x')}</span></div>${planned}
 <div class="f2s"><div class="field"><label>Ticker</label><div class="input fixed"><span class="tk">${l.t}</span><em>${k('lock','sm')}Fixed</em></div></div>
 <div class="field"><label>Date</label><div class="input num"><span>8 Oct 2026</span><em>${k('cal','sm')}</em></div><span class="hint">Today</span></div></div>
 <div class="field"><label>Shares</label><div class="input num"><span>${l.sh}</span><em>shares</em></div><span class="hint">From the plan. Change it if your broker filled a different number.</span></div>
 <div class="field ${st==='422'?'bad':''}"><label>Price per share</label><div class="input num ${priceV?'':'blank'}"><span>${priceV}<i class="caret"></i></span><em>per share</em></div>${st==='422'?`<span class="ferr">${k('alert')}Enter a price above 0.</span>`:`<span class="hint">Price in the currency of this holding</span>`}</div>
 ${type}${alert}
 <p class="safe">${k('shield')}This only records an order you placed yourself. Nothing is sent to a broker.</p>
 <div class="sh-f"><button class="btn ghost">Cancel</button><button class="btn" ${st==='409'?'disabled':''}>Record order</button></div></aside>`;
}

/* ---------- frames ---------- */
const OT_NAMES={a:'A · Ticket under each line: the ledger stays, every line carries its order text right below it',
 b:'B · Orders checklist: a separate list to tick off above the untouched ledger',
 c:'C · Expandable rows: a compact ledger with an Order column; the ticket opens on tap',
 d:'D · Hybrid: the approved ledger row as a card with a status mark; opening it shows Copy, Placed, the ticket and the ISIN, and after Placed the next line opens by itself'};
const PLAN={a:aPlanT,b:bPlanT,c:cPlanT,d:dPlanT}[OT];
function oframe(sub,body,overlay='',cls=''){return `<div class="frame ${cls}" data-active="portfolio">${side(true)}<main class="main">${head}${strip(sub)}${body}</main>${overlay}</div>`}
const otag=t=>`<div class="tag">${t}</div>`;
const none=[false,false,false],one=[true,false,false],all=[true,true,true];
let h=otag(`${OT_NAMES[OT]}. Sample data: the October plan, 600.00 EUR over 3 lines.`);
if(OT==='d')h+=dFrames();else{
const o0=OT==='c'?{open:0,copied:0}:{copied:0};
h+=otag('Saved plan, none placed. Shown on This month right after Save plan. EIMI.L Copy was just pressed: "Copied".')+oframe(1,savedHead('month')+PLAN(none,o0));
h+=otag('One placed: EIMI.L is settled with its status chip. Copy all lines now copies the two open lines.')+oframe(2,savedHead('saved')+PLAN(one,OT==='c'?{open:1}:{}));
h+=otag('All placed: "All lines placed", Copy all lines disabled.')+oframe(2,savedHead('saved')+PLAN(all,{}));
const under=savedHead('saved')+PLAN(none,OT==='c'?{open:0}:{});
h+=otag('Record placed order, an existing holding: shares prefilled, price empty, date today.')+oframe(2,under,sheet(0,''),'sf');
h+=otag('Record placed order, a new position (NVDA): the extra Asset type choice.')+oframe(2,under,sheet(2,''),'sf');
h+=otag('Error 422: an invalid number. The sheet stays open with the message.')+oframe(2,under,sheet(0,'422'),'sf');
h+=otag('Error 409: the line is already placed (for example placed from another tab). Record order is disabled.')+oframe(2,under,sheet(0,'409'),'sf');
// Add ISIN on the NVDA line, five states
const ist=[['empty','Add ISIN: empty, the link sits on the ticket'],['open','Add ISIN: the field is open'],['typing','Add ISIN: typing (11 of 12)'],['error','Add ISIN: wrong check digit'],['saved','Add ISIN: saved, the ticket now carries the ISIN']];
const one2=s=>OT==='a'?`<section class="panel led aled">${aRow(L[2],{isin:s})}</section>`:OT==='b'?`<section class="panel orders"><ol class="olist">${bItem(L[2],{isin:s})}</ol></section>`:`<section class="panel led cled">${cRowX(L[2],{open:true,isin:s})}</section>`;
h+=otag('Add ISIN, inline on the NVDA ticket')+`<div class="frame isinf-frame" data-active="portfolio">${side(true)}<main class="main">${ist.map(([s,t])=>`<div class="ilab">${t.replace('Add ISIN: ','').replace(/^./,c=>c.toUpperCase())}</div>${one2(s)}`).join('')}</main></div>`;
}
document.getElementById('root').innerHTML=h;
document.querySelectorAll('[data-theme-btn]').forEach(e=>e.innerHTML=ic('sun'));
