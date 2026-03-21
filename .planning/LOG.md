# LOG

## 2026-03-14
- Established Flower Market project repo and docs baseline.
- Added ContextVM settlement + deterministic envelope code.
- Added 8 passing tests under `packages/flower-contextvm`.
- Enabled non-watch test mode (`vitest run`) to avoid noisy SIGTERM behavior.
- Initialized `.planning/` as GSD-style progress control center.
- Implemented Merkle proof verifier core and adversarial vectors in `flower-contextvm`.
- Added coverage tooling and enforced >=95% thresholds.
- Reached 100% coverage across settlement/envelope/proof/index modules.
- Ran schema lock pass for `spec/flower-market-v0.1.md`.
- Added storage-agnostic compatibility model and reference compatibility tests.
- Added and validated reference conformance fixture set (proof, settlement, envelope).
- Maintained 100% coverage after fixture-based conformance tests.
- Implemented P3 pipeline integration where validity is computed internally from proofs and deadlines.
- Verified P3 with dedicated tests; coverage remains 100%.
- Drafted P5 marketplace protocol schema with eligibility state machine and cooldown rules.
- Implemented marketplace fixture-backed conformance tests and runtime helpers.
- Coverage remains 100% after P5b additions.
- Ran unified spec consistency pass and aligned protocol/marketplace docs to implemented runtime semantics.
- Added pipeline fixture vectors and fraud vectors with executable tests.
- Coverage remains 100% after adding P5c fraud/dispute runtime hooks.
- Added UI/UX spec doc and minimal UI scaffold app; verified `ui:build` success.

## 2026-03-17
- Added multi-window demo modes in `apps/flower-ui` (`challenger`, `sp1`, `sp2`, `all`).
- Added challenger controls for manual + 30s recurring challenge publishing.
- Added tracked-file summary for challenger (responders + last checked).
- Added SP1/SP2 dashboard views for tracked files and open challenge visibility.
- Updated planning docs to include demo progress while retaining core roadmap items (including payout adapter work).
- Drafted exact reputationScore formula in protocol spec.
- Added provider-bound encrypted replica guidance to prevent cross-provider response replay.
- Clarified project boundaries: no cross-project `jmcorgan/fips` planning items in Flower Market roadmap.
- Added new workspace package `packages/flower-payout` with `EcashPayoutAdapter` interface + tests.
- Updated root workspaces/build/test scripts to include `flower-payout`.
- Wired runtime settlement flow to emit ecash payout receipts.
- Wired SP2 as a real second runtime provider identity (`provider2`).
- Added challenger/SP payout receipt panels and demo runbook at `demo/DEMO-RUNBOOK.md`.
- Added challenger quick-seed blob action and bulk `SP1+SP2 Respond All Open` action.
- Added deterministic demo timeline script: `demo/run-demo-timeline.mjs`.

## 2026-03-21
- Added a file-backed autonomy checkpoint store in `packages/flower-runtime`.
- Added a background autonomous SP responder loop with jittered dispatch and replay-safe response tracking.
- Added runtime status exposure for loop health, cursor, pending count, and checkpoint path.
- Added regression tests for autonomous response, duplicate suppression, and restart recovery.
- Added `/api/status` health visibility for the runtime daemon.
