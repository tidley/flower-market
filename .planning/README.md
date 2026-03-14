# .planning (GSD-style)

This folder is the operational control center for Flower Market.

## How to use

- `NOW.md`: what is actively in progress (max 1-3 items)
- `NEXT.md`: queued tasks ready to pull next
- `BACKLOG.md`: ideas and future work
- `DONE.md`: completed milestones (append-only)
- `DECISIONS.md`: architecture/product decisions with rationale
- `RISKS.md`: known risks and mitigations
- `STATUS.md`: concise snapshot for quick context reload
- `LOG.md`: timestamped progress notes

## Workflow

1. Pull from `NEXT.md` -> `NOW.md`
2. Build with TDD (red -> green -> refactor)
3. Record progress in `LOG.md`
4. Move completed items to `DONE.md`
5. Update `STATUS.md`

## Rules

- Keep `NOW.md` short and focused
- Prefer concrete, testable task definitions
- Always include file paths and acceptance criteria
- Record why decisions were made, not just what changed
