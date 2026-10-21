"use client";

import Link from "next/link";
import { Box, Button, Typography } from "@mui/material";
import { Check } from "lucide-react";
import { Panel } from "@/components/ui/Panel";
import { Ring } from "@/components/ui/Ring";

interface Props {
  /** True for someone with no holdings and no watchlist yet: they get the first steps. */
  firstRun: boolean;
}

const STEPS = [
  {
    title: "Add what you own or want to watch",
    text: "Holdings and a watchlist let the app compare each idea with what you own. Add as few as one.",
  },
  {
    title: "Run a scan",
    text: "Use Refresh in the scan bar above. It researches companies from a global list and keeps the few worth a look, each with its reasoning and its risks.",
  },
  {
    title: "Decide",
    text: "Open an idea, read the evidence and the risks, then approve or dismiss it. Approving only records your decision. Nothing is bought or sold.",
  },
];

function FirstSteps() {
  return (
    <Panel sx={{ maxWidth: 760, mt: 2 }}>
      <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", px: 2.5, pt: 2, pb: 1 }}>
        <Typography component="h2" sx={{ fontSize: "0.9375rem", fontWeight: 650 }}>
          Get your first recommendation
        </Typography>
        <Typography sx={{ fontSize: "0.75rem", color: "var(--muted)" }}>3 steps</Typography>
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
                fontSize: "0.8125rem",
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
              <Typography sx={{ fontSize: "0.875rem", fontWeight: 650, color: current ? "var(--text)" : "var(--text2)" }}>
                {step.title}
              </Typography>
              <Typography sx={{ fontSize: "0.78125rem", color: "var(--muted)", mt: 0.25, maxWidth: 460 }}>
                {step.text}
              </Typography>
            </Box>
            {i === 0 && (
              <Button component={Link} href="/portfolio" variant="contained" size="small">
                Open Portfolio
              </Button>
            )}
          </Box>
        );
      })}
    </Panel>
  );
}

function AllClear() {
  return (
    <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", flexWrap: "wrap", gap: 3, py: 5 }}>
      <Ring size={76} tone="done">
        <Check size={22} color="var(--accent)" aria-hidden />
      </Ring>
      <Box sx={{ maxWidth: 340 }}>
        <Typography component="h2" sx={{ fontSize: "1.125rem", fontWeight: 650, letterSpacing: "-0.02em" }}>
          Nothing to decide right now
        </Typography>
        <Typography sx={{ fontSize: "0.8125rem", color: "var(--muted)", mt: 0.5, mb: 1.5 }}>
          Calls on your holdings appear here when your daily analysis runs. You can change that in Preferences.
        </Typography>
        <Button component={Link} href="/more/preferences" variant="outlined" size="small">
          Open Preferences
        </Button>
      </Box>
    </Box>
  );
}

export function TodayEmpty({ firstRun }: Props) {
  return firstRun ? <FirstSteps /> : <AllClear />;
}
