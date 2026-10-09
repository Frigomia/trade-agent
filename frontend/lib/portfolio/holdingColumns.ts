// The holdings table's grid, shared by the header and every row so they line up.
// Every desktop track is minmax(0, ...fr): a bare fr has an automatic minimum (its content), which
// would push the grid wider than the panel instead of sharing the room out.
// Widths (main = viewport - 211px sidebar - 48px padding; the watchlist sits beside from lg):
// 900px: ~550px for the cells, 1024: ~670, 1280: ~590 (beside the watchlist), 1536: ~850.
// Avg cost has no column of its own: it is the second line of the Shares cell.
const track = (fr: number) => `minmax(0, ${fr}fr)`;
const SIX = [1.5, 0.8, 0.8, 0.8, 1.1, 1].map(track).join(" "); // holding, shares, price, value, P/L, weight

export const HOLDING_COLUMNS = { xs: "minmax(0, 1fr) auto", md: SIX } as const;
export const HOLDING_GAP = { xs: 2, md: 1.25 } as const;
