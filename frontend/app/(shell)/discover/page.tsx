"use client";

import { useRef, useState } from "react";
import { Alert, Box, Button, IconButton, Typography } from "@mui/material";
import { Compass, RefreshCw, Search } from "lucide-react";
import { DiscoverCard } from "@/components/discover/DiscoverCard";
import { SearchBar } from "@/components/discover/SearchBar";
import { PageHeader } from "@/components/shell/PageHeader";
import { Panel } from "@/components/ui/Panel";
import { counts, FILTERS, SORTS, visibleItems, type DiscoverFilter, type DiscoverSort } from "@/lib/discoverList";
import { useDiscoverList } from "@/lib/useDiscoverList";
import { useSymbolSearch } from "@/lib/useSymbolSearch";
import type { SymbolMatch } from "@/lib/tickerSearch";

const muted = { fontSize: "0.75rem", color: "var(--muted)" } as const;

function Empty({ icon, title, body, action }: { icon: React.ReactNode; title: string; body: string; action?: React.ReactNode }) {
  return (
    <Panel sx={{ p: 4, display: "grid", justifyItems: "center", textAlign: "center", gap: 1 }}>
      <Box sx={{ width: 48, height: 48, borderRadius: "50%", display: "grid", placeItems: "center", bgcolor: "var(--accent-wash)", color: "var(--accent)" }}>{icon}</Box>
      <Typography component="h2" sx={{ fontSize: "1.0625rem", fontWeight: 650 }}>
        {title}
      </Typography>
      <Typography sx={{ ...muted, fontSize: "0.8125rem", maxWidth: "46ch" }}>{body}</Typography>
      {action}
    </Panel>
  );
}

/**
 * Discover: the companies the person is monitoring, whether or not they own them. Companies saved
 * from Today are in the list without any action. This screen only reads what scans already
 * produced; it never starts research and never places a trade.
 */
