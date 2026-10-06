// Set by /auth/confirm after a recovery link verifies; lets /reset-password tell a reset session
// from any other signed-in session. Not a secret: the session itself is what authorises changes.
export const RECOVERY_COOKIE = "ta_recovery";

export function hasRecoveryCookie(): boolean {
  return document.cookie.split("; ").some((c) => c.startsWith(`${RECOVERY_COOKIE}=`));
}

export function clearRecoveryCookie(): void {
  document.cookie = `${RECOVERY_COOKIE}=; Max-Age=0; Path=/`;
}

// The origin Supabase is asked to redirect reset links to. A fixed NEXT_PUBLIC_SITE_URL keeps it
// on the allow-listed production origin; the browser origin is only the fallback when it is unset.
export function siteOrigin(): string {
  return (process.env.NEXT_PUBLIC_SITE_URL || window.location.origin).replace(/\/$/, "");
}
