# DECISIONS

## 2026-03-14 — Use TDD as default development mode
- **Decision:** Build Flower Market using strict red->green->refactor loops.
- **Why:** Faster feedback, deterministic behavior, safer protocol evolution.

## 2026-03-14 — Start with deterministic settlement before full proof engine
- **Decision:** Implement settlement kernel + envelope hashing first.
- **Why:** Enables replayable, auditable payout logic early.

## 2026-03-14 — Keep ngit + GitHub dual-push
- **Decision:** Push all progress to both remotes.
- **Why:** Alignment with workflow preference and redundancy.

## 2026-03-14 — Add dedicated marketplace phase
- **Decision:** Add a standalone phase for peer buy/sell replication market.
- **Why:** Replication supply growth and economic incentives are core product scope, not a side feature.
