"use client";

import { useEffect, useState } from "react";
import { Autocomplete, Box, TextField, Typography } from "@mui/material";
import { apiFetch } from "@/lib/api/client";
import { looksLikeIsin, type SymbolMatch } from "@/lib/tickerSearch";

const DEBOUNCE_MS = 300;
const MIN_QUERY_LENGTH = 2;
const PORTFOLIO_GROUP = "In your portfolio";
const SEARCH_GROUP = "Search results";

type Option = SymbolMatch & { group: string };

interface Props {
  label: string;
  value: string;
  onChange: (value: string) => void;
  /** Called with the whole match when one is chosen, so a form can also fill name and type. */
  onPick?: (match: SymbolMatch) => void;
  /** The user's own holdings and watchlist: offered first, and without a network request. */
  suggestions?: SymbolMatch[];
  /** A compact field with no outer margin, to sit in a row with other small controls. */
  dense?: boolean;
}

/**
 * A ticker field you can type into freely (whatever is typed is the value) that also searches
 * Yahoo by name, ticker or ISIN once there are two characters and a short pause, and offers the
 * user's own holdings first. A failed search just shows nothing; typing still works.
 */
export function TickerPicker({ label, value, onChange, onPick, suggestions = [], dense = false }: Props) {
  const query = value.trim();
  const [picked, setPicked] = useState<string | null>(null);
  const [answer, setAnswer] = useState<{ query: string; matches: SymbolMatch[] } | null>(null);
  // The symbol just filled in is not a new question to ask Yahoo.
  const searchable = query.length >= MIN_QUERY_LENGTH && query !== picked;

  useEffect(() => {
    if (!searchable) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      apiFetch<SymbolMatch[]>(`/market/search?q=${encodeURIComponent(query)}`)
        .then((matches) => !cancelled && setAnswer({ query, matches: Array.isArray(matches) ? matches : [] }))
        .catch(() => !cancelled && setAnswer({ query, matches: [] }));
    }, DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, searchable]);

  const answered = searchable && answer?.query === query;
  const found = answered ? answer.matches : [];
  const lower = query.toLowerCase();
  const own = suggestions.filter(
    (s) => lower === "" || s.symbol.toLowerCase().includes(lower) || s.name.toLowerCase().includes(lower),
  );
  const options: Option[] = [
    ...own.map((s) => ({ ...s, group: PORTFOLIO_GROUP })),
    ...found.filter((m) => !own.some((s) => s.symbol === m.symbol)).map((m) => ({ ...m, group: SEARCH_GROUP })),
  ];
  const noMatch = answered && options.length === 0;
  const isinQuery = looksLikeIsin(query);

  return (
    <Autocomplete<Option, false, false, true>
      freeSolo
      openOnFocus
      options={options}
      inputValue={value}
      onInputChange={(_, text) => onChange(text)}
      onChange={(_, option) => {
        if (option === null || typeof option === "string") return;
        setPicked(option.symbol);
        onChange(option.symbol);
        // The typed text is the only place an ISIN comes from: search results carry none.
        onPick?.({
          symbol: option.symbol,
          name: option.name,
          type: option.type,
          exchange: option.exchange,
          ...(isinQuery && { isin: query.toUpperCase() }),
        });
      }}
      filterOptions={(all) => all}
      groupBy={(option) => option.group}
      getOptionLabel={(option) => (typeof option === "string" ? option : option.symbol)}
      isOptionEqualToValue={(a, b) => typeof b !== "string" && a.symbol === b.symbol}
      renderOption={(props, option) => (
        <li {...props} key={`${option.group}:${option.symbol}`}>
          <Box sx={{ minWidth: 0 }}>
            <Typography sx={{ fontWeight: 600 }}>{option.symbol}</Typography>
            <Typography sx={{ fontSize: 12, color: "var(--muted)" }}>
              {[option.name, option.exchange, option.type].filter(Boolean).join(" · ")}
            </Typography>
            {isinQuery && option.group === SEARCH_GROUP && (
              <Typography sx={{ fontSize: 12, color: "var(--muted)" }}>
                Saves ISIN {query.toUpperCase()} with it
              </Typography>
            )}
          </Box>
        </li>
      )}
      renderInput={(params) => (
        <TextField
          {...params}
          label={label}
          size={dense ? "small" : undefined}
          margin={dense ? "none" : "normal"}
          helperText={
            noMatch
              ? "No match. You can still type the ticker."
              : isinQuery && found.length > 0
                ? `ISIN ${query.toUpperCase()} will be saved with this ticker.`
                : undefined
          }
          slotProps={{ ...params.slotProps, htmlInput: { ...params.slotProps.htmlInput, autoComplete: "off" } }}
        />
      )}
    />
  );
}
