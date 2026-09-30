import { Box, Table, TableBody, TableCell, TableHead, TableRow, Typography } from "@mui/material";
import { STARTING_VALUE, excessLabel, signalRows } from "@/lib/backtest";
import type { BacktestResult } from "@/lib/backtest";
import { formatAmount, formatPct } from "@/lib/format";
import { Panel } from "@/components/ui/Panel";
import { Pill } from "@/components/ui/Pill";
import { BacktestChart } from "./BacktestChart";

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Box>
      <Typography sx={{ fontSize: 12, color: "var(--muted)" }}>{label}</Typography>
      <Typography sx={{ fontSize: 22, fontWeight: 650, letterSpacing: "-0.03em", fontVariantNumeric: "tabular-nums" }}>
        {value}
      </Typography>
    </Box>
  );
}

export function BacktestResultPanel({ result }: { result: BacktestResult }) {
  const rows = signalRows(result.hit_rate_by_signal);
  return (
    <Panel sx={{ p: "18px 20px", display: "grid", gap: 1 }}>
      <Box sx={{ display: "flex", alignItems: "flex-start", gap: 1.5, flexWrap: "wrap" }}>
        <Box sx={{ flex: "1 1 220px" }}>
          <Typography component="h2" sx={{ fontSize: 16, fontWeight: 650 }}>
            {result.ticker}, {result.start_date} to {result.end_date}
          </Typography>
          <Typography sx={{ fontSize: 12, color: "var(--muted)" }}>Signal strategy vs buy and hold</Typography>
        </Box>
        <Pill tone={result.excess_return_pct < 0 ? "down" : "up"}>{excessLabel(result.excess_return_pct)}</Pill>
      </Box>
      <Box sx={{ display: "flex", gap: 4.5, flexWrap: "wrap", mt: 1 }}>
        <Stat label="Strategy final value" value={formatAmount(result.final_value)} />
        <Stat label="Buy and hold" value={formatAmount(result.buy_and_hold_value)} />
      </Box>
      <Typography sx={{ fontSize: 12, color: "var(--muted)" }}>
        Both start from {formatAmount(STARTING_VALUE)}.
      </Typography>
      {result.equity_curve && (
        <BacktestChart curve={result.equity_curve} startDate={result.start_date} endDate={result.end_date} />
      )}
      {rows.length === 0 ? (
        <Typography sx={{ color: "var(--text2)" }}>No signals fired in this range.</Typography>
      ) : (
        <Table size="small" aria-label="Signal hit rates" sx={{ mt: 1, borderTop: "1px solid var(--line)" }}>
          <TableHead>
            <TableRow>
              <TableCell>Technical signal</TableCell>
              <TableCell align="right">Times seen</TableCell>
              <TableCell align="right">Avg move (20d)</TableCell>
              <TableCell align="right">Rose afterwards</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.key}>
                <TableCell>{r.label}</TableCell>
                <TableCell align="right">{r.count}</TableCell>
                <TableCell align="right" sx={{ color: r.avgMovePct < 0 ? "var(--down)" : "var(--up)", fontVariantNumeric: "tabular-nums" }}>
                  {formatPct(r.avgMovePct)}
                </TableCell>
                <TableCell align="right">{`${Math.round(r.risePct)}%`}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      {rows.some((r) => r.small) && (
        <Typography sx={{ fontSize: 12, color: "var(--muted)" }}>
          Some signals were seen fewer than 5 times; treat those rows as anecdotes.
        </Typography>
      )}
      <Typography sx={{ fontSize: 12, color: "var(--muted)" }}>
        Past performance is not a forecast. Simulated on past prices only; nothing is sent to a broker.
      </Typography>
    </Panel>
  );
}
