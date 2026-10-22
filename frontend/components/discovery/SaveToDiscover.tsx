"use client";

import Link from "next/link";
import { Box, Button, Typography } from "@mui/material";
import { Bookmark, Check } from "lucide-react";
import type { IdeaOut } from "@/lib/api/discovery-types";
import { useSaveToDiscover } from "@/lib/useSaveToDiscover";

/**
 * Saves the company to Discover. The button stays where it is once saved (focus is not lost), says
 * "Saved", and the way to the list appears next to it, announced. A failure is said under the button
 * in words (the reason the server gave).
 */
export function SaveToDiscover({ idea, label = "Save to Discover" }: { idea: Pick<IdeaOut, "name" | "ticker" | "asset_type">; label?: string }) {
  const { save, saving, saved, problem } = useSaveToDiscover(idea.ticker, idea.asset_type);
  return (
    <Box sx={{ display: "grid", justifyItems: "start" }}>
      <Box sx={{ display: "flex", alignItems: "center", flexWrap: "wrap", columnGap: 1 }}>
        <Button
          size="small"
          variant="text"
          aria-disabled={saving || saved || undefined} // not `disabled`: that would drop the keyboard focus
          onClick={saved ? undefined : () => void save()}
          startIcon={saved ? <Check size={14} aria-hidden /> : <Bookmark size={14} aria-hidden />}
          aria-label={saved ? `${idea.name} saved to Discover` : `${label} ${idea.name}`}
          sx={{ minHeight: { xs: 44, md: 36 }, color: "var(--text2)" }}
        >
          {saved ? "Saved" : label}
        </Button>
        {saved && (
          <Box role="status">
            <Box component={Link} href="/discover" sx={{ display: "inline-flex", alignItems: "center", minHeight: { xs: 44, md: 36 }, fontSize: "0.8125rem", fontWeight: 500 }}>
              View in Discover
            </Box>
          </Box>
        )}
      </Box>
      {problem && (
        <Typography role="alert" sx={{ fontSize: "0.75rem", color: "var(--text2)" }}>
          {problem}
        </Typography>
      )}
    </Box>
  );
}
