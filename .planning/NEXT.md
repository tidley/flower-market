# NEXT

1. Harden the autonomy checkpoint format once relay-backed persistence is added
2. Formalize `spec/flower-market-v0.1.md` with MUST/SHOULD language
3. Add conformance vectors (json fixtures)
4. Add replayable settlement artifact format (programHash/inputHash/outputHash + signatures)
5. Implement marketplace phase: peer buy/sell replication flow
   - listing, offer, accept, transfer-proof, settlement
   - delayed eligibility after successful transfer verification
6. Add simulation script for challenge rounds and ranking output
7. Expand runtime observability for the autonomy loop into the UI status panels
