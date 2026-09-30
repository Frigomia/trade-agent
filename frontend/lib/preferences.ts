export type RiskTolerance = "conservative" | "moderate" | "aggressive";

export interface Preferences {
  risk_tolerance: RiskTolerance | null;
  sector_avoid_list: string[];
  notes: string | null;
}

export const NOTES_MAX = 2000; // matches PreferencesIn.notes max_length

/** Trimmed, blank and case-insensitive duplicates ignored; always returns a new array. */
export function addSector(list: string[], raw: string): string[] {
  const sector = raw.trim();
  if (!sector || list.some((s) => s.toLowerCase() === sector.toLowerCase())) return [...list];
  return [...list, sector];
}
