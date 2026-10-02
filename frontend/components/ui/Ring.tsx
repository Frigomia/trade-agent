import type { ReactNode } from "react";
import { Box } from "@mui/material";

/**
 * The empty-state ring (docs/design/empty-states, direction C). "done" is a solid emerald ring for
 * a finished state; "idle" is a quiet track with a dotted tick ring for something that is still
 * waiting. A soft emerald glow sits behind it, the product's one light.
 */
export function Ring({
  size,
  tone,
  children,
}: {
  size: number;
  tone: "done" | "idle";
  children: ReactNode;
}) {
  return (
    <Box sx={{ position: "relative", width: size, height: size, flex: "none" }}>
      <Box
        aria-hidden
        sx={{
          position: "absolute",
          inset: -size * 0.26,
          background: "radial-gradient(closest-side, var(--up-bg), transparent 70%)",
          pointerEvents: "none",
        }}
      />
      <Box
        component="svg"
        aria-hidden
        viewBox="0 0 132 132"
        sx={{ position: "absolute", inset: 0, width: size, height: size, transform: "rotate(-90deg)" }}
      >
        {tone === "done" ? (
          <circle cx="66" cy="66" r="58" fill="none" stroke="var(--up)" strokeWidth="5" strokeLinecap="round" />
        ) : (
          <>
            <circle cx="66" cy="66" r="58" fill="none" stroke="var(--track)" strokeWidth="6" />
            <circle
              cx="66"
              cy="66"
              r="58"
              fill="none"
              stroke="var(--line2)"
              strokeWidth="2"
              strokeDasharray="1 5.3"
              strokeLinecap="round"
            />
          </>
        )}
      </Box>
      <Box sx={{ position: "absolute", inset: 0, display: "grid", placeItems: "center" }}>{children}</Box>
    </Box>
  );
}
