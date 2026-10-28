"use client";

import { useState } from "react";
import useSWR from "swr";
import NextLink from "next/link";
import { Alert, Box, Button, Typography } from "@mui/material";
import { ArrowLeft, Sparkles } from "lucide-react";
import { PageHeader } from "@/components/shell/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { ScanResults } from "@/components/discovery/ScanResults";
import { apiFetch } from "@/lib/api/client";
import type { DiscoveryIdeas } from "@/lib/api/discovery-types";
import { whenText } from "@/lib/discovery";

/**
 * What the latest scan set aside, did not research and did not admit. It reads the same saved
 * ideas as Today (no provider call, no Claude key needed) and shows the last saved scan.
 */
export default function ScanResultsPage() {
  const { data, error } = useSWR<DiscoveryIdeas>("/discovery/ideas", apiFetch);
  const [now] = useState(() => Date.now()); // lazy: the purity lint forbids Date.now() in render
  const scan = data?.latest_scan ?? null;

  return (
    <Box>
      <Button component={NextLink} href="/today" startIcon={<ArrowLeft size={16} aria-hidden />} sx={{ mb: 1, minHeight: 44, color: "var(--text2)", fontWeight: 400 }}>
        Today
      </Button>
      <PageHeader
        title="Scan results"
        subtitle={scan ? `Latest AI scan · Updated ${whenText(scan.created_at, now)}. What was looked at and what was left out.` : undefined}
      />
      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          Could not load the scan results.
        </Alert>
      )}
      {!data && !error && (
        <Typography role="status" sx={{ fontSize: "0.8125rem", color: "var(--muted)" }}>
          Loading the scan results…
        </Typography>
      )}
      {data && !scan && (
        <Panel sx={{ p: "34px 20px", display: "grid", justifyItems: "center", textAlign: "center", gap: 1 }}>
          <Box aria-hidden sx={{ width: 48, height: 48, borderRadius: "50%", display: "grid", placeItems: "center", bgcolor: "var(--accent-wash)", color: "var(--accent)" }}>
            <Sparkles size={20} />
          </Box>
          <Typography component="h2" sx={{ fontSize: "1.25rem", fontWeight: 650, letterSpacing: "-0.02em" }}>
            Nothing to show yet
          </Typography>
          <Typography sx={{ fontSize: "0.8125rem", color: "var(--text2)", lineHeight: 1.55, maxWidth: "46ch" }}>
            Run a scan from Today. When it finishes, what it set aside and why will be listed here.
          </Typography>
          <Button component={NextLink} href="/today" variant="contained" sx={{ mt: 1 }}>
            Go to Today
          </Button>
        </Panel>
      )}
      {scan && <ScanResults scan={scan} />}
    </Box>
  );
}
