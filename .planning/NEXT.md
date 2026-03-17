# NEXT

1. Formalize `spec/flower-market-v0.1.md` with MUST/SHOULD language
2. Add conformance vectors (json fixtures)
3. Add replayable settlement artifact format (programHash/inputHash/outputHash + signatures)
4. Implement payout adapter interface (`packages/flower-payout`)
   - first backend: ecash mint adapter (demo path)
5. Implement marketplace phase: peer buy/sell replication flow
   - listing, offer, accept, transfer-proof, settlement
   - delayed eligibility after successful transfer verification
6. Add simulation script for challenge rounds and ranking output
7. Add true second provider identity in runtime (`provider2`) and wire SP2 view to it
