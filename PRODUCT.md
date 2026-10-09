# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Decided in `docs/ARCHITECTURE.md` §3, not by this record: Next.js (React) + TypeScript + MUI (Tailwind v4 is installed but unused), SWR for data fetching, path-filtered CI, deployed to Vercel. Lives in a new `frontend/` directory of the existing monorepo; the FastAPI backend already exists.

## Users

Multi-user, invitation-only (decided 2026-09-28; the product started single-user). One **admin** (the owner) plus **invited users**: nobody can sign up on their own, the admin invites people by email. Each user has a fully private portfolio, watchlist, recommendations, chat, and preferences; the admin sees access-management data only (who exists, status, invitations, usage counts), never anyone's holdings, recommendations, or chats.

Primary situation for every user: a quick daily check, mostly on a phone the way they check their broker app; occasionally a longer desktop session for chat, backtests, and tuning preferences. The admin additionally manages users, invitations, and per-user usage limits, mostly on desktop.

## Product Purpose

A personal, advisory-only trading assistant. It analyzes a portfolio and watchlist of stocks and ETFs and produces recommendations (BUY / ADD / HOLD / TRIM / SELL / WATCH) with the reasoning behind each. The dashboard is where the owner reviews those recommendations and records a decision. Success: the owner can see what needs a decision, understand why, and approve or dismiss in seconds, and trust that nothing happened beyond recording that decision.

## Positioning

An advisory-only reasoning partner, not a trading app. It never places a trade and no code path can. It explains its reasoning (fundamentals gate buy/sell, technicals only time entries, a web-search second opinion clearly separated from the numbers) and remembers how similar past recommendations turned out. The owner stays the decision-maker.

## Operating Context

- The owner triggers an analysis run manually (an async job they poll), reviews the pending recommendations, and approves or dismisses each one. Approving only records the decision; the owner then places any trade themselves in their broker app (Trade Republic) and separately logs it via the trade-logging step. Approve and execute are deliberately separate steps (`docs/ARCHITECTURE.md` §7).
- Also available: portfolio and watchlist management, portfolio value snapshots over time, a portfolio-aware chat with web search, investment preferences, backtests, and long-term memory of past recommendations and their outcomes.
- Data is time-sensitive but not real-time: quotes are cached for minutes, analysis is run on demand.

## Capabilities and Constraints

- Hard rule: the system never places a trade. No screen may offer a Buy, Sell, Deposit, or Withdraw execution action. The primary decision actions are Approve and Dismiss, and they only update local state.
- Backend API already exists for: holdings, watchlist, trades, analysis runs and recommendations (approve/reject), backtests, memory search, chat, investment preferences, and portfolio snapshots. `GET /portfolio/snapshots` returns value and cost-basis totals over time.
- Access model: Supabase Auth is the planned provider (`docs/ARCHITECTURE.md` §13). Roles are admin and user. Invitations are sent by the admin by email; the invitee sets a password. The backend today is still single-user (`default_user_id` everywhere, no RLS): the auth and multi-user backend is a separate, not-yet-built project that must precede the login and admin screens.
- Cost control: model and embedding calls cost money per use and the admin pays. Each user has monthly limits (analysis runs, chat messages) set by the admin, with sensible defaults; usage per user is visible to the admin; a user who reaches a limit sees a clear message, not an error.
- Notifications are built: an opt-in weekday Telegram message (new automatic recommendations and tickers that moved a lot; tickers, actions and percentages only, never amounts), connected and managed from Account. Not yet built or decided: any other channel (email, push), any live/streaming price feed.
- Legal and privacy position is open: with other people's financial data the GDPR household exemption no longer applies (privacy notice, data export and deletion are needed), and recommendations given to others may count as investment advice in some jurisdictions. Screens must carry a plain "advisory only, not investment advice" statement; the product must not claim more than the backend does.
- Recommendation actions and statuses are fixed by the backend: actions BUY, ADD, HOLD, TRIM, SELL, WATCH; status PENDING, APPROVED, REJECTED.
- The monthly contribution planner is built: the person enters an amount (or uses a saved one) and gets a plan of how much to put into each targeted holding or watchlist item, from their target weights and the analysis's pending calls, as advice on a screen, with an optional monthly Telegram reminder and a Today drift card. It is plain arithmetic: no Claude call, no cost.
- Order tickets are built: each line of a saved plan becomes a copyable order text (name, optional ISIN, amount, about how many shares), and "Placed" records that the person placed it, which creates the holding if new and logs the buy through the same code as the trade log. The person types the real fill price (the plan's EUR price is never logged); there is no undo: a SELL in the trade log corrects the share count but not the average cost, so to get both right (or to fix a wrong price, or an order that was never placed) edit the holding's shares and average cost on the holdings page; the line stays marked placed. The Orders tab (open lines across all saved plans) has its backend, `GET /plans/orders/open`; the screen follows. Not built: a broker preference, automatic ISIN lookup. An ISIN can be entered by searching for it when adding a holding or a watchlist item (the search accepts an ISIN and the form saves it with the ticker); search by name gives no ISIN (Yahoo results carry none) and the price library has none for the London and Swiss ETFs, so otherwise it stays manual on the ticket.
- Mixed currencies: closed for the plan, which converts each ticker to EUR at plan time (a fixed list of currencies; the rate used is stored only on a saved plan). Still an open gap for the portfolio totals: there is no currency field in the data model, so totals across EUR and USD holdings are not currency-normalized.

## Brand Commitments

None established. There is no existing name treatment, logo, or identity beyond the repository name `trade-agent`.

## Evidence on Hand

- Real backend responses from a running local API, no production data.
- No logos, screenshots, testimonials, or user research. Do not fabricate any.

## Product Principles

- Decisions first: the thing that needs the owner's decision is always the first thing seen.
- Show the reasoning, keep it honest: quantitative signals and the AI's qualitative second opinion are visibly different kinds of evidence, and a conflict between them is stated, never smoothed over.
- Advisory, never executing: the interface makes it impossible to mistake a recorded decision for a placed trade.
- Fast for a glance, deep on demand: a quick daily check must work on a phone in seconds, with depth one step away.
- Calm about money: no hype, no urgency theatre, measured language matching the backend's own tone.
- Private by structure: one user's data is never visible to another, including the admin. Admin screens are built so this is visible ("you manage access, not data"), not merely promised.
- Limits are explained, not enforced silently: when a usage limit is reached the user learns what it is, when it resets, and who to ask.

## Accessibility & Inclusion

No product-specific requirement established beyond baseline good practice (readable contrast, keyboard operability, honoring reduced-motion).
