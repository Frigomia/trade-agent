export const TARGET_ERROR = "Enter a target from 0 to 100, two decimals at most.";

/** A saved fraction (0..1) as the text of the percent field; "" when there is none. */
export function fractionToPercentText(fraction: number | null | undefined): string {
  return fraction == null ? "" : String(Math.round(fraction * 10000) / 100);
}

/** The percent field's text as a fraction: null when blank, undefined when invalid. */
export function percentTextToFraction(raw: string): number | null | undefined {
  const text = raw.trim().replace(",", ".");
  if (text === "") return null;
  if (!/^\d+(\.\d{1,2})?$/.test(text)) return undefined;
  const percent = Number(text);
  return percent <= 100 ? Math.round(percent * 100) / 10000 : undefined;
}
