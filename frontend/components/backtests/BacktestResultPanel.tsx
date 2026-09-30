import { Box, Table, TableBody, TableCell, TableHead, TableRow, Typography } from "@mui/material";
import { STARTING_VALUE, excessLabel, signalRows } from "@/lib/backtest";
import type { BacktestResult } from "@/lib/backtest";
import { formatAmount, formatPct } from "@/lib/format";
import { BacktestChart } from "./BacktestChart";

export function BacktestResultPanel({ result }: { result: BacktestResult }) {
  const rows = signalRows(result.hit_rate_by_signal);
  return (
    <Box>
      <Typography component="h2" variant="h6">
        {result.ticker}, {result.start_date} to {result.end_date}
      </Typography>
      <Typography>Both start from {formatAmount(STARTING_VALUE)}.</Typography>
      <Typography>{`Strategy ends at ${formatAmount(result.final_value)}`}</Typography>
      <Typography>{`Buy-and-hold ends at ${formatAmount(result.buy_and_hold_value)}`}</Typography>
      <Typography>{excessLabel(result.excess_return_pct)}</Typography>
      {result.equity_curve && (
        <BacktestChart curve={result.equity_curve} startDate={result.start_date} endDate={result.end_date} />
      )}
      {rows.length === 0 ? (
        <Typography>No signals fired in this range.</Typography>
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
        <Typography>Some signals were seen fewer than 5 times; treat those rows as anecdotes.</Typography>
      )}
      <Typography>
        Past performance is not a forecast. Simulated on past prices only; nothing is sent to a broker.
      </Typography>
    </Box>
  );
}
