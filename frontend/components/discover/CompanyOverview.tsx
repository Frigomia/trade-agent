"use client";

import Link from "next/link";
import { useState } from "react";
import useSWR, { mutate as mutateKey } from "swr";
import { Alert, Box, Button, Skeleton, Typography } from "@mui/material";
import { Panel } from "@/components/ui/Panel";
import { Logo } from "@/components/ui/Logo";
import { SectorIcon } from "@/components/ui/SectorIcon";
import { PriceChart } from "@/components/workbench/PriceChart";
import { StatusPill } from "@/components/discover/DiscoverCard";
import { ResearchAction } from "@/components/discover/ResearchAction";
import { apiFetch, ApiError } from "@/lib/api/client";
import type { CompanyOverviewData } from "@/lib/api/discover-types";
import type { HistoryRange, PriceHistory } from "@/lib/api/discovery-types";
import { metaText, nameOf, priceText } from "@/lib/discoverList";

const muted = { fontSize: "0.8125rem", color: "var(--muted)" } as const;
const panel = { p: { xs: 2.25, md: 3 }, display: "grid", gap: 1.5, minWidth: 0 } as const;

/** Provider facts stay separate from research: opening this page never starts a paid job. */
export function CompanyOverview({ ticker }: { ticker: string }) {
  const base = `/discover/${encodeURIComponent(ticker)}`;
  const { data, error, mutate } = useSWR<CompanyOverviewData>(`${base}/overview`, apiFetch, {
    shouldRetryOnError: false,
    refreshInterval: (current) => current?.company.analysis?.status === "running" ? 2000 : 0,
    onSuccess: (current) => {
      if (current.company.analysis && current.company.analysis.status !== "running") {
        void mutateKey("/discover");
        void mutateKey("/me/usage");
      }
    },
  });
  const [range, setRange] = useState<HistoryRange>("1m");
  const history = useSWR<PriceHistory>(data ? `${base}/history?range=${range}` : null, apiFetch, { shouldRetryOnError: false, revalidateOnFocus: false });
  const back = <Button component={Link} href="/discover" sx={{ justifySelf: "start", minHeight: 44 }}>Back to Discover</Button>;
  if (error) return <Box sx={{ display: "grid", gap: 2 }}>{back}<Alert severity="error">{error instanceof ApiError && error.status === 404 ? "This company is no longer in your Discover list." : "The company overview could not be loaded."}</Alert><Button onClick={() => void mutate()}>Try again</Button></Box>;
  if (!data) return <Box aria-busy="true" sx={{ display: "grid", gap: 2 }}>{back}<Skeleton variant="rounded" height={320} /></Box>;
  const item = data.company;
  const name = nameOf(item);
  return (
    <Box sx={{ display: "grid", gap: 3, minWidth: 0 }}>
      {back}
      <Box sx={{ display: "flex", gap: 2, alignItems: "center", minWidth: 0 }}>
        <Logo ticker={ticker} name={name} size={56} />
        <Box sx={{ minWidth: 0 }}>
          <Typography component="h1" sx={{ fontSize: { xs: "1.625rem", md: "1.875rem" }, fontWeight: 650, lineHeight: 1.15, overflowWrap: "anywhere" }}>{name}</Typography>
          <Typography sx={muted}>{metaText(item)}</Typography>
          <Typography sx={muted}><SectorIcon sector={data.sector} size={13} /> {[data.sector, data.industry, data.country].filter(Boolean).join(" · ") || "Company facts unavailable"}</Typography>
        </Box>
      </Box>
      <Box sx={{ display: "grid", gap: 3, gridTemplateColumns: { xs: "minmax(0, 1fr)", md: "minmax(0, 1fr) 300px" }, alignItems: "start" }}>
        <Panel component="aside" aria-label="Company research" sx={{ ...panel, gridColumn: { xs: 1, md: 2 }, gridRow: { xs: 1, md: "1 / 3" } }}>
          <Box><StatusPill analyzed={item.status === "analyzed"} running={item.analysis?.status === "running"} /></Box>
          <Typography component="h2" sx={{ fontSize: "1.125rem", fontWeight: 650 }}>Research this company</Typography>
          <Typography sx={muted}>Opening this page uses no monthly run.</Typography>
          {item.analysis && <Typography role="status" sx={muted}>{item.analysis.reason}{item.analysis.finished_at ? ` · ${item.analysis.finished_at.slice(0, 10)}` : ""}</Typography>}
          {item.analysis?.charge_state === "pending" && <Typography sx={muted}>Usage settlement is pending. Wait for confirmation before retrying.</Typography>}
          {item.analysis?.charge_state === "refunded" && <Typography sx={muted}>No monthly run is charged for this attempt.</Typography>}
          {item.analysis?.status === "no_opportunity" && <Typography sx={muted}>Research completed: no opportunity. This saved conclusion remains available here.</Typography>}
          {item.report_id !== null && <Button component={Link} href={`/today/${item.report_id}`} variant="contained">View report</Button>}
          <ResearchAction item={item} details />
          <Typography sx={muted}>Research is for human review. Nothing is sent to a broker.</Typography>
        </Panel>
        <Panel component="section" aria-label="Share price" sx={panel}>
          <Typography component="h2" sx={{ fontSize: "1.125rem", fontWeight: 650 }}>Share price</Typography>
          <Typography sx={muted}>Latest quote</Typography>
          <Typography sx={{ fontSize: "1.875rem", fontWeight: 650 }}>{priceText(item) ?? "Price unavailable"}</Typography>
          <Typography sx={muted}>{item.price_as_of ? `${item.stale ? "Stale quote" : "As of"} ${item.price_as_of}` : "Quote date unavailable"}</Typography>
          <Typography sx={muted}>Historical closes</Typography>
          {history.error ? <><Typography sx={muted}>Price history is unavailable. No values have been guessed.</Typography><Button onClick={() => void history.mutate()}>Retry price history</Button></> : history.data ? <PriceChart history={history.data} range={range} onRange={setRange} /> : <Skeleton variant="rounded" height={220} />}
        </Panel>
        <Panel component="section" aria-label="Company facts" sx={panel}>
          <Typography component="h2" sx={{ fontSize: "1.125rem", fontWeight: 650 }}>Company facts</Typography>
          <Box component="dl" sx={{ m: 0, display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", gap: 1.5, fontSize: "0.875rem" }}>
            {[["Sector", data.sector], ["Industry", data.industry], ["Exchange", item.exchange], ["Country", data.country], ["Quote currency", item.currency]].map(([label, value]) => <Box key={label} sx={{ display: "contents" }}><Box component="dt" sx={{ color: "var(--muted)" }}>{label}</Box><Box component="dd" sx={{ m: 0, overflowWrap: "anywhere" }}>{value || "Unavailable"}</Box></Box>)}
          </Box>
          <Typography sx={muted}>Provider data, separate from AI research.</Typography>
        </Panel>
      </Box>
      <Typography sx={muted}>Prices can be delayed. Research is not investment advice.</Typography>
    </Box>
  );
}
