import { useState } from "react";
import type { SymbolMatch } from "@/lib/tickerSearch";

/**
 * The ISIN typed to find a picked symbol. It only counts while the ticker still is that symbol, and
 * a pick without an ISIN clears an earlier one.
 */
export function usePickedIsin() {
  const [picked, setPicked] = useState<{ symbol: string; isin: string } | null>(null);
  return {
    pick: (match: SymbolMatch) =>
      setPicked(match.isin ? { symbol: match.symbol.toUpperCase(), isin: match.isin } : null),
    isinFor: (ticker: string) => (picked?.symbol === ticker ? picked.isin : null),
  };
}
