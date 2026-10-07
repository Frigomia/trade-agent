# Telegram panel: design direction (gate file)

Date: 2026-10-07. Branch: feature/telegram-notifications.

## Shown

Three directions for the Account "Telegram" panel, each in five states (not connected, waiting for
Start, connected, blocked, not available on this server), dark and light, desktop and phone, plus a
sample message in a chat for A and B. Sources: `a-quiet-panel.html`, `b-steps-and-rows.html`,
`c-live-preview.html` (shared `tg.js`, `tg.css`). Screenshots: `shots/{a,b,c}-{dark,light}-{desktop,phone}.png`.

## Chosen

User's words: "lets go with C, but lets gonna align the cards, they should align to the top the same".
After the alignment fix (the preview is a card of the same kind as the settings card, tops and heights
equal) the user answered "looks good".

## Decisions that come with C

- The panel sits on Account under the Claude panel: a two-column row on desktop (settings card left, a
  "What a message looks like" preview card right, equal tops and heights); on a phone the preview card
  comes first and the settings card follows.
- Settings card: title "Telegram" with a status chip (Connected / Needs attention / Not connected); in
  the connected state two switches ("Morning digest": "New recommendations from the automatic analysis."
  and "Price moves": "Tickers that moved at least the threshold since the previous close."), the "Move
  threshold" field (number with a % suffix, hint "1 to 50"), the note "Messages list tickers and actions
  only, never amounts or reasoning. Advisory only." and a "Disconnect" button.
- Not connected: the pitch "Get a short message on weekday mornings when there is something to look
  at." and the "Connect Telegram" button, plus the note. After pressing it the link opens in a new tab
  and the card shows "Waiting for you to press Start in Telegram…" with a three-dot indicator, "The link
  works for 10 minutes.", "Open Telegram again" and "Cancel".
- Blocked: chip "Needs attention", the warning line "Telegram stopped receiving messages. Reconnect to get
  them again.", buttons "Reconnect" and "Disconnect".
- Not available on this server (the backend says `configured: false`): a card with only the title and
  "Telegram is not available on this server."; the preview card is not shown.
- The preview card is a sample chat: a small "trade-agent bot" label, one bubble with the sample message
  lines (digest line, moves line, link to Today) and the footer "Advisory only. Nothing is sent to a
  broker.", and a time stamp. The preview is static sample data in version one (it does not reflect the
  switches).
