# NOW

## In progress

1. **Merkle proof verifier (TDD)**
   - Files: `packages/flower-contextvm/src/proof.ts`, `proof.test.ts`
   - Acceptance:
     - valid proof returns true
     - wrong sibling order fails
     - tampered leaf fails
     - wrong root fails

2. **Settlement integration with proof validity flag**
   - Ensure invalid proofs are excluded before ranking

3. **Spec hardening for deterministic rules**
   - Update `design/flower-market/contextvm-v0.md` with canonical hash/input requirements
