export type RiskTolerance = "conservative" | "moderate" | "aggressive";

export interface AutoAnalysisPaused {
  reason: "no_key" | "limit";
  limit: number | null;
  resumes_on: string | null; // YYYY-MM-DD
}

export interface Preferences {
  risk_tolerance: RiskTolerance | null;
  sector_avoid_list: string[];
  notes: string | null;
  auto_analysis: boolean;
  monthly_contribution: number | null; // send null to clear
  drift_threshold_pct: number;
  auto_analysis_paused: AutoAnalysisPaused | null; // only set while auto_analysis is on
}

export const NOTES_MAX = 2000; // matches PreferencesIn.notes max_length

export const SECTOR_MAX_LENGTH = 50; // matches the backend SectorName max_length
export const MAX_SECTORS = 20; // matches PreferencesIn.sector_avoid_list max_length

/**
 * Trimmed; blank, over-long and case-insensitive duplicate names are ignored, and nothing is added
 * once the list holds MAX_SECTORS. Always returns a new array.
 */
export function addSector(list: string[], raw: string): string[] {
  const sector = raw.trim();
  if (
    !sector ||
    sector.length > SECTOR_MAX_LENGTH ||
    list.length >= MAX_SECTORS ||
    list.some((s) => s.toLowerCase() === sector.toLowerCase())
  ) {
    return [...list];
  }
  return [...list, sector];
}

export const CONTRIBUTION_ERROR = "Enter an amount from 0.01 to 1,000,000, two decimals at most, or leave it empty.";
export const DRIFT_ERROR = "Enter a number from 1 to 50, one decimal at most.";

function parseBounded(raw: string, decimals: number, min: number, max: number): number | null {
  const text = raw.trim().replace(",", "."); // some decimal keypads show a comma
  if (!new RegExp(String.raw`^\d+(\.\d{1,${decimals}})?$`).test(text)) return null;
  const n = Number(text);
  return n >= min && n <= max ? n : null;
}

/** Empty clears the saved amount (null); "invalid" is anything outside 0.01 to 1,000,000 with two decimals. */
export function parseContribution(raw: string): number | null | "invalid" {
  if (raw.trim() === "") return null;
  return parseBounded(raw, 2, 0.01, 1_000_000) ?? "invalid";
}

/** The drift threshold has no "clear": null would be ignored by the backend, so it is invalid here. */
export function parseDrift(raw: string): number | "invalid" {
  return parseBounded(raw, 1, 1, 50) ?? "invalid";
}
