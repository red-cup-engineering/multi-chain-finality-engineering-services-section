# Multi-chain Finality Services Section

This provider imports only finalized, chain-qualified EVM receipts and merges
sovereign views by grow-only receipt union and FOUR's bitwise knowledge join.
It refuses replay drift and simultaneous active custody. Reorganizations append
negative evidence and therefore move a prior positive claim to `both`; they do
not delete history.

The wire profile pins ERC-7786 as Final and the 2026-07-19 ERC-7930 Review
syntax. ERC-7786 supplies the gateway/recipient interface; it does not supply a
bridge's safety. Every deployment must separately name the gateway, finality,
replay, reorganization, and threat profile. ERC-7930 bytes must follow CAIP-350.
