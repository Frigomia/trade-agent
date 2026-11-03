/* Shared by d1, d2, d3: the form card for every screen, the research card, the soft background. Needs common.js. */
var ICONS = P.get("icons") !== "0"; // d1 shows icons in the fields as the reference does; d2 and d3 pass icons:0 below
function dBg() {
  return '<div class="bg" aria-hidden="true"><svg viewBox="0 0 1440 900" preserveAspectRatio="none"><circle class="ring" cx="1240" cy="-120" r="560"/><circle class="ring" cx="1240" cy="-120" r="760"/><path class="w1" d="M0 610 C 260 540 430 740 720 790 S 1120 880 1440 790 L1440 900 L0 900 Z"/><path class="w2" d="M0 740 C 300 690 520 860 830 900 L0 900 Z"/></svg></div>';
}
function fieldD(id, label, type, o) {
  o = o || {};
  var lead = o.lead && ICONS ? o.lead : "";
  return '<div class="fld"><div class="lr"><label for="' + id + '">' + label + "</label>" + (o.link || "") + '</div><div class="in ' + (o.cls || "") + '">' + lead + '<input id="' + id + '" type="' + type + '" value="' + (o.val || "") + '" placeholder="' + (o.ph || "") + '"' + (o.dis ? " disabled" : "") + ' autocomplete="off">' + (o.trail || "") + "</div>" + (o.hint || "") + "</div>";
}
function formCard(icons) {
  ICONS = icons;
  var key = SCREEN, err = false;
  if (key === "loginerr") { key = "login"; err = true; P.set("typed", "1"); }
  var eye = '<button class="eye" type="button" aria-label="Show password">' + IC.eye + "</button>";
  var t = P.has("typed");
  var S = {
    login: ["Sign in", "to your trade-agent account", "<form>" + fieldD("em", "Email", "email", { lead: IC.mail, val: t ? EMAIL : "", ph: "name@example.com" }) + fieldD("pw", "Password", "password", { lead: IC.lock, link: '<a href="#">Forgot password?</a>', val: t ? "correct horse" : "", cls: err ? "bad" : "", trail: eye }) + (err ? '<p class="msg err" role="alert">' + IC.alert + COPY.loginErr + "</p>" : "") + '<button class="cta" type="submit">Sign in</button></form>', 1],
    invite: [COPY.invite.title, COPY.invite.sub, "<form>" + fieldD("ie", "Email", "email", { lead: IC.mail, val: EMAIL, dis: 1, cls: "quiet" }) + fieldD("p1", "Create password", "password", { lead: IC.lock, val: "tidewater-9", hint: '<span class="hint">Use at least 8 characters.</span>' }) + fieldD("p2", "Confirm password", "password", { lead: IC.lock, val: "tidewater-9" }) + '<label class="ack"><span class="box on">' + IC.check + "</span><span>" + COPY.invite.ack + '</span></label><button class="cta" type="submit">' + COPY.invite.cta + "</button></form>"],
    invalid: ["Link not valid", "", '<p class="msg warn" role="alert" style="margin-top:24px">' + IC.alert + COPY.invalid + "</p>"],
    forgot: [COPY.forgot.title, COPY.forgot.sub, "<form>" + fieldD("fe", "Email", "email", { lead: IC.mail, val: EMAIL }) + '<button class="cta" type="submit">' + COPY.forgot.cta + "</button></form>"],
    sent: ["Check your email", "", '<p class="msg ok" role="status" style="margin-top:24px">' + IC.mail + COPY.sent + "</p>"],
    reset: [COPY.reset.title, EMAIL, "<form>" + fieldD("n1", "New password", "password", { lead: IC.lock, val: "tidewater-9" }) + fieldD("n2", "Confirm password", "password", { lead: IC.lock, val: "tidewater-9" }) + '<button class="cta" type="submit">' + COPY.reset.cta + "</button></form>"],
  };
  var s = S[key] || S.login;
  return '<div class="fcard ' + (icons ? "" : "noicons") + '"><h1>' + s[0] + "</h1>" + (s[1] ? '<p class="sub">' + s[1] + "</p>" : "") + s[2] + (s[3] ? '<p class="inv">' + IC.lock + "<span>" + COPY.invitationOnly + "</span></p>" : "") + "</div>";
}
var meterD = (n) => '<span class="meter" aria-hidden="true">' + [1, 2, 3].map((i) => '<i class="' + (i <= n ? "f" : "") + '"></i>').join("") + "</span>";
var sparkD = svg('<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3Z"/>');
function researchCard(extra) {
  return '<article class="rc" aria-label="An illustrative research card"><span class="ill">Illustrative example, not a real recommendation</span>' +
    '<div class="id"><span class="mono-c">HS</span><div><h3>Halden Systems</h3><small>HLDN · NASDAQ</small></div><div class="px"><b>USD 184.20</b><small>Scan quote · 20 Oct</small></div></div>' +
    '<div class="chips"><span class="chip">' + meterD(3) + 'High confidence</span><span class="chip">' + meterD(2) + "Medium risk</span></div>" +
    '<div class="ai"><p>Recurring revenue priced below peers.</p><p class="m">' + sparkD + "<b>Why now.</b> Q3 results on 6 Nov</p><p class=\"m\"><b>Risk to the thesis.</b> Top customers are 38% of revenue.</p><small>AI research summary · 2 cited sources</small></div>" + (extra || "") + "</article>";
}
var BRAND = '<a class="brand" href="#"><img src="../../../frontend/public/los_trading_hermanos_logo.svg" alt=""><span>trade-agent</span></a>';
