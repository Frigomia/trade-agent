"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import useSWR from "swr";
import { Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogContentText, IconButton, Typography } from "@mui/material";
import { Trash2 } from "lucide-react";
import { apiFetch, ApiError } from "@/lib/api/client";
import { CHAT_SESSION, MAX_MESSAGE, STARTERS, type ChatMessage } from "@/lib/chat";
import { nextResetDate, type Usage } from "@/lib/usage";
import { PageHeader } from "@/components/shell/PageHeader";
import { MessageBubble } from "@/components/chat/MessageBubble";
import { UsageMeter } from "@/components/chat/UsageMeter";
import { Composer } from "@/components/chat/Composer";
import { ClaudeRequired } from "@/components/claude/ClaudeRequired";
import { isClaudeKeyRequired, useClaudeLock } from "@/lib/claudeKey";

const HISTORY_PATH = `/chat/messages?session_id=${CHAT_SESSION}`;

export default function ChatPage() {
  // useSearchParams needs a Suspense boundary for the static build.
  return (
    <Suspense>
      <ChatScreen />
    </Suspense>
  );
}

function ChatScreen() {
  const router = useRouter();
  const params = useSearchParams();
  const { data: messages, mutate: mutateMessages } = useSWR<ChatMessage[]>(HISTORY_PATH, apiFetch);
  const { data: usage, mutate: mutateUsage } = useSWR<Usage>("/me/usage", apiFetch);
  // "Ask about this" links here with the question already typed: it is only ever put in the box.
  const [draft, setDraft] = useState(() => (params.get("ask") ?? "").slice(0, MAX_MESSAGE));
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [limitHit, setLimitHit] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const { lock, markRequired } = useClaudeLock();
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const wasPending = useRef(false);

  // Hand the keyboard back once a reply finishes.
  useEffect(() => {
    if (wasPending.current && pending === null) inputRef.current?.focus();
    wasPending.current = pending !== null;
  }, [pending]);

  useEffect(() => {
    if (params.get("ask") !== null) router.replace("/chat");
  }, [params, router]);

  useEffect(() => {
    endRef.current?.scrollIntoView?.({ block: "end" });
  }, [messages, pending]);

  const chatUsage = usage?.chat_messages;
  const atLimit = limitHit || (chatUsage !== undefined && chatUsage.used >= chatUsage.limit);
  const resetDate = nextResetDate(new Date());
  const limitNote =
    chatUsage?.limit === 0
      ? "Chat is turned off for your account. Ask the administrator if you need it."
      : `You've used all ${chatUsage?.limit ?? ""} chat messages this month. They reset on ${resetDate}. Need more sooner? Ask the administrator to raise your limit.`;

  async function send(text: string) {
    const message = text.trim();
    if (!message || pending !== null || atLimit) return;
    setError(null);
    setPending(message);
    setDraft("");
    try {
      await apiFetch("/chat", {
        method: "POST",
        body: JSON.stringify({ session_id: CHAT_SESSION, message }),
      });
    } catch (err) {
      setDraft(message);
      if (isClaudeKeyRequired(err)) markRequired();
      else if (err instanceof ApiError && err.status === 429 && /monthly/i.test(err.detail)) {
        setLimitHit(true);
      } else {
        setError("Could not get a reply. Try again.");
      }
    }
    // The user's message may already be stored even when the reply failed, so always refetch.
    try {
      await Promise.all([mutateMessages(), mutateUsage()]);
    } finally {
      setPending(null);
    }
  }

  async function clear() {
    setConfirmClear(false);
    try {
      await apiFetch(HISTORY_PATH, { method: "DELETE" });
      await mutateMessages();
    } catch {
      setError("Could not clear the conversation.");
    }
  }

  const empty = messages !== undefined && messages.length === 0 && pending === null;

  return (
    // On phones the page runs down to the tab bar: -8px cancels the shell's bottom padding, so the
    // pinned composer sits flush on the bar with nothing showing in between.
    <Box sx={{ maxWidth: 760, mx: "auto", display: "flex", flexDirection: "column", mb: { xs: "-8px", md: 0 }, minHeight: { xs: "calc(100dvh - var(--tabbar-h) - 16px)", md: "calc(100dvh - 60px)" } }}>
      <PageHeader
        title="Chat"
        actions={
          <>
            {chatUsage && <UsageMeter usage={chatUsage} />}
            <IconButton
              size="small"
              aria-label="Clear chat"
              title="Clear chat"
              disabled={!messages?.length || pending !== null}
              onClick={() => setConfirmClear(true)}
            >
              <Trash2 size={17} />
            </IconButton>
          </>
        }
      />

      <Box sx={{ flex: 1, display: "flex", flexDirection: "column", gap: 1.25, justifyContent: "flex-end", pb: 1.5 }}>
        {empty && !lock && (
          <Box sx={{ display: "flex", flexDirection: "column", gap: 1, alignItems: "flex-start", mb: 1 }}>
            <Typography sx={{ color: "var(--muted)", fontSize: 13.5 }}>Ask about your portfolio, for example:</Typography>
            {STARTERS.map((starter) => (
              <Button key={starter} variant="outlined" size="small" onClick={() => void send(starter)}>
                {starter}
              </Button>
            ))}
          </Box>
        )}
        {messages?.map((message) => <MessageBubble key={message.id} message={message} />)}
        {pending !== null && <MessageBubble message={{ role: "user", content: pending }} />}
        <Typography sx={{ color: "var(--muted)", fontSize: 13, minHeight: pending !== null ? undefined : 0 }} role="status">
          {pending !== null ? "Thinking…" : ""}
        </Typography>
        <div ref={endRef} />
      </Box>

      <Box sx={{ position: "sticky", bottom: { xs: "var(--tabbar-h)", md: 16 }, pt: 1, pb: 0.5, bgcolor: "var(--bg)", zIndex: 1 }}>
        {error && (
          <Alert severity="error" sx={{ mb: 1 }}>
            {error}
          </Alert>
        )}
        {atLimit && (
          <Alert severity="warning" sx={{ mb: 1 }}>
            {limitNote}
          </Alert>
        )}
        {lock ? (
          <ClaudeRequired variant="chat" lock={lock} />
        ) : (
          <>
            <Typography sx={{ textAlign: "center", fontSize: 12, color: "var(--muted)", mb: 0.75 }}>
              Advisory only, not investment advice.
            </Typography>
            <Composer
              value={draft}
              onChange={setDraft}
              inputRef={inputRef}
              onSend={() => void send(draft)}
              disabled={atLimit || pending !== null}
              placeholder={atLimit ? `Chat is paused until ${resetDate}` : "Ask about your portfolio"}
            />
          </>
        )}
      </Box>

      <Dialog open={confirmClear} onClose={() => setConfirmClear(false)}>
        <DialogContent>
          <DialogContentText>Delete this conversation? This cannot be undone.</DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmClear(false)}>Cancel</Button>
          <Button color="error" onClick={() => void clear()}>
            Delete
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
