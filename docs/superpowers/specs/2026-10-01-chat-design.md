# Chat screen (sub-project 7) — design

## Goal

A working Chat screen: one ongoing, portfolio-aware conversation with the advisory agent. It stays
advisory only (the agent cannot take actions), shows the monthly chat allowance quietly, and
explains a reached limit instead of showing an error. Visual target: the chat frames in
`docs/design/mockups/user-sections.html`.

## Decisions (agreed in brainstorming)

| Question | Decision |
| --- | --- |
| Conversations | One ongoing conversation per person, persisted across visits. A "Clear chat" action starts fresh. No session list. |
| Reply delivery | No streaming. The user's message appears at once, a quiet "thinking" indicator shows until the whole reply arrives. |
| Web content in a reply | The prompt asks for a final `## From the web` section. The page splits the reply there and shows that part in the dashed "From the web · not part of the score" box. A reply without the heading is shown whole. |
| Clear chat | Yes, with a confirmation. |
| Entry from other screens | An "Ask about this" button on the recommendation detail page opens Chat with the question typed in, not sent. |

Out of scope: streaming, several conversations, any action or trade, a structured verdict field.

## What exists today

- `POST /chat {session_id, message}` builds the portfolio context, calls Claude with web search,
  stores the user and assistant messages (`chat_messages`), returns `{session_id, message}`.
  Rate limited (20/min) and capped monthly; a reached cap is a calm `429` already.
- `GET /me/usage` returns `{analysis_runs, chat_messages}` as `{used, limit}`.
- The frontend `/chat` page is a placeholder.

Gaps this work closes: no way to read history, the whole history is sent to Claude on every
message, and `run_chat` joins every text block of the reply (the same narration leak the web
analysis had before `news._final_text`).

## Backend

### The conversation

The screen always uses the session id `main` (a constant on both sides). Messages are the
existing `chat_messages` rows; there is no schema change and no migration.

### Endpoints

| Method | Path | Behaviour |
| --- | --- | --- |
| GET | `/chat/messages?session_id=main` | The caller's last 50 messages of that session, oldest first, as `list[ChatMessageOut]` (existing schema). `session_id` defaults to `main`. Not counted against the monthly cap and not rate limited beyond the global limits. |
| DELETE | `/chat/messages?session_id=main` | Deletes the caller's messages of that session. `204`. |
| POST | `/chat` | Unchanged contract. Internally: the history sent to Claude is the **last 20** messages of the session (newest 20, then oldest-first), not all of them. |

All three require an active user and run through `get_user_db`, so RLS scopes every query to the
caller. `session_id` keeps the existing `max_length=100`.

Note on a failed reply: the user's message is stored before Claude is called, so a failure leaves a
user message with no answer. The next request then has two user messages in a row; the Anthropic
API accepts that. The page shows the unanswered message and an error, and keeps the text.

### Closing answer only

`news._final_text` moves to a shared helper (`app/agents/text.py`, `final_text(content)`) used by
both `news.run_news_agent` and `chat.run_chat`. Only the run of text blocks after the last
non-text block is the answer, joined as-is. `run_chat` keeps raising `RuntimeError` when there is
no closing text (today's behaviour for "no text blocks").

### Prompt

The chat system prompt gains: reply in short markdown; do not narrate searching or retries; put
anything learned from web search in a final section headed exactly `## From the web`, and omit that
section when no web search was used. The existing injection-resistance wording stays.

## Frontend

### Page (`/chat`)

- Header: title "Chat", the usage meter (`used / limit` with a thin bar from `GET /me/usage`),
  a "Clear chat" action, the theme toggle (via `PageHeader`).
- Messages (`SWR /chat/messages?session_id=main`): the user's messages as accent-tinted bubbles on
  the right; replies as panels on the left rendered with the shared `Markdown` component.
  A reply is split at a line `## From the web`; the part after it is shown in the dashed web box
  (`WebOpinionBox` gains a `label` so it can read "From the web · not part of the score").
- Empty state: three tappable starter questions (static text): "How is my portfolio doing?",
  "What changed in my recommendations lately?", "Which holding has the most risk?". Tapping puts
  the text in the box and sends it.
- Composer: multiline text field, Enter sends, Shift+Enter adds a line, send button; max 4000
  characters (the API limit). While a reply is pending the field and button are disabled and a
  quiet "thinking" indicator shows under the last message.
- Sending: the user's message is appended optimistically, `POST /chat` runs, then the history is
  revalidated. On failure the optimistic message is dropped, the text returns to the box, and a
  short error shows ("Could not get a reply. Try again.").
- Limit reached (`used >= limit`, or a `429` from POST): the composer is disabled with the
  placeholder "Chat is paused until <reset date>" and a warning note: "You've used all N chat
  messages this month. They reset on <date>. Need more sooner? Ask the administrator to raise
  your limit." History stays readable. The reset date is the existing `nextResetDate`.
- Clear chat: a confirmation dialog ("Delete this conversation? This cannot be undone."), then
  `DELETE /chat/messages` and a history refresh.
- Footer line: "Advisory only, not investment advice."

### Layout

Desktop: a centred 760px column; the composer is sticky at the bottom of the column. Phone: the
page fills the height above the tab bar, the message list scrolls, the composer sits just above the
tab bar. The list scrolls to the newest message when it changes.

### Ask about this

The recommendation detail page (phone and desktop) gets a quiet "Ask about this" link to
`/chat?ask=<text>` where text is `Why <ACTION> on <TICKER>?`. The Chat page reads `ask` once, puts it
in the composer (not sent) and removes it from the URL. The text is user-editable and is only ever
placed in the input, never sent or rendered as markup.

## Safety and rules

- No code path calls a broker, and no copy offers Buy, Sell, Deposit or Withdraw. The footer states
  the page is advisory.
- Reply text is untrusted: rendered with the shared `Markdown` component (no raw HTML, no images,
  safe links). The `ask` parameter is plain text placed in an input.
- The monthly cap and rate limit stay server-side; the page only displays them.

## Testing

Backend: history returns the caller's last 50 oldest-first and only that session; another user's
messages are never returned (RLS); DELETE clears only that session and only the caller's rows;
POST sends at most the last 20 messages to Claude; `final_text` drops narration and joins a split
closing answer (shared tests move with the helper); a reply with no closing text still raises.

Frontend: empty state with starters; send appends the message, shows the indicator, then the
reply; a failed send restores the text; the `## From the web` split renders the web box and a reply
without it renders whole; the limit state disables the composer and shows the reset date; Clear
chat confirms then clears; `?ask=` prefills the composer without sending; the detail page link has
the right href.

## Documentation

ARCHITECTURE.md §8 (chat is no longer "built, no UI") and the API table (two new rows, the 20-message
cap, the `main` session convention) are updated in the same change.
