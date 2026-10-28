"use client";

import { useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import { Alert, Box, Button, Typography } from "@mui/material";
import { ScanResults } from "@/components/discovery/ScanResults";
import { apiFetch } from "@/lib/api/client";
import type { DiscoveryIdeas } from "@/lib/api/discovery-types";

export default function ScanResultsPage() {
  const { data, error, mutate } = useSWR<DiscoveryIdeas>("/discovery/ideas", apiFetch);
  const [now] = useState(() => Date.now());
  return (
    <Box sx={{ display: "grid", gap: 2 }}>
      <Button component={Link} href="/today" sx={{ justifySelf: "start", minHeight: 44 }}>← Back to Today</Button>
      <Typography component="h1" sx={{ fontSize: { xs: "1.625rem", md: "1.875rem" }, fontWeight: 650, letterSpacing: "-0.025em" }}>Scan results</Typography>
      {error && <Alert severity="error" action={<Button onClick={() => mutate()} color="inherit">Try again</Button>}>Saved scan results are unavailable right now.</Alert>}
      {!data && !error && <Typography role="status">Loading saved scan results…</Typography>}
      {data && <ScanResults scan={data.latest_scan} now={now} />}
    </Box>
  );
}
