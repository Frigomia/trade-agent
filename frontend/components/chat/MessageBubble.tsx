import { Box, Typography } from "@mui/material";
import { splitWebSection, type ChatMessage } from "@/lib/chat";
import { Markdown } from "@/components/ui/Markdown";
import { Panel } from "@/components/ui/Panel";
import { WebOpinionBox } from "@/components/recommendations/WebOpinionBox";

/** One chat message: the user's as an accent-tinted bubble, a reply as a panel of markdown. */
export function MessageBubble({ message }: { message: Pick<ChatMessage, "role" | "content"> }) {
  if (message.role === "user") {
    return (
      <Box
        sx={{
          alignSelf: "flex-end",
          maxWidth: "85%",
          p: "10px 14px",
          borderRadius: "16px",
          bgcolor: "var(--bubble)",
          whiteSpace: "pre-wrap",
          overflowWrap: "anywhere",
        }}
      >
        <Typography>{message.content}</Typography>
      </Box>
    );
  }
  const { body, web } = splitWebSection(message.content);
  return (
    <Panel sx={{ alignSelf: "flex-start", maxWidth: "92%", p: "12px 14px", overflowWrap: "anywhere" }}>
      {body && <Markdown>{body}</Markdown>}
      {web && <WebOpinionBox text={web} label="From the web · not part of the score" />}
    </Panel>
  );
}
