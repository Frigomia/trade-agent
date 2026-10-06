import type { ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import { Box } from "@mui/material";

function textOf(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (node && typeof node === "object" && "props" in node) {
    return textOf((node.props as { children?: ReactNode }).children);
  }
  return "";
}

const normalise = (value: string) =>
  value.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/$/, "");

// Where a link really goes, shown next to its text: a poisoned page can make the model write a
// link whose URL carries data, so the reader must see the host before clicking. Null when the
// visible text already says it.
function destination(href: string | undefined, text: string): string | null {
  if (!href) return null;
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return null;
  }
  const shown = url.protocol === "mailto:" ? url.pathname : url.host;
  if (!shown) return null;
  const visible = normalise(text);
  return visible === normalise(shown) || visible === normalise(href) ? null : shown;
}

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
        "& h1, & h2, & h3": {
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
      }}
    >
      <ReactMarkdown
        skipHtml
        disallowedElements={["img"]}
        components={{
          a: ({ href, children }) => {
            const shown = destination(href, textOf(children));
            return (
              <>
                <a href={href} target="_blank" rel="noopener noreferrer nofollow">
                  {children}
                </a>
                {shown && <span style={{ color: "var(--muted)", fontSize: "0.9em" }}> ({shown})</span>}
              </>
            );
          },
        }}
      >
        {children}
      </ReactMarkdown>
    </Box>
  );
}
