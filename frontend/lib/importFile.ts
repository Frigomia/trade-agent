export const MAX_IMPORT_BYTES = 5 * 1024 * 1024;

const COUNT_LABELS: Record<string, string> = {
  holdings: "holdings",
  watchlist_items: "watchlist companies",
  trades: "trades",
  portfolio_snapshots: "saved daily values",
  investment_preferences: "preferences",
  contribution_plans: "saved plans",
  recurring_investments: "recurring plans",
  recurring_occurrences: "recurring entries",
};

/** "3 holdings" lines for the non-zero counts the server reports, in the order above. */
export function describeCounts(restored: Record<string, number>): string[] {
  return Object.entries(COUNT_LABELS)
    .filter(([key]) => (restored[key] ?? 0) > 0)
    .map(([key, label]) => `${restored[key]} ${label}`);
}

// The lists the server restores. The rest of an export (the profile, chats, recommendations and
// the other AI output) is ignored by the import, so it is left out of what is sent.
const RESTORABLE_KEYS = [
  "format_version",
  "holdings",
  "watchlist_items",
  "trades",
  "portfolio_snapshots",
  "contribution_plans",
  "recurring_investments",
  "recurring_occurrences",
  "investment_preferences",
];
const MAX_RAW_FILE_BYTES = 100 * 1024 * 1024; // only a guard against reading a huge file into memory
const TOO_LARGE = "That file is too large to import.";
const NOT_AN_EXPORT = "That is not a trade-agent export file.";

/**
 * Reads a chosen export file and returns the JSON to send: only the restorable part, refusing a
 * file that is not a JSON object or whose restorable part is over 5 MiB (the server's limit).
 */
export async function readImportFile(file: File): Promise<string> {
  if (file.size > MAX_RAW_FILE_BYTES) throw new Error(TOO_LARGE);
  let parsed: unknown;
  try {
    parsed = JSON.parse(await file.text());
  } catch {
    throw new Error(NOT_AN_EXPORT);
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(NOT_AN_EXPORT);
  }
  const source = parsed as Record<string, unknown>;
  const trimmed: Record<string, unknown> = {};
  for (const key of RESTORABLE_KEYS) {
    if (key in source) trimmed[key] = source[key];
  }
  const body = JSON.stringify(trimmed);
  if (new Blob([body]).size > MAX_IMPORT_BYTES) throw new Error(TOO_LARGE);
  return body;
}
