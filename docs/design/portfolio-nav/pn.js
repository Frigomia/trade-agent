/* Portfolio with Plan as a view of it. ?v=holdings|month|saved, plus ?theme=light and &view=phone.
   Reuses ic() from shell.js and the approved ledger (cPlan, cHistory, LINES, k) from cp.js. */
Object.assign(I,{
 plan:'<rect x="3" y="4.5" width="18" height="16.5" rx="2"/><path d="M8 2.5v4M16 2.5v4M3 10h18M9 15.5l2 2 4-4"/>',
 users:'<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.6a3.5 3.5 0 0 1 0 6.8M21.5 20a6.5 6.5 0 0 0-4-6"/>',
 gauge:'<path d="M12 14l4-4"/><path d="M3.3 19a10 10 0 1 1 17.4 0"/>',
 pencil:'<path d="M16.5 3.5l4 4L8 20H4v-4z"/>',x:'<path d="M18 6L6 18M6 6l12 12"/>',ok:'<path d="M5 12.5l4.5 4.5L19 7"/>'});
const V=new URLSearchParams(location.search).get('v')||'holdings';

const H=[
 {t:'CSNDX.SW',n:'iShares NASDAQ 100 UCITS ETF USD (Acc)',sh:'1.407274',s1:'1.4',avg:'1,492.38',p:'1,779.40',v:'2,504.10',pl:'+403.92',pp:'+19.2%',w:51.7,tg:51},
 {t:'EIMI.L',n:'iShares Core MSCI EM IMI UCITS ETF USD (Acc)',sh:'16.626731',s1:'16.6',avg:'48.06',p:'54.64',v:'908.48',pl:'+109.40',pp:'+13.7%',w:18.8,tg:19},
 {t:'IWDA.L',n:'iShares Core MSCI World UCITS ETF USD (Acc)',sh:'9.724079',s1:'9.7',avg:'123.48',p:'147.07',v:'1,430.12',pl:'+229.39',pp:'+19.1%',w:29.5,tg:30},
];

function side(sub){
 const it=(key,label,icon,cls='')=>`<div class="nav ${cls}">${ic(icon)}${label}</div>`;
 return `<aside class="side"><div class="brand"><i>${ic('today')}</i>trade-agent</div>
 ${it('today','Today','today')}
 ${it('portfolio','Portfolio','portfolio',sub?'parent':'on')}
 ${it('plan','Plan','plan','sub'+(sub?' on':''))}
 ${it('chat','Chat','chat')}${it('track','Track record','track')}${it('back','Backtests','back')}${it('pref','Preferences','pref')}${it('acct','Account','acct')}
 <div class="sec">Administration</div>${it('users','Users','users')}${it('gauge','Usage &amp; limits','gauge')}</aside>`;
}
const strip=a=>`<div class="pseg" role="tablist">${['Holdings','This month','Saved plans'].map((t,i)=>`<span role="tab" aria-selected="${i===a}" class="${i===a?'on':''}">${t}</span>`).join('')}</div>`;
const btns=`<button class="btn ghost sm">${ic('cam')}Record snapshot</button><button class="btn ghost sm">${ic('plus')}Add holding</button><button class="btn sm">Log a trade</button>`;
const head=PHONE
 ?`<div class="head"><div class="top"><h1>Portfolio</h1><span class="theme" data-theme-btn></span></div><div class="actions3">${btns.replace(/<svg[^]*?<\/svg>/g,'')}</div></div>`
 :`<div class="head"><h1>Portfolio</h1><div class="actions">${btns}<span class="theme" data-theme-btn></span></div></div>`;

