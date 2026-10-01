export const CHAT_SESSION = "main";
export const MAX_MESSAGE = 4000;

export const STARTERS = [
  "How is my portfolio doing?",
  "What changed in my recommendations lately?",
  "Which holding has the most risk?",
];

export interface ChatMessage {
  id: number;
  session_id: string;
  role: "user" | "assistant";
  content: string;
  created_at: string;
}

// The chat prompt asks the model to put what it learned from web search under this heading.
const WEB_HEADING = /^## From the web[ \t]*$/m;

/** Splits a reply into the part from our own data and the web-derived section, if there is one. */
export function splitWebSection(content: string): { body: string; web: string | null } {
  const match = WEB_HEADING.exec(content);
  if (!match) return { body: content, web: null };
  const web = content.slice(match.index + match[0].length).trim();
  return { body: content.slice(0, match.index).trim(), web: web || null };
}
