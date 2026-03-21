# RISKS

1. **Front-running and replay attacks**
   - Mitigation: commit-reveal + deterministic challenge IDs + nonces

2. **Non-deterministic serialization bugs**
   - Mitigation: canonical stable stringify + conformance vectors

3. **Spec drift vs implementation**
   - Mitigation: treat tests as executable spec, formalize v0.1 doc

4. **Sybil responders dominating rewards**
   - Mitigation: future stake/reputation and anti-sybil constraints

5. **Autonomy loop double-firing on restart**
   - Mitigation: checkpointed response records + in-flight dedupe + replay-safe idempotency checks

6. **Checkpoint corruption or stale cursor state**
   - Mitigation: versioned JSON checkpoint with load fallback and explicit status visibility
