# DONE

## 2026-03-14

- Forked/bootstrapped Flower Market repo and pushed to ngit + GitHub
- Rewrote project README for Flower Market
- Added ngit links at top of README
- Added initial ContextVM flow chart in docs
- Disabled inherited GitHub test workflow
- Created ContextVM settlement scaffold package
- Added TDD tests for settlement kernel (5)
- Added TDD tests for deterministic envelope hashing (3)
- Implemented Merkle proof core (`hashLeaf`, `hashPair`, `verifyMerkleProof`)
- Added proof/adversarial test vectors (valid, wrong-order, tampered leaf, wrong root)
- Added coverage gate (`vitest --coverage`) with threshold 95%+
- Achieved 100% coverage (lines/branches/functions/statements) for `flower-contextvm`
- Added protocol draft: `spec/flower-market-v0.1.md` (normative schemas + deterministic rules)
- Completed schema lock pass (field constraints, reject rules, storage-agnostic interface, reference tests)
- Added conformance JSON fixtures under `spec/fixtures/v0.1/`
- Added executable conformance test (`conformance.test.ts`) bound to fixtures
- Completed P3: integrated proof+deadline validation into settlement pipeline (`settleChallengeFromProofs`)
- Added pipeline tests for invalid proof exclusion, deadline rejection, and root mismatch rejection
