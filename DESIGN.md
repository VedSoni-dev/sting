# Sting: design

Written before any UI code (the taste skill's brief), then kept true to what shipped.

- **Theme:** dither (`kit/ui/themes/dither.css`), adjusted below.
- **One-line feel:** <!-- e.g. "a calm notebook that thinks with you" -->
- **Type:** display Geist Mono 600 (tight, -0.045em), body Geist, mono Geist Mono for every label. Sizes: h1 clamp(2.6–4.6rem), HUD labels .6–.72rem uppercase, tracked .14em.
- **Colour:** background #0a0a0a, ink #f2f2f0, ONE accent #ff4d00 (used for: the primary action and the live state only).
- **The hero moment:** <!-- the one thing on the landing page that makes someone stop scrolling -->
- **Motion:** follows docs/principles.md from the studio (springs ≤300 ms, arcs, staggered settle, instant frequent actions). Signature motion for this build: agents fly great-circle arcs to their task's target, routes march (dashed offset), targets' corner brackets turn, a new finding pings once.
- **Every state designed:** empty (no agents: deploy / connect; empty board: give an order) · loading (COMMAND streams its plan live in the console line) · error (red console line, picker opens with the fix) · success (the finding ping on the map + toast).
- **Reel shots:** the 3 moments in the app that will carry the video: 1) the globe alive with military aircraft and satellites before anything happens 2) an order → tasks bracket cities across the globe 3) a swarm of Claude Code agents flying to them and pins dropping.
