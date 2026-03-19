# Flower Market Demo Runbook (4-5 windows)

## Goal
Show challenger + three SP dashboards, inter-SP transfer via Market Stall, and a live Nostr feed view.

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
4. SP3: <http://127.0.0.1:5173/?view=sp3>
5. Feed: click "Open owner feed in jumble.social" from challenger panel

## Demo flow
1. In challenger window, click **Seed Blob** once.
2. In challenger window, in **Inter-SP Data Market (Market Stall)** request transfer:
   - `From SP`: SP1
   - `To SP`: SP3
   - fees (for example): supplier `5 sats`, stall `1 sat`
3. Verify **Replica Registry (CID → SP roots)** now includes SP3 for the CID.
4. Start challenges (**Post Challenge Now** or **Start 30s Auto Challenges**).
5. Watch challenger **Recent Settlements + Payout Receipts** populate with 3-tier payouts (15/12/9 sats).
6. Watch SP views for tracked files, payout receipts, and last paid times.
7. Watch **Market Stall Transfer Receipts** for inter-SP transfer + fee breakdown.

## Deterministic one-shot timeline script

With daemon running:

```bash
cd /home/tom/code/flower-market
node demo/run-demo-timeline.mjs
```

This seeds a blob, publishes one challenge, has provider+provider2 respond, then prints winners and payout receipts.

## Notes
- SP2 and SP3 are separate runtime identities (`provider2`, `provider3`).
- Payout receipts in this demo flow are shown as Lightning payout records.
- Market stall transfer flow models: requester pays supplier fee + stall fee; stall fee is deducted from supplier economics and credited to stall (`settler`) in balances.
- This is a demo payout path, not production mint custody logic.
