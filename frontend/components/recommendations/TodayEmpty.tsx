"use client";

import Link from "next/link";
import { Box, Button, Typography } from "@mui/material";
import { Check } from "lucide-react";
import { Panel } from "@/components/ui/Panel";
import { Ring } from "@/components/ui/Ring";

interface Props {
  /** True for someone with no holdings and no watchlist yet: they get the first steps. */
  firstRun: boolean;
  running: boolean;
  onRun: () => void;
}

const STEPS = [
  {
    title: "Add what you own or want to watch",
    text: "Holdings and a watchlist give the analysis something to look at. Add as few as one.",
  },
  {
    title: "Run an analysis",
    text: "Each stock gets an action and the reasoning behind it. It takes about a minute.",
  },
  {
    title: "Decide",
    text: "Approve or dismiss each call. Approving only records your decision. Nothing is bought or sold.",
  },
];

function FirstSteps({ running, onRun }: Omit<Props, "firstRun">) {
  return (
    <Panel sx={{ maxWidth: 760, mt: 2 }}>
      <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", px: 2.5, pt: 2, pb: 1 }}>
        <Typography component="h2" sx={{ fontSize: 15, fontWeight: 650 }}>
          Get your first recommendation
        </Typography>
        <Typography sx={{ fontSize: 12, color: "var(--muted)" }}>3 steps</Typography>
      </Box>
      {STEPS.map((step, i) => {
        const current = i === 0;
        return (
          <Box
            key={step.title}
            sx={{
              display: "flex",
              alignItems: "center",
              flexWrap: "wrap",
              gap: 1.75,
              px: 2.5,
              py: 1.75,
              borderTop: "1px solid var(--line)",
              opacity: current ? 1 : 0.8,
            }}
          >
            <Box
              aria-hidden
              sx={{
                width: 30,
                height: 30,
                borderRadius: "50%",
                display: "grid",
                placeItems: "center",
                flex: "none",
                fontSize: 13,
                fontWeight: 650,
                border: "1px solid var(--line2)",
                color: "var(--muted)",
                ...(current && {
                  bgcolor: "var(--accent-solid)",
                  color: "var(--on-accent)",
                  borderColor: "transparent",
                  boxShadow: "var(--btn-shadow)",
                }),
              }}
            >
              {i + 1}
            </Box>
            <Box sx={{ flex: "1 1 220px", minWidth: 0 }}>
              <Typography sx={{ fontSize: 14, fontWeight: 650, color: current ? "var(--text)" : "var(--text2)" }}>
                {step.title}
              </Typography>
              <Typography sx={{ fontSize: 12.5, color: "var(--muted)", mt: 0.25, maxWidth: 460 }}>
                {step.text}
              </Typography>
            </Box>
            {i === 0 && (
              <Button component={Link} href="/portfolio" variant="contained" size="small">
                Open Portfolio
              </Button>
            )}
            {i === 1 && (
              <Button variant="outlined" size="small" disabled={running} onClick={onRun}>
                {running ? "Running…" : "Run an analysis now"}
              </Button>
            )}
          </Box>
        );
      })}
    </Panel>
  );
}

function AllClear({ running, onRun }: Omit<Props, "firstRun">) {
  return (
    <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", flexWrap: "wrap", gap: 3, py: 5 }}>
      <Ring size={76} tone="done">
        <Check size={22} color="var(--up)" aria-hidden />
      </Ring>
      <Box sx={{ maxWidth: 340 }}>
        <Typography component="h2" sx={{ fontSize: 18, fontWeight: 650, letterSpacing: "-0.02em" }}>
          Nothing to decide right now
        </Typography>
        <Typography sx={{ fontSize: 13, color: "var(--muted)", mt: 0.5, mb: 1.5 }}>
          New calls appear here after an analysis. Run one for a fresh look.
        </Typography>
        <Button variant="outlined" size="small" disabled={running} onClick={onRun}>
          {running ? "Running…" : "Run a fresh analysis"}
        </Button>
      </Box>
    </Box>
  );
}

export function TodayEmpty({ firstRun, running, onRun }: Props) {
  return firstRun ? <FirstSteps running={running} onRun={onRun} /> : <AllClear running={running} onRun={onRun} />;
}
