"use client";

import { useId, type KeyboardEvent } from "react";
import { Alert, Box, Button, InputBase, Typography } from "@mui/material";
import { Check, Plus, Search } from "lucide-react";
import { Logo } from "@/components/ui/Logo";
import { Panel } from "@/components/ui/Panel";
import type { SymbolMatch } from "@/lib/tickerSearch";

const muted = { fontSize: "0.75rem", color: "var(--muted)" } as const;

/**
 * Search a company by name or ticker and add it: the user types none of its name, exchange or
 * currency, and enters no shares or cost (the hint says so). A company already in the list shows
 * "Already in Discover" in place of Add, so a duplicate cannot be added. Enter adds the first result
 * that is not already there, Escape clears.
 */
export function SearchBar({
  query,
  onQuery,
  matches,
  answered,
  searching,
  have,
  problem,
  onAdd,
  inputRef,
}: {
  query: string;
  onQuery: (text: string) => void;
  matches: SymbolMatch[];
  answered: boolean;
  searching: boolean;
  /** Upper-cased tickers already in the list. */
  have: Set<string>;
  problem: string | null;
  onAdd: (match: SymbolMatch) => void;
  inputRef: React.RefObject<HTMLInputElement | null>;
}) {
  const hintId = useId();
  const typed = query.trim();
  const firstNew = matches.find((m) => !have.has(m.symbol.toUpperCase()));
  const addFirst = () => (firstNew && typed ? onAdd(firstNew) : inputRef.current?.focus());
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") onQuery("");
    if (e.key === "Enter") {
      e.preventDefault();
      if (firstNew) onAdd(firstNew);
    }
  };
  return (
    <Box sx={{ display: "grid", gap: 1 }}>
      <Box sx={{ display: "flex", gap: 1.25, flexWrap: "wrap" }}>
        <Box
          component="label"
          sx={{ flex: "1 1 260px", minWidth: 0, display: "flex", alignItems: "center", gap: 1, px: 1.75, minHeight: 48, borderRadius: "14px", border: "1px solid var(--line2)", bgcolor: "var(--field)", "&:focus-within": { outline: "2px solid var(--focus)" } }}
        >
          <Search size={16} aria-hidden color="var(--muted)" />
          <InputBase
            inputRef={inputRef}
            value={query}
            onChange={(e) => onQuery(e.target.value)}
            onKeyDown={onKey}
            placeholder="Search by name or ticker"
            autoComplete="off"
            fullWidth
            inputProps={{ "aria-label": "Search a company by name or ticker", "aria-describedby": typed ? undefined : hintId }}
          />
        </Box>
        <Button variant="contained" startIcon={<Plus size={16} aria-hidden />} onClick={addFirst} sx={{ minHeight: 48 }}>
          Add company
        </Button>
      </Box>
      {!typed && (
        <Typography id={hintId} sx={muted}>
          We fill in the name, exchange and currency. No shares or purchase price needed, unlike Add holding.
        </Typography>
      )}
      {problem && <Alert severity="error">{problem}</Alert>}
      {typed.length >= 2 && (
        <Panel component="ul" aria-label="Search results" sx={{ listStyle: "none", m: 0, p: "6px", display: "grid" }}>
          {searching && (
            <Box component="li" sx={{ p: 1.5, ...muted }}>
              Searching…
            </Box>
          )}
          {answered && matches.length === 0 && (
            <Box component="li" sx={{ p: 1.5, display: "grid", gap: 0.5 }}>
              <Typography component="b" sx={{ fontSize: "0.8125rem" }}>
                No company found for “{typed}”
              </Typography>
              <Typography sx={muted}>Check the spelling, or try the ticker. Name, exchange and currency are filled in for you once you pick a result.</Typography>
            </Box>
          )}
          {matches.map((m) => {
            const already = have.has(m.symbol.toUpperCase());
            return (
              <Box component="li" key={m.symbol} sx={{ display: "flex", alignItems: "center", gap: 1.5, p: "6px 8px", borderRadius: "10px", minHeight: 52 }}>
                <Logo name={m.name} size={32} />
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography sx={{ fontWeight: 600, fontSize: "0.8125rem", overflowWrap: "anywhere" }}>{m.name}</Typography>
                  <Typography sx={muted}>{[m.symbol, m.exchange].filter(Boolean).join(" · ")}</Typography>
                </Box>
                {already ? (
                  <Box component="span" sx={{ ...muted, display: "inline-flex", alignItems: "center", gap: 0.5 }}>
                    <Check size={13} aria-hidden /> Already in Discover
                  </Box>
                ) : (
                  <Button size="small" variant="outlined" startIcon={<Plus size={14} aria-hidden />} onClick={() => onAdd(m)} aria-label={`Add ${m.name} to Discover`} sx={{ minHeight: { xs: 44, md: 34 } }}>
                    Add
                  </Button>
                )}
              </Box>
            );
          })}
        </Panel>
      )}
    </Box>
  );
}
