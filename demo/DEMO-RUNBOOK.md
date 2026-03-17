# Flower Market Demo Runbook (3-4 windows)

## Goal
Show challenger + two SP dashboards and a live Nostr feed view.

## Prereqs
- `npm install`
- runtime daemon reachable on `127.0.0.1:8787`
- UI dev server on `127.0.0.1:5173`

## Start

Terminal A:
```bash
cd /home/tom/code/flower-market
npm run runtime:daemon
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
1. In challenger window, select blob and click **Start 30s Auto Challenges**.
2. In SP1 and SP2 windows, click **Respond** on open challenges.
3. Watch challenger "Recent Settlements + Ecash Receipts" populate.
4. Watch SP views "Payout receipts" and "Last paid" update.

## Notes
- SP2 is now wired as a separate runtime identity (`provider2`).
- Payout receipts are demo ecash receipts from `EcashPayoutAdapter`.
- This is a demo payout path, not production mint custody logic.
