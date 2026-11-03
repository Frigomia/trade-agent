import { Box, type SxProps, type Theme } from "@mui/material";
import { Change } from "@/components/ui/Change";
import type { DiscoveryRecommendation } from "@/lib/api/discovery-types";
import { priceText, quoteLabel } from "@/lib/discovery";

/**
 * The saved quote (price at scan time) with the live day change when it loaded. A scan that saved
 * no price shows nothing rather than a zero. On a phone it sits left-aligned under the company, so
 * a long quote line wraps inside the card instead of squeezing the name; from sm it is on the right.
 */
export function PriceBlock({ rec, large = false, sx }: { rec: DiscoveryRecommendation; large?: boolean; sx?: SxProps<Theme> }) {
  const text = rec.idea ? priceText(rec.idea) : null;
  if (!text) return null;
  return (
    <Box
      sx={[
        { display: "grid", justifyItems: { xs: "start", sm: "end" }, textAlign: { xs: "left", sm: "right" }, gap: "2px", minWidth: 0 },
        ...(Array.isArray(sx) ? sx : sx ? [sx] : []),
      ]}
    >
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
