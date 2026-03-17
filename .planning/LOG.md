# LOG

## 2026-03-15
- Started structured GSD+TDD workflow for fips-nostr-bootstrap.
- Added Vitest with enforced coverage thresholds.
- Implemented and tested bootstrap event validation.
- Expanded state-machine tests for replay/expiry/invalid transitions.
- Verified build and reached 100% test coverage.
- Added deterministic demo fixtures and runnable demo CLI scripts.
- Validated demo preflight/happy/failures flows end-to-end.

## 2026-03-17
- Switched focus to Flower Market demo workflow.
- Updated planning docs (STATUS/NOW/NEXT) for 3-4 window demo objective.
- Added role-based UI views in `apps/flower-ui` via query param (`challenger`, `sp1`, `sp2`, `all`).
- Added challenger controls for recurring 30s challenge posting.
- Added challenger table showing tracked content refs, responders, and last checked timestamps.
- Added SP1/SP2 dashboards with tracked files, last paid signal, and open challenge visibility.
- Logged follow-up plan to wire real second provider identity and `jmcorgan/fips` integration.
