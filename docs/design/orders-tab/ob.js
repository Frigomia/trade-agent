/* Orders tab: three directions (window.OB = a | b | c) of the Orders view and the four-segment Portfolio strip.
   Loads after shell.js (ic), cp.js (K, k, PHONE, SAFE, bar, pct, cpFinish), pn.js (side, head) and
   ../order-tickets/ot.js with OT='d' (L, LD, dRow, sheet: the approved order cards and the Record placed order sheet).
   Copy follows docs/superpowers/specs/2026-10-09-orders-tab-design.md. Numbers are sample data. */
(()=>{
const OB=window.OB||'a';
K.clock='<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>';
K.arrow='<path d="M5 12h14M13 6l6 6-6 6"/>';

// GET /plans/orders/open: the saved plans that still have an unplaced line, newest first, with only those lines. 4 open.
const OCT={m:'October 2026',s:'Oct 2026',d:'8 Oct',saved:'8 Oct 2026, 09:14',amt:'600.00',n:3,lines:[LD[1],LD[2]]};
const SEPT={m:'September 2026',s:'Sep 2026',d:'8 Sep',saved:'8 Sep 2026, 08:02',amt:'500.00',n:3,old:true,
 lines:[{...L[0],p:'53.12',sh:'1.738',wb:17.2,wa:18.1,tg:19}]};
const AUG={m:'August 2026',s:'Aug 2026',d:'4 Aug',saved:'4 Aug 2026, 19:40',amt:'450.00',n:3,old:true,
 lines:[{t:'CSSPX.MI',n:'iShares Core S&P 500 UCITS ETF USD (Acc)',amt:'250.00',sh:'0.436',p:'573.40',isin:'IE00B5BMR087',wb:0,wa:3.1,tg:10,why:'A new position that starts at 0 %',fresh:true}]};
const g=(p,o={})=>({p,lines:p.lines,...o});
const G0=[g(OCT,{open:0}),g(SEPT),g(AUG)];
const PLACED='IWDA.L recorded as placed. Next: NVDA, opened for you.';
const GONE='CSSPX.MI recorded as placed. It was the last open order of August 2026.';

/* ---------- the four-segment strip ---------- */
const badge=n=>n?`<b class="obadge num">${n>99?'99+':n}</b>`:'';
const LABELS={a:['Holdings','Plan','Saved','Orders'],b:['Holdings','This month','Saved','Orders'],c:['Holdings','Plan','Saved','Orders']};
function ostrip(a,n){
 const lab=PHONE?LABELS[OB]:['Holdings','This month','Saved plans','Orders'];
 return `<div class="pseg oseg oseg-${OB}" role="tablist">${lab.map((t,i)=>`<span role="tab" aria-selected="${i===a}" class="${i===a?'on':''}"${i===3&&n?` aria-label="Orders, ${n} open"`:''}>${t}${i===3?badge(n):''}</span>`).join('')}</div>`;
}

/* ---------- pieces shared by the three directions ---------- */
const cnt=n=>`<span class="cnt">, ${n} open</span>`;
const meta=(p,n)=>`Saved ${PHONE?p.d:p.saved} · ${p.amt} EUR plan · ${p.n-n} of ${p.n} placed`;
const copyAll=`<button class="btn ghost sm cab">${k('copy','sm')}Copy all lines</button>`;
const note=p=>p.old?`<p class="onote">${k('clock')}<span>Planned ${p.d}. Prices and weights have moved since; make a new plan if this is no longer what you want.</span></p>`:'';
const status=t=>`<p class="dnext" role="status">${k('check')}<span>${t}</span></p>`;
const DHEAD=`<div class="lr dr h"><span>Ticker</span><span>Why</span><span>Weight, before to after</span><span class="r">Amount, EUR</span><span></span><span></span></div>`;
const cards=x=>x.lines.map((l,i)=>dRow(l,{open:x.open===i})).join('');
const FOOT=`<p class="hint dfoot">Tap a line to open its order. After Placed, the next open line of that plan opens by itself.</p><div class="osafe">${SAFE}</div>`;
const ghead=x=>`<div class="ghead"><div class="gt"><h2>${x.p.m}${cnt(x.lines.length)}</h2><span class="hint num">${meta(x.p,x.lines.length)}</span></div>${copyAll}</div>`;

/* ---------- A · stacked plan sections, the plan heading sticks while its lines scroll ---------- */
const aView=(G,top='')=>`<div class="aorders">${top?status(top):''}${G.map(x=>`<section class="ogrp ${x.p.s.slice(0,3).toLowerCase()}">${ghead(x)}${x.status?status(x.status):''}${note(x.p)}<div class="panel led dled">${DHEAD}${cards(x)}</div></section>`).join('')}</div>${FOOT}`;

/* ---------- B · a plan selector chip row above one plan's cards ---------- */
function bView(G,sel=0,top=''){
 const x=G[sel],others=G.filter((_,i)=>i!==sel);
 const chips=`<div class="pchips" role="tablist" aria-label="Plans with open orders">${G.map((y,i)=>`<button role="tab" aria-selected="${i===sel}" class="pc ${i===sel?'on':''}">${y.p.old?`<span class="pcold" role="img" aria-label="Planned more than 14 days ago">${k('clock')}</span>`:''}<span>${PHONE?y.p.s:y.p.m}</span>${badge(y.lines.length)}</button>`).join('')}</div>`;
 const more=others.length?`<p class="hint more">Also open: ${others.map(y=>`${y.p.m} (${y.lines.length})`).join(', ')}.</p>`:'';
 return `${top?status(top):''}${chips}<section class="panel led dled bpl">${ghead(x)}${x.status?status(x.status):''}${note(x.p)}${DHEAD}${cards(x)}</section>${more}${FOOT}`;
}

/* ---------- C · collapsible plan groups: the newest open, older ones a one-line summary ---------- */
function cView(G,openIdx,top=''){
 return `${top?status(top):''}${G.map((x,i)=>{const op=openIdx.includes(i);
  const sum=x.lines.map(l=>`${l.t} ${l.amt} EUR`).join(' · ');
  return `<section class="panel led dled cg ${op?'open':''}"><div class="cgh"><button class="cgt" aria-expanded="${op}"><span class="cgchev">${k(op?'down':'right')}</span><span class="cgtx"><h2>${x.p.m}${cnt(x.lines.length)}</h2><span class="hint num">${op?meta(x.p,x.lines.length):sum}${x.p.old&&!op?` · <span class="cgold">${k('clock')}Planned ${x.p.d}</span>`:''}</span></span></button>${op?copyAll:''}</div>${op?`${x.status?status(x.status):''}${note(x.p)}${DHEAD}${cards(x)}`:''}</section>`}).join('')}${FOOT}`;
}

/* ---------- empty ---------- */
const EMPTY=`<section class="oempty ${OB==='a'?'':'panel'}"><h2>No open orders.</h2><p class="t2">Orders come from saving a plan. Make this month's plan and press Save plan; each of its lines then waits here until you mark it placed.</p><a class="lnkb golink">Go to This month${k('arrow','sm')}</a></section><div class="osafe">${SAFE}</div>`;

/* ---------- frames ---------- */
const VIEW={
 a:{view:()=>aView(G0),old:()=>aView([g(OCT),g(SEPT),g(AUG)]),placed:()=>aView([g(OCT,{lines:[LD[2]],open:0,status:PLACED}),g(SEPT),g(AUG)]),gone:()=>aView([g(OCT),g(SEPT)],GONE)},
 b:{view:()=>bView(G0,0),old:()=>bView([g(OCT),g(SEPT,{open:0}),g(AUG)],1),placed:()=>bView([g(OCT,{lines:[LD[2]],open:0,status:PLACED}),g(SEPT),g(AUG)],0),gone:()=>bView([g(OCT),g(SEPT)],0,GONE)},
 c:{view:()=>cView(G0,[0]),old:()=>cView([g(OCT),g(SEPT),g(AUG)],[1,2]),placed:()=>cView([g(OCT,{lines:[LD[2]],open:0,status:PLACED}),g(SEPT),g(AUG)],[0]),gone:()=>cView([g(OCT),g(SEPT)],[0],GONE)}}[OB];
const NAMES={a:'A · Stacked plan sections: every plan with open orders, newest first, one under the other; the plan heading sticks while its lines scroll',
 b:'B · Plan chips: a row of plan chips (month and open count) above the cards of one plan at a time',
 c:'C · Collapsible plan groups: the newest plan open, older ones folded to a one-line summary of their lines'};
const PH={a:'Phone labels: Holdings, Plan, Saved, Orders, equal widths, badge as a pill.',
 b:'Phone labels: Holdings, This month, Saved, Orders, each segment as wide as its label, badge as a pill.',
 c:'Phone labels: Holdings, Plan, Saved, Orders, equal widths, badge as a plain number.'};
const fr=(body,n,o={})=>`<div class="frame ${o.cls||''}" data-active="portfolio"${o.to?` data-to="${o.to}"`:''}>${side(true)}<main class="main">${head}${o.nostrip?'':ostrip(3,n)}${body}</main>${o.over||''}</div>`;
const stg=(s,t)=>`<div class="tag" data-st="${s}">${t}</div>`;
const spec=[[0,0,'0 open: no badge (Holdings shown)'],[1,0,'1 open'],[4,3,'4 open, on the Orders view'],[12,1,'12 open (This month shown)'],[120,3,'100 or more: 99+']];

let h=`<div class="tag">${NAMES[OB]}. Sample data: the open lines of three saved plans, 4 in total.</div>`;
h+=stg('strip',`(a) The four-segment strip and its badge, the open-line total. ${PH[OB]}`)+fr(spec.map(([n,a,t])=>`<div class="spec"><span class="lab">${t}</span>${ostrip(a,n)}</div>`).join(''),0,{nostrip:true});
h+=stg('view','(b) Orders: October 2026 first, its IWDA.L line opened (Copy, Placed, ticket, ISIN), Copy all lines per plan.')+fr(VIEW.view(),4);
h+=stg('old',OB==='a'?'(c) Scrolled to the older plans: the September heading sticks at the top; both older plans carry the note.':OB==='b'?'(c) September picked: the note above its line, the ticket still copies as written.':'(c) October folded, September and August unfolded: each older plan carries the note.')+fr(VIEW.old(),4,OB==='a'?{cls:'scr',to:'.ogrp.sep'}:{});
h+=stg('placed','(d) IWDA.L just placed: its card leaves, October drops to 1 open, NVDA opens by itself, the badge drops to 3.')+fr(VIEW.placed(),3);
h+=stg('gone','(d) The last open line of August placed: the August group is gone, the badge drops to 3.')+fr(VIEW.gone(),3);
h+=stg('sheet','Placed on IWDA.L opens the approved Record placed order sheet over the Orders view (drawer on desktop, bottom sheet on a phone).')+fr(VIEW.view(),4,{cls:'sf',over:sheet(1,'').replace('<span>8 Oct 2026</span>','<span>9 Oct 2026</span>')});
h+=stg('empty','(e) Nothing open: no badge, "No open orders." and where orders come from.')+fr(EMPTY,0);
document.getElementById('root').innerHTML=h;
document.querySelectorAll('[data-theme-btn]').forEach(e=>e.innerHTML=ic('sun'));
// A: the scrolled frame (real position: sticky inside a scrolling main)
window.obScroll=()=>document.querySelectorAll('.frame.scr').forEach(f=>{const m=f.querySelector('.main');m.scrollTop=f.querySelector(f.dataset.to).offsetTop});
addEventListener('load',()=>document.fonts.ready.then(obScroll));
})();
