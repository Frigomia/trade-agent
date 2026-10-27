import Link from "next/link";
import { Box } from "@mui/material";
import { MessageSquare } from "lucide-react";

/** A quiet link from a recommendation into Chat with the obvious question already typed in. */
export function AskAboutThis({ ticker, action }: { ticker: string; action: string }) {
  return (
    <Box
      component={Link}
      href={`/chat?ask=${encodeURIComponent(`Why ${action} on ${ticker}?`)}`}
      sx={{ display: "inline-flex", alignItems: "center", gap: 1, minHeight: 44, fontSize: "0.8125rem", fontWeight: 500, textDecoration: "none", mt: 0.5 }}
    >
      <MessageSquare size={15} />
      Ask about this
    </Box>
  );
}
