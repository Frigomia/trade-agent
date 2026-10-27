# Chat in the Soft direction

Proposed 2026-10-27 for [#195](https://github.com/Frigomia/trade-agent/issues/195) (the Soft restyle of the screens still on the older look), after Plan, Account and Preferences. This is a mock and a plan, not a change to the app. Nothing is approved until the owner says so; then this folder gets a `direction-approved.md` like the others.

Mock: [chat-soft.html](chat-soft.html) (`chat.css`, `chat.js`; it loads the shared Soft files from `../today-discovery`, `../company-overview`, `../portfolio`, `../plan` and `../account`). Add `?theme=dark` to start dark; `?show=d-chat,phones` shows only some blocks and `?st=2-4` only some states. Screenshots in `shots/`, light and dark: `chat-desk` (a conversation), `chat-empty` (the starters), `chat-phones` and `chat-states`.

## What changes and what does not

Same content, same states, same copy as the app today. Chat is already close to the Soft look (a tinted bubble, replies in a panel, the dashed web box); what is still on the older look is the pieces around them.

| Part | Today | Soft proposal |
|---|---|---|
| Header | Title, a small allowance with a thin bar (amber near and at the limit), a small trash icon | The Soft page title, the allowance, and a 44px round Clear chat button. **New:** the words "Near limit" and "At limit" beside the amber bar (Account's usage already says them), so the state is not colour alone |
| Starter questions | Three small outlined buttons | Three full-width rows (48px, a hairline, an arrow), so they read as the way in |
| Your message | A rounded tinted bubble | The same tint with the tail corner squared (18/18/6/18), right-aligned, 85% wide at most |
| A reply | A panel of markdown | The same panel with its top-left corner squared (6/22/22/22), so a reply reads as a reply; the web part stays the dashed box "From the web · not part of the score" |
| Waiting | The word "Thinking…" | Three dots and the same word, still announced as a status |
| Message box | A MUI text field beside a round Send button | One rounded field (a hairline, a focus ring) with the round Send inside it; off (greyed) while a reply is coming, the allowance is used, or Chat is off |
| Advisory line | Small centred text above the box | The same, 12px |
| Alerts (could not get a reply, allowance used, Chat off) | MUI alerts | The shared error and amber boxes, same copy |
| Claude key needed or needing attention | A panel in the box's place | The same panel on the Soft tokens: a key icon and a primary "Connect Claude", or a warning icon with an outlined "Reconnect" on the amber tint |
| Clear chat confirmation | A default MUI dialog | The shared Soft dialog; on a phone the same bottom sheet as the Plan dialogs (shown in `../plan/shots`). Same text, "Delete this conversation? This cannot be undone." |

No new data and no backend change. Every field is one the page already reads (`/chat/messages`, `/me/usage`, the Claude key status). The only new copy is the two allowance words above. "Advisory only, not investment advice." stays above the box.

Rules kept from `DESIGN.md`: sizes in rem (13px body, 12px label, 15px lead; nothing in the screen below 12px), green and red only for a price move (red here is for the error and Delete, as elsewhere), shape plus word for every status (the allowance carries a word and the key states an icon and a word), AI text in the web-derived part stays in a dashed box, 44px touch targets on a phone, no horizontal scroll at 390px.

## States in the mock

A conversation (with a web part), empty with the starters, a reply is coming (the box off), a question typed from "Ask AI" on a company (typed, not sent), a reply that failed (the question back in the box), the monthly allowance used, Chat turned off, no Claude key, a key that needs attention, and the Clear chat confirmation. Light and dark, desktop and phone.

## Decisions for you

1. **Approve the look**, or say what to change. One proposal on the approved Soft direction; say if you want alternatives.
2. **The squared corners** on the two kinds of message (a small chat-app cue). Say if you prefer all four corners round, as today.
3. **Starters as rows** instead of small buttons. They stay buttons that send the question at once, as today.
4. **The two allowance words** ("Near limit", "At limit") in the header, as on Account. Say if you want the bar's colour alone, as today.
5. **Build:** one PR (Chat is one page and four small components). No order question.

## Build notes (after approval)

- Components: `app/(shell)/chat/page.tsx`, `MessageBubble`, `Composer`, `UsageMeter`, and `ClaudeRequired` (shared with Today, so its look changes there too). Reuse `Panel`, the Soft tokens and the shared dialog and alert styling from the MUI theme.
- Keep every test that asserts text, roles or labels (the `Message` box label, `Send`, `Clear chat`, the starter texts, the status "Thinking…").
- The off-ramp sizes (0.78125rem, 0.84375rem, 0.875rem) in these files move onto the type ramp.
- A browser pass at 1280, 390 and 320px, light and dark, with a long reply, a reply with a web part, a code block or table (it must scroll inside the reply, not the page) and a long unbroken word before the PR. The composer's strip keeps the page background so messages do not show through it.
