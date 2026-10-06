# Connect Claude: design direction (gate file)

Date: 2026-10-06. Branch: feature/user-claude-keys.

## Shown

Three directions, each covering the same eleven screens (guide in three states, Chat locked and
reconnect, Run analysis locked, Today reminder, Account in three states, admin Users), in dark and
light, desktop and phone. Sources: `a-one-step-at-a-time.html`, `b-whole-page.html`,
`c-key-card.html`. Screenshots: `shots/{a,b,c}-{dark,light}-{desktop,phone}.png`.

## Chosen

User's words: "ok lets go for option A" (A, one step at a time), after asking what Back does on
step 4 (answer below, which is part of the approved design).

## Decisions that come with A

- The guide is a page, `/more/connect-claude`, reached from Today, Chat and Account (not a dialog).
- Desktop: a step rail on the left, one large step card on the right, the reassurance note under it.
  Phone: the rail becomes five progress dashes inside the card.
- Back goes to the previous step; steps before the current one show a check, later ones are plain.
  Earlier rail items are clickable; later ones are not until reached. Step 1 has no Back button.
- Checkmarks mean "moved past this step"; nothing external is verified, so the wording is
  "I have the key, next", never "done".
- The current step lives in the address (`?step=4`), so a refresh or a return from Anthropic's tab
  keeps the place.
- The pasted key is held only in the open field: never in the address, storage, or state after a
  save. Going Back from step 5 and returning shows an empty box.
- Locked Chat: a compact card (key icon, title, one line, button) in the composer's place. Reconnect
  variant: amber, "Your Claude key needs attention", button "Reconnect".
- Today: a card at the top "Connect Claude to start analyzing" with "Set up"; Run analysis disabled
  with the line "Connect Claude to run an analysis. Everything else works without it."
- Account: a "Claude" panel with a status chip; connected shows `sk-ant-…<last4>` with Replace and
  Remove (Remove asks "Remove your Claude key?" and says portfolio and history stay).
- Admin Users: a "Claude" column with chips Connected / Needs attention / Not connected; the note
  "You see only whether a key is connected, never the key and never its digits."