const wbar=h=>`<div class="wb" aria-hidden="true"><span class="af" style="width:${h.w/60*100}%"></span><span class="tg" style="left:${h.tg/60*100}%"></span></div>`;
function row(h,noTarget){
 const wt=noTarget?`<b>${h.w}%</b><span class="settg">Set target</span>`:`<span class="num"><b>${h.w}%</b> <span class="muted">/ ${h.tg}%</span></span>${wbar(h)}`;
 const meta=noTarget?`${h.s1} sh · ${h.w}% · <span class="settg">Set target</span>`:`${h.s1} sh · ${h.w}% / target ${h.tg}%`;
 return `<div class="hr2"><div><span class="tk">${h.t}</span><span class="nm">${h.n}</span><span class="pm meta num">${meta}</span></div>
 <span class="dk num">${h.sh}</span><span class="dk num">${h.avg}</span><span class="dk num">${h.p}</span><span class="dk num val">${h.v}</span><span class="dk num up">${h.pl} · ${h.pp}</span>
 <div class="dk wc">${wt}</div><span class="dk watch" title="On your watchlist">${ic('ok')}</span>
 <div class="ph"><div class="num val">${h.v}</div><div class="num up" style="font-size:12px">${h.pl} · ${h.pp}</div></div></div>`;
}
const thead=`<div class="hr2 h"><span>Holding</span><span>Shares</span><span>Avg cost</span><span>Price</span><span>Value</span><span>P/L</span><span>Weight / Target</span><span></span></div>`;
const wrow=(t,sub,p,edit)=>`<div class="wr"><div class="grow"><b>${t}</b><div class="hint">${sub}</div></div><span class="num">${p}</span>${edit?`<span class="ib" aria-label="Edit target for ${t}">${ic('pencil')}</span>`:'<span class="ib"></span>'}<span class="ib" aria-label="Remove ${t} from watchlist">${ic('x')}</span></div>`;
const watchlist=`<section class="panel wl"><h3>Watchlist</h3>
 ${H.map(h=>wrow(h.t,'Owned · target on the holding',h.p,false)).join('')}${wrow('NVDA','Watching · target 5%','128.40',true)}
 <div class="wform"><div class="field" style="flex:1 1 120px"><label>Ticker</label><div class="input ph"><span>Watchlist ticker</span></div></div>
 <div class="field" style="width:96px"><label>Type</label><div class="input"><span>Stock</span>${k('down','sm')}</div></div>
 <div class="field" style="width:150px"><label>Target weight (%)</label><div class="input ph num"><span>Optional</span><em>%</em></div></div>
 <button class="btn ghost sm" style="height:38px">Add to watchlist</button></div></section>`;
const holdings=`<div class="stats"><div><div class="l">Portfolio value</div><div class="v bigv num">4,842.71</div></div><div><div class="l">Cost basis</div><div class="v num">4,100.00</div></div><div><div class="l">Total P/L</div><div class="v num up">+742.71 (+18.1%)</div></div></div>
 <p class="note">Mixed currencies are not converted; totals add amounts as entered.</p>
 <div class="pgrid"><section class="panel hold">${thead}${H.map(h=>row(h)).join('')}</section>${watchlist}</div>`;

const pframe=(sub,body)=>`<div class="frame" data-active="portfolio">${side(sub)}<main class="main">${head}${body}</main></div>`;
const T={holdings:'Portfolio · Holdings (default view). Sidebar: Portfolio lit; Plan sits under it.',
 month:'Portfolio · This month: the approved Plan ledger, now a view of Portfolio. Sidebar: Plan lit, Portfolio shown as its parent.',
 saved:'Portfolio · Saved plans: the history of months. Sidebar: Plan lit, Portfolio shown as its parent.'};
let out=`<div class="tag">${T[V]}</div>`;
const variant=`<div class="variant"><div class="tag" style="margin-bottom:10px">Row variant: a holding with no target yet shows a muted "Set target" (opens the holding form at Target weight)</div><section class="panel hold">${PHONE?'':thead}${row(H[2],true)}</section></div>`;
// On a phone the variant goes inside the frame, so the tab bar stays at the bottom of the screen.
if(V==='holdings') out+=PHONE?pframe(false,strip(0)+holdings+`<div style="margin-top:22px">${variant}</div>`):pframe(false,strip(0)+holdings)+variant;
if(V==='month') out+=pframe(true,strip(1)+cPlan(LINES,'0.00',false));
if(V==='saved') out+=pframe(true,strip(2)+cHistory());
document.getElementById('root').innerHTML=out;
document.querySelectorAll('[data-theme-btn]').forEach(e=>e.innerHTML=ic('sun'));
