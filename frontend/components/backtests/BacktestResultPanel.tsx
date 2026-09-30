import { Box, Table, TableBody, TableCell, TableHead, TableRow, Typography } from "@mui/material";
import { STARTING_VALUE, excessLabel, signalRows } from "@/lib/backtest";
import type { BacktestResult } from "@/lib/backtest";
import { formatAmount, formatPct } from "@/lib/format";
import { Panel } from "@/components/ui/Panel";
import { Pill } from "@/components/ui/Pill";
import { BacktestChart } from "./BacktestChart";

export function BacktestResultPanel({ result }: { result: BacktestResult }) {
  const rows = signalRows(result.hit_rate_by_signal);
  return (
    <Panel sx={{ p: "18px 20px", display: "grid", gap: 1 }}>
      <Box sx={{ display: "flex", alignItems: "flex-start", gap: 1.5, flexWrap: "wrap" }}>
        <Typography component="h2" sx={{ fontSize: 17, fontWeight: 650, flex: 1 }}>
          {result.ticker}, {result.start_date} to {result.end_date}
        </Typography>
        <Pill tone={result.excess_return_pct < 0 ? "down" : "up"}>{excessLabel(result.excess_return_pct)}</Pill>
      </Box>
      <Typography sx={{ fontSize: 12, color: "var(--muted)" }}>
        Both start from {formatAmount(STARTING_VALUE)}.
      </Typography>
      <Box sx={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
        <Typography sx={{ fontWeight: 650 }}>{`Strategy ends at ${formatAmount(result.final_value)}`}</Typography>
        <Typography sx={{ color: "var(--text2)" }}>
          {`Buy-and-hold ends at ${formatAmount(result.buy_and_hold_value)}`}
        </Typography>
      </Box>
      {result.equity_curve && (
        <BacktestChart curve={result.equity_curve} startDate={result.start_date} endDate={result.end_date} />
      )}
      {rows.length === 0 ? (
        <Typography sx={{ color: "var(--text2)" }}>No signals fired in this range.</Typography>
      ) : (
        <Table size="small" aria-label="Signal hit rates">
          <TableHead>
            <TableRow>
              <TableCell>Signal</TableCell>
              <TableCell>Times seen</TableCell>
              <TableCell>Average move after 20 days</TableCell>
              <TableCell>Share that rose</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.key}>
                <TableCell>{r.label}</TableCell>
                <TableCell>{r.count}</TableCell>
                <TableCell>{formatPct(r.avgMovePct)}</TableCell>
                <TableCell>{`${Math.round(r.risePct)}%`}</TableCell>
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
