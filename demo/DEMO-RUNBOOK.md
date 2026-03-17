# Flower Market Demo Runbook (3-4 windows)

## Goal
Show challenger + two SP dashboards and a live Nostr feed view.

## Prereqs
- `npm install`
- runtime daemon reachable on `127.0.0.1:<FLOWER_API_PORT>` (default `8787`)
- UI dev server on `127.0.0.1:5173`
- default relay set includes `wss://nos.lol` and `wss://relay.damus.io` (override with `FLOWER_RELAYS` or `--relay`)

## Start

Terminal A:
```bash
cd /home/tom/code/flower-market
# default relay mode (nos.lol + damus)
npm run runtime:daemon
# local fallback if relay connections are flaky:
# npm run runtime:daemon -- --memory
```

Terminal B:
```bash
cd /home/tom/code/flower-market
npm run ui:dev
```

## Open windows
1. Challenger: <http://127.0.0.1:5173/?view=challenger>
2. SP1: <http://127.0.0.1:5173/?view=sp1>
3. SP2: <http://127.0.0.1:5173/?view=sp2>
4. Feed: click "Open owner feed in jumble.social" from challenger panel

## Demo flow
1. In challenger window, click **Seed Blob** once.
2. In challenger window, select blob and click **Start 30s Auto Challenges**.
3. In challenger window, you can use **SP1+SP2 Respond All Open** for fast rounds.
4. In SP1 and SP2 windows, click **Respond** on open challenges (manual mode).
5. Watch challenger "Recent Settlements + Ecash Receipts" populate.
6. Watch SP views "Payout receipts" and "Last paid" update.

## Deterministic one-shot timeline script

With daemon running:

```bash
cd /home/tom/code/flower-market
node demo/run-demo-timeline.mjs
```

This seeds a blob, publishes one challenge, has provider+provider2 respond, then prints winners and payout receipts.

## Notes
- SP2 is now wired as a separate runtime identity (`provider2`).
- Payout receipts are demo ecash receipts from `EcashPayoutAdapter`.
- This is a demo payout path, not production mint custody logic.
 This is a demo payout path, not production mint custody logic.
