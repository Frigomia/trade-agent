# Direction approved: the signed-out screens

## What was shown (2026-11-03)

Three directions, each as a real mock with light, dark and phone shots (see [SPEC.md](SPEC.md)):

- A · The Door: [a-door.html](a-door.html), [shots/a-login-desk-light.png](shots/a-login-desk-light.png)
- B · The Note: [b-note.html](b-note.html), [shots/b-login-desk-light.png](shots/b-login-desk-light.png)
- C · The Proof: [c-proof.html](c-proof.html), [shots/c-login-desk-light.png](shots/c-login-desk-light.png)

## The owner's choice

"lets take the option c, but lets iterate over this. Still looks vibecoded, this looks like a boilerplate template generated in 10 minutes by an LLM using a stock Tailwind or shadcn UI kit. If a serious institutional investor, trader, or enterprise buyer lands on this page, they won't trust it with sensitive data or high-stakes workflows."

## What this means

- Direction **C** (show the product's reasoning beside the form) is chosen, **not yet approved to build**: the first version of C is rejected as too template-like. The second pass, [c2-proof.html](c2-proof.html) ([shots/c2-login-desk-light.png](shots/c2-login-desk-light.png)), is kept as a record; the third pass, [c3-proof.html](c3-proof.html) ([shots/c3-login-desk-dark.png](shots/c3-login-desk-dark.png)), is the proposal now on the table after these notes: "Kill the input icons ... Purge the placeholder baggage: Strip out the Logo.dev text and any default error badges ... Move away from soft, pill-shaped UI elements and generic blue gradients ... make it look authoritative, dark, and precise".
- A and B are not chosen. They stay in this folder as the record of what was shown.
- Open until the owner approves C3 or asks for another pass: the three assurance lines under the form (new copy), 3px corners and a dark default (the Soft system uses 14px and follows the theme), and where the Logo.dev credit moves to.

## Update, 2026-11-03: back to C v1 with the owner's reference image

After C3 the owner wrote: "lets go back option C v1 and use the images as reference. we need something modern like the image." (The image: a pale blue field with soft curves, a big headline, a research card over a track-record strip, a white rounded form card.) Three options were built from it: [d1-reference.html](d1-reference.html), [d2-stage.html](d2-stage.html), [d3-window.html](d3-window.html), with shots `shots/d1-*`, `d2-*`, `d3-*`. Waiting for the owner's pick. C2 and C3 stay as the record of the other direction. Not approved to build.

## The owner's choice, 2026-11-03: D1

"lets go for D1, but lets gonna position better the card, there should not be that big empty space. also for mobile."

- **Chosen: D1 · The Reference** ([d1-reference.html](d1-reference.html)).
- **Fix asked for and made in the mock:** on a tall window the left column stretched and pushed the headline to the top and the card to the bottom. The headline, the line under it and the research card are now one group, centred beside the form (`shots/d1-login-desk-tall-light.png`, `d1-login-desk-dark.png` at 1920x1080). On a phone the headline and the form sit together at the top instead of the form floating in the middle (`shots/d1-login-phone-light.png`, 489x1257).
- **Still open before a build:** the owner's go-ahead on the final mock; the "+3.1%" (keep, or drop it); icons in the fields (D1 keeps them, as the reference does); where the Logo.dev credit moves to inside the app; the logo mark (raster); a "Back to sign in" link on the dead-end screens.
