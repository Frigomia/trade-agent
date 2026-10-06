export interface AdminUserOut {
  id: string;
  email: string;
  role: "admin" | "user";
  status: "invited" | "active" | "disabled";
  created_at: string;
  invited_at: string | null;
  invite_expires_at: string | null;
  accepted_terms_at: string | null;
  last_seen_at: string | null;
  monthly_analysis_limit: number | null;
  monthly_analysis_used: number | null;
  monthly_chat_limit: number | null;
  monthly_chat_used: number | null;
  /** Only whether a key is connected; the key and its digits are never sent to admins. */
  claude_key_state: "none" | "ok" | "needs_attention";
}

export interface LimitDefaults {
  analysis_limit: number;
  chat_limit: number;
}
