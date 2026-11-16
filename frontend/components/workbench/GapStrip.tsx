import { Box, Typography } from "@mui/material";
import type { Scale } from "@/lib/etfIdea";

type Props = {
  label: string;
  caption: string;
  change: string;
  now: number;
  withFive: number;
  nowText: string;
  withFiveText: string;
  scale: Scale;
  score: number | null;
  /** Printed under the two scale ends; defaults to the bare numbers. */
  axis?: [string, string];
  /** Correlation: one value against a fund that moves exactly with the portfolio. `now` is then not drawn. */
  reference?: { value: number; text: string };
};

const pct = (v: number, { min, max }: Scale) => Math.min(100, Math.max(0, ((v - min) / (max - min)) * 100));
// A label near either end is anchored to that end so it cannot overflow the strip.
const anchor = (x: number) => (x > 88 ? "translateX(-100%)" : x < 8 ? "none" : "translateX(-50%)");

const dot = { position: "absolute", top: "50%", transform: "translate(-50%, -50%)", width: 16, height: 16, borderRadius: "50%" } as const;

function Value({ x, up, name, text }: { x: number; up: boolean; name: string; text: string }) {
  return (
    <Box
      component="span"
      sx={{ position: "absolute", left: `${x}%`, transform: anchor(x), whiteSpace: "nowrap", fontSize: "0.75rem", lineHeight: 1.2, color: up ? "var(--muted)" : "var(--text2)", ...(up ? { top: 0 } : { bottom: 0 }) }}
    >
      {name}
      <Box component="b" sx={{ ml: "4px", fontSize: "0.875rem", fontWeight: 650, color: "var(--text)", fontVariantNumeric: "tabular-nums" }}>
        {text}
      </Box>
    </Box>
  );
}

/** One measured part as a labelled range: a ring for the portfolio now, a filled dot for the portfolio with 5% of the fund. */
export function GapStrip({ label, caption, change, now, withFive, nowText, withFiveText, scale, score, axis, reference }: Props) {
  const xn = pct(now, scale);
  const xw = pct(withFive, scale);
  const xr = reference ? pct(reference.value, scale) : 0;
  const ends = axis ?? [String(scale.min), String(scale.max)];
  const aria = reference
    ? `${label}: this fund ${withFiveText}, where ${reference.text} would move exactly with your holdings`
    : `${label}: now ${nowText}, with 5% ${withFiveText}`;
  return (
    <Box
      sx={{
        display: "grid",
        gap: { xs: "4px 12px", md: "0 24px" },
        gridTemplateColumns: { xs: "minmax(0, 1fr) auto", md: "200px minmax(0, 1fr) 76px" },
        alignItems: "center",
        pt: { xs: "14px", md: "18px" },
        pb: { xs: "6px", md: "18px" },
        borderTop: "1px solid var(--line)",
      }}
    >
      <Box sx={{ display: "grid", gap: "2px", minWidth: 0 }}>
        <Typography component="b" sx={{ fontSize: "0.9375rem", fontWeight: 650, letterSpacing: "-0.01em" }}>
          {label}
        </Typography>
        <Typography component="small" sx={{ fontSize: "0.75rem", color: "var(--muted)" }}>
          {caption}
        </Typography>
        <Typography component="span" sx={{ fontSize: "0.875rem", color: "var(--text)", mt: "4px" }}>
          {change}
        </Typography>
      </Box>
      <Box role="img" aria-label={aria} sx={{ position: "relative", py: "26px", minWidth: 0, order: { xs: 3, md: 0 }, gridColumn: { xs: "1 / -1", md: "auto" } }}>
        {reference ? (
          <Value x={xr} up name="Moves exactly with you" text={reference.text} />
        ) : (
          <Value x={xn} up name="Now" text={nowText} />
        )}
        <Box sx={{ position: "relative", height: 6, borderRadius: 999, bgcolor: "var(--track)" }}>
          {reference ? (
            <Box component="i" sx={{ position: "absolute", top: "50%", left: `${xr}%`, transform: "translate(-50%, -50%)", width: 2, height: 18, borderRadius: "1px", bgcolor: "var(--text2)" }} />
          ) : (
            <>
              <Box component="i" sx={{ position: "absolute", top: "50%", transform: "translateY(-50%)", left: `${Math.min(xn, xw)}%`, width: `${Math.abs(xn - xw)}%`, height: 4, borderRadius: 999, bgcolor: "color-mix(in srgb, var(--accent) 45%, transparent)" }} />
              <Box component="i" sx={{ ...dot, left: `${xn}%`, border: "2.5px solid var(--muted)", bgcolor: "var(--panel)" }} />
            </>
          )}
          <Box component="i" sx={{ ...dot, left: `${xw}%`, bgcolor: "var(--accent)", border: "2.5px solid var(--panel)", boxShadow: "0 0 0 1px var(--accent)" }} />
        </Box>
        <Value x={xw} up={false} name={reference ? "This fund" : "With 5%"} text={withFiveText} />
        <Box aria-hidden sx={{ position: "absolute", left: 0, right: 0, top: "50%", display: "flex", justifyContent: "space-between", pointerEvents: "none", fontSize: "0.75rem", color: "var(--muted)" }}>
          <Box component="span" sx={{ transform: "translateY(10px)" }}>{ends[0]}</Box>
          <Box component="span" sx={{ transform: "translateY(10px)" }}>{ends[1]}</Box>
        </Box>
      </Box>
      {score !== null && (
        <Box sx={{ display: "grid", justifyItems: "end", textAlign: "right", order: { xs: 2, md: 0 } }}>
          <Typography component="b" sx={{ fontSize: "1.25rem", fontWeight: 650, letterSpacing: "-0.02em", fontVariantNumeric: "tabular-nums" }}>
            {score}
          </Typography>
          <Typography component="small" sx={{ fontSize: "0.75rem", color: "var(--muted)", whiteSpace: "nowrap" }}>
            of 100
          </Typography>
        </Box>
      )}
    </Box>
  );
}
