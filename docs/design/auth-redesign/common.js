/* Shared by the three directions: URL state, icons and the app's real copy. Every string below is the app's own
   (app/login, app/accept-invitation, app/reset-password, components/auth/AuthShell): no new claims. */
var P = new URLSearchParams(location.search);
document.documentElement.dataset.theme = P.get("theme") === "dark" ? "dark" : "light";
var SCREEN = P.get("screen") || "login";

var svg = (d, extra) => '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" ' + (extra || "") + ">" + d + "</svg>";
var IC = {
  moon: svg('<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>'),
  sun: svg('<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>'),
  mail: svg('<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>'),
  lock: svg('<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>'),
  eye: svg('<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>'),
  arrow: svg('<path d="M5 12h14M13 6l6 6-6 6"/>'),
  check: svg('<path d="m5 12.5 4.5 4.5L19 7.5"/>'),
  info: svg('<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>'),
  alert: svg('<path d="M12 3 2 20h20L12 3Z"/><path d="M12 10v4M12 17h.01"/>'),
};

var COPY = {
  promise: "It shows its work, remembers how past calls turned out, and never places a trade.",
  promiseLines: ["It shows its work.", "It remembers how past calls turned out.", "It never places a trade."],
  partner: "An advisory-only reasoning partner. You stay the decision-maker.",
  advisory: "Advisory information only, not investment advice.",
  invitationOnly: "trade-agent is by invitation only. If you don’t have an account, ask the administrator to invite you.",
  logoDev: "Logos provided by Logo.dev",
  loginErr: "Email or password is incorrect. Try again or reset your password.",
  noAccess: "This account doesn’t have access. Contact your administrator.",
  invite: { title: "Set your password", sub: "The administrator invited you to trade-agent. This link expires in 24 hours.", ack: "I understand trade-agent gives advisory information only and is not investment advice.", cta: "Create account" },
  invalid: "This invitation link is no longer valid — it may have expired or already been used. Ask your administrator to resend it.",
  forgot: { title: "Reset your password", sub: "We will email you a link to choose a new one.", cta: "Send reset link" },
  sent: "Check your email for a link to reset your password.",
  reset: { title: "Choose a new password", cta: "Save password" },
  short: "Use at least 8 characters.", differ: "Passwords don’t match.",
};
var EMAIL = "mianfrigo@gmail.com";

function themeToggle() {
  var dark = document.documentElement.dataset.theme === "dark";
  return '<button class="tt" type="button" aria-label="Switch to ' + (dark ? "light" : "dark") + ' theme">' + (dark ? IC.sun : IC.moon) + "</button>";
}
