import ReactMarkdown from "react-markdown";
import { Box } from "@mui/material";

/**
 * Renders model-written markdown as styled text. The text comes from web search, so it is treated
 * as untrusted: raw HTML is dropped (react-markdown never renders it by default, `skipHtml` makes
 * that explicit), images are not loaded, and links open in a new tab without a referrer.
 */
export function Markdown({ children, size = 14.5 }: { children: string; size?: number }) {
  return (
    <Box
      sx={{
        fontSize: size,
        lineHeight: 1.6,
        color: "var(--text2)",
        maxWidth: "68ch",
        "& > :first-child": { mt: 0 },
        "& > :last-child": { mb: 0 },
        "& p": { m: "0 0 10px" },
        "& h1, & h2, & h3, & h4": {
          fontSize: "1.03em",
          fontWeight: 650,
          letterSpacing: "-0.01em",
          color: "var(--text)",
          m: "18px 0 6px",
        },
        "& strong": { color: "var(--text)", fontWeight: 600 },
        "& ul, & ol": { pl: "20px", m: "0 0 10px" },
        "& li": { mb: "4px" },
        "& a": { color: "var(--accent)" },
        "& hr": { border: 0, borderTop: "1px solid var(--line)", my: 2 },
        "& code": { fontSize: "0.92em", px: "4px", borderRadius: "4px", bgcolor: "var(--track)" },
      }}
    >
      <ReactMarkdown
        skipHtml
        disallowedElements={["img"]}
        components={{
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noopener noreferrer nofollow">
              {children}
            </a>
          ),
        }}
      >
        {children}
      </ReactMarkdown>
    </Box>
  );
}
