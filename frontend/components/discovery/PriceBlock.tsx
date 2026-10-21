import { Box } from "@mui/material";
import { Change } from "@/components/ui/Change";
import type { DiscoveryRecommendation } from "@/lib/api/discovery-types";
import { priceText, quoteLabel } from "@/lib/discovery";

/**
 * The saved quote (price at scan time) with the live day change when it loaded. A scan that saved
 * no price shows nothing rather than a zero.
 */
export function PriceBlock({ rec, large = false }: { rec: DiscoveryRecommendation; large?: boolean }) {
  const text = rec.idea ? priceText(rec.idea) : null;
  if (!text) return null;
  return (
    <Box sx={{ display: "grid", justifyItems: "end", textAlign: "right", gap: "2px", flex: "none" }}>
      <Box
        component="span"
        sx={{
          fontWeight: 650,
          fontVariantNumeric: "tabular-nums",
          letterSpacing: large ? "-0.035em" : "-0.01em",
          fontSize: large ? { xs: "1.5rem", md: "1.875rem" } : "0.9375rem",
          lineHeight: 1.1,
        }}
      >
        {text}
      </Box>
      {rec.price_change_pct !== null && (
        <Box component="span" sx={{ fontSize: large ? "0.8125rem" : "0.75rem" }}>
          <Change pct={rec.price_change_pct} />
        </Box>
      )}
      <Box component="span" sx={{ fontSize: "0.75rem", color: "var(--muted)" }}>
        {quoteLabel(rec.idea!)}
      </Box>
    </Box>
  );
}