export default function DiscoverPage() {
  const list = useDiscoverList();
  const [query, setQuery] = useState("");
  const search = useSymbolSearch(query);
  const [filter, setFilter] = useState<DiscoverFilter>("all");
  const [sort, setSort] = useState<DiscoverSort>("new");
  // Lazy: the purity lint forbids Date.now() in render. Refreshing moves it, so a tab left open
  // past midnight says the right number of days after the next refresh.
  const [now, setNow] = useState(() => Date.now());
  const inputRef = useRef<HTMLInputElement>(null);

  const have = new Set(list.items.map((i) => i.ticker.toUpperCase()));
  const shown = visibleItems(list.items, filter, sort);
  const numbers = counts(list.items);

  async function add(match: SymbolMatch) {
    if (await list.add(match)) {
      setQuery("");
      setFilter("all");
      setSort("new");
    }
  }

  return (
    <Box>
      <PageHeader
        title="Discover"
        subtitle="Companies you are monitoring. You do not need to own them."
        actions={
          <IconButton aria-label="Refresh prices" onClick={() => {
              setNow(Date.now());
              void list.refresh();
            }}
            disabled={list.refreshing} sx={{ width: 44, height: 44, color: "var(--text2)" }}>
            <RefreshCw size={16} />
          </IconButton>
        }
      />

      <Box sx={{ display: "grid", gap: 2 }}>
        <SearchBar query={query} onQuery={setQuery} matches={search.matches} answered={search.answered} searching={search.searching} have={have} problem={list.problem} onAdd={(m) => void add(m)} inputRef={inputRef} />

        {list.failed && (
          <Alert severity="error" action={<Button color="inherit" size="small" onClick={() => void list.refresh()}>Try again</Button>}>
            Could not load Discover.
          </Alert>
        )}

        {list.loading && (
          <Panel aria-busy sx={{ p: 2.5, display: "grid", gap: 1.25 }}>
            <Typography sx={muted}>Loading your watchlist…</Typography>
            {[1, 2, 3, 4].map((n) => (
              <Box key={n} sx={{ height: 64, borderRadius: "14px", bgcolor: "var(--track)" }} />
            ))}
          </Panel>
        )}

        {!list.loading && !list.failed && list.items.length === 0 && (
          <Empty
            icon={<Compass size={22} aria-hidden />}
            title="Nothing to watch yet"
            body="Search for a company above and add it, or save one from Today and it appears here by itself. You do not need to own it."
            action={
              <Button variant="contained" startIcon={<Search size={16} aria-hidden />} onClick={() => inputRef.current?.focus()}>
                Search for a company
              </Button>
            }
          />
        )}

        {list.items.length > 0 && (
          <>
            <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, flexWrap: "wrap" }}>
              <Box role="group" aria-label="Show" sx={{ display: "inline-flex", gap: "2px", p: "3px", borderRadius: 999, bgcolor: "var(--track)", maxWidth: "100%", flexWrap: "wrap" }}>
                {FILTERS.map((f) => {
                  const on = f.key === filter;
                  return (
                    <Button
                      key={f.key}
                      aria-pressed={on}
                      onClick={() => setFilter(f.key)}
                      sx={{ minHeight: { xs: 40, md: 32 }, px: 1.75, borderRadius: 999, fontSize: "0.75rem", fontWeight: on ? 650 : 500, color: on ? "var(--text)" : "var(--text2)", bgcolor: on ? "var(--panel)" : "transparent", boxShadow: on ? "var(--shadow)" : "none" }}
                    >
                      {f.label}
                      <Box component="i" sx={{ ml: 0.75, fontStyle: "normal", color: "var(--muted)", fontVariantNumeric: "tabular-nums" }}>
                        {numbers[f.key]}
                      </Box>
                    </Button>
                  );
                })}
              </Box>
              <Box sx={{ flex: 1 }} />
              <Box component="label" sx={{ display: "inline-flex", alignItems: "center", gap: 1, ...muted }}>
                Sort by
                <Box component="select" value={sort} onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setSort(e.target.value as DiscoverSort)} aria-label="Sort by" sx={{ minHeight: 40, px: 1, borderRadius: "10px", border: "1px solid var(--line2)", bgcolor: "var(--field)", color: "var(--text)", fontSize: "0.8125rem" }}>
                  {SORTS.map((s) => (
                    <option key={s.key} value={s.key}>
                      {s.label}
                    </option>
                  ))}
                </Box>
              </Box>
            </Box>

            {list.pricesMissing && <Typography sx={{ ...muted, color: "var(--warn)" }}>Some prices could not be loaded; those companies show “Price unavailable”.</Typography>}

            {shown.length === 0 ? (
              <Empty
                icon={<Search size={22} aria-hidden />}
                title={filter === "analyzed" ? "No analyzed companies yet" : "Every company is analyzed"}
                body={filter === "analyzed" ? "A company shows here once a scan has researched it." : "There is nothing left to analyze in this list."}
                action={
                  <Button variant="outlined" onClick={() => setFilter("all")}>
                    Show all
                  </Button>
                }
              />
            ) : (
              <Box component="ul" aria-label="Companies" sx={{ m: 0, p: 0, display: "grid", gap: 1.5 }}>
                {shown.map((item) => (
                  <DiscoverCard key={item.ticker} item={item} now={now} onRemove={() => list.remove(item)} />
                ))}
              </Box>
            )}
          </>
        )}

        <Typography sx={{ ...muted, pb: 1 }}>
          Prices can be delayed. Insights come from the app&apos;s research and are not investment advice. Nothing here is sent to a broker.
        </Typography>
      </Box>

      {list.notice && (
        <Box
          role="status"
          sx={{ position: "fixed", left: "50%", transform: "translateX(-50%)", bottom: "calc(var(--tabbar-h, 0px) + 16px)", zIndex: 1300, display: "flex", alignItems: "center", gap: 2, px: 2, minHeight: 48, borderRadius: "14px", bgcolor: "var(--text)", color: "var(--panel)", boxShadow: "var(--shadow)", maxWidth: "calc(100vw - 32px)", fontSize: "0.8125rem" }}
        >
          <span>{list.notice}</span>
          {list.canUndo && (
            <Button size="small" onClick={list.undo} sx={{ color: "inherit", fontWeight: 650, textDecoration: "underline", minHeight: 44 }}>
              Undo
            </Button>
          )}
          <Button size="small" onClick={list.dismissNotice} aria-label="Dismiss" sx={{ color: "inherit", minWidth: 32 }}>
            ×
          </Button>
        </Box>
      )}
    </Box>
  );
}
