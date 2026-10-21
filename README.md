# Multi-chain Finality Services Section

<!-- 561-group-standards:badges:start -->
[![Red Cup Engineering](https://img.shields.io/badge/561%20Group-Red%20Cup%20Engineering-c0392b)](https://github.com/red-cup-engineering)
[![License: MIT](https://img.shields.io/badge/license-MIT-c0392b)](LICENSE)
[![Indigenous data: CARE](https://img.shields.io/badge/Indigenous%20data-CARE-4b6f44)](https://github.com/red-cup-engineering/.github/blob/main/GOVERNANCE.md)
[![Tips welcome](https://img.shields.io/badge/tips-welcome-d4a017)](https://github.com/561-group/.github/blob/main/TIPS.md)
<!-- 561-group-standards:badges:end -->

This provider imports only finalized, chain-qualified EVM receipts and merges
sovereign views by grow-only receipt union and FOUR's bitwise knowledge join.
It refuses replay drift and simultaneous active custody. Reorganizations append
negative evidence and therefore move a prior positive claim to `both`; they do
not delete history.

The wire profile pins ERC-7786 as Final and the 2026-07-19 ERC-7930 Review
syntax. ERC-7786 supplies the gateway/recipient interface; it does not supply a
bridge's safety. Every deployment must separately name the gateway, finality,
replay, reorganization, and threat profile. ERC-7930 bytes must follow CAIP-350.
