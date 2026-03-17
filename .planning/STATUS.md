# Flower Market Status

Last updated: 2026-03-17

## Objective
Deliver a 3-4 window demo flow: challenger + two SP views + external Nostr feed view.

## Current phase
Phase 2 — demo orchestration and UI workflow hardening.

## Implemented
- Runtime scaffold and daemon APIs (challenge/response/market flows)
- UI mode switching with dedicated views: `challenger`, `sp1`, `sp2`, `all`
- Challenger recurring challenge controls (manual + every 30s)
- Challenger file health table (content refs, responders, last checked)
- SP1/SP2 dashboard views (tracked files, last paid, open challenges)

## Next checkpoint
Wire SP2 to a real second runtime provider identity (currently demo placeholder), and add explicit challenge-note posting strategy for feed UX.
