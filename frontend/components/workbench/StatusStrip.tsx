import type { ReactNode } from "react";
import { Box, Typography } from "@mui/material";
import { Ban, CircleCheck, CircleX, RefreshCw } from "lucide-react";
import type { DiscoveryRecommendation } from "@/lib/api/discovery-types";
import { decisionStamp } from "@/lib/decisionView";
import { dayText } from "@/lib/discovery";

export type StripKind = "approved" | "dismissed" | "withdrawn" | "newer";

const TEXT = { m: 0, fontSize: "0.9375rem", lineHeight: 1.5, color: "var(--text2)", maxWidth: "68ch" } as const;

/** Status as shape plus word, never colour alone. */
function Chip({ icon: Icon, word, accent = false }: { icon: typeof Ban; word: string; accent?: boolean }) {
  return (
    <Box
      component="span"
      sx={{
        display: "inline-flex",
        alignItems: "center",
        gap: 0.5,
        px: 1.25,
        minHeight: 26,
        borderRadius: 999,
        fontSize: "0.75rem",
        fontWeight: 500,
        whiteSpace: "nowrap",
        color: accent ? "var(--accent)" : "var(--text2)",
        bgcolor: accent ? "var(--accent-wash)" : "transparent",
        border: accent ? "1px solid transparent" : "1px solid var(--line2)",
      }}
    >
      <Icon size={13} aria-hidden />
      {word}
    </Box>
  );
}

/**
 * The one strip above the tabs when a saved company is reopened: what happened to the idea, in plain
 * words. Only a withdrawn reason is AI text, so only it sits in the dashed box. Notes and reasons are
 * untrusted text: rendered as text and wrapped.
 */
export function StatusStrip({ kind, rec }: { kind: StripKind; rec: DiscoveryRecommendation }) {
  const withdrawn = kind === "withdrawn";
  const asOf = rec.withdrawal?.as_of;
  const reason = rec.withdrawal?.reason;
  const issued = dayText(rec.created_at);

  let icon: typeof Ban;
  let head: ReactNode;
  let body: string;
  if (kind === "approved") {
    icon = CircleCheck;
    head = <Chip icon={CircleCheck} word="Approved" accent />;
    body = "You approved this idea. No order was placed; trade-agent never trades. If you acted on it in your broker app, log the trade you placed.";
  } else if (kind === "dismissed") {
    icon = CircleX;
    head = <Chip icon={CircleX} word="Dismissed" />;
    body = "You dismissed this idea. The research below is what you decided on. Nothing else changed.";
  } else if (withdrawn) {
    icon = Ban;
    head = <Chip icon={Ban} word="Withdrawn" />;
    body = `${rec.withdrawal?.kind === "invalidated" ? "This idea was withdrawn." : "The latest scan no longer found this compelling."} The research below is the earlier analysis from ${issued}; nothing replaced it.`;
  } else {
    icon = RefreshCw;
    head = (
      <Typography component="b" sx={{ fontWeight: 650 }}>
        Newer analysis
      </Typography>
    );
    body = "You opened an earlier analysis of this company. It was replaced, so this is the newer one, still waiting for your decision.";
  }
  const Icon = icon;
  const date = kind === "newer" ? `Updated ${issued}` : withdrawn ? (asOf ? dayText(asOf) : null) : decisionStamp(rec);

  return (
    <Box
      role="status"
      sx={{
        display: "grid",
        gridTemplateColumns: "auto minmax(0, 1fr)",
        columnGap: { xs: 1.5, md: 1.75 },
        rowGap: 0.5,
        alignItems: "start",
        p: { xs: "14px", md: "14px 18px" },
        borderRadius: "22px",
        bgcolor: "var(--panel)",
        border: "1px solid var(--line2)",
      }}
    >
      <Box
        sx={{
          gridRow: { md: "1 / 3" },
          width: { xs: 32, md: 36 },
          height: { xs: 32, md: 36 },
          borderRadius: "50%",
          display: "grid",
          placeItems: "center",
          bgcolor: kind === "approved" ? "var(--accent-wash)" : "var(--track)",
          color: kind === "approved" ? "var(--accent)" : "var(--text2)",
        }}
      >
        <Icon size={18} aria-hidden />
      </Box>
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap", fontSize: "1rem", color: "var(--text)", minHeight: { md: 36 } }}>
        {head}
        {date && (
          <Typography component="em" sx={{ fontStyle: "normal", fontSize: "0.75rem", color: "var(--muted)" }}>
            {date}
          </Typography>
        )}
      </Box>
      <Box sx={{ gridColumn: { xs: "1 / -1", md: 2 }, display: "grid", gap: 1 }}>
        <Typography sx={TEXT}>{body}</Typography>
        {kind === "dismissed" && rec.dismissal_reason && (
          <Typography sx={{ ...TEXT, color: "var(--text)", overflowWrap: "anywhere" }}>
            <b>Your note:</b> {rec.dismissal_reason}
          </Typography>
        )}
        {withdrawn && reason && (
          <Box sx={{ borderStyle: "dashed", borderWidth: "1px", borderColor: "var(--line2)", borderRadius: "14px", p: "12px 14px", display: "grid", gap: 0.75, maxWidth: "68ch" }}>
            <Typography sx={{ ...TEXT, color: "var(--text)", overflowWrap: "anywhere" }}>{reason}</Typography>
            <Typography component="span" sx={{ fontSize: "0.75rem", color: "var(--muted)" }}>
              {asOf ? `From the latest scan · ${dayText(asOf)}` : "From the latest scan"}
            </Typography>
          </Box>
        )}
      </Box>
    </Box>
  );
}
