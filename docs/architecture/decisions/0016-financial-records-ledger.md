# ADR-0016: Cash-first payments and an append-only double-entry ledger

- Status: Accepted
- Date: 2026-10-23

## Context

At launch, rides will be paid in cash to the driver (FIN-5). The platform earns commission, which drivers owe. Financial history must be auditable and reconcilable. A mutable balance is not acceptable as the record. Cash obligations must not be confused with cash collected.

## Decision

- **Ride payment record.** On completion, `ride_payments` stores the obligation (`amount_due` = agreed fare, method `cash`, status `awaiting_collection`). The driver later reports `collected` (with the amount) or `reported_unpaid`. These are operational facts, not platform money.
- **Platform ledger (double entry).** `ledger_transactions` group `ledger_entries` (signed integer minor units; debit positive). A deferred constraint trigger enforces that each transaction sums to zero per currency. The backend role can only insert and select.
- **v1 transaction kind:** `ride_commission`: debit `driver_commission_receivable` (driver), credit `platform_commission_revenue`, posted at completion (FIN-2). `UNIQUE (kind, ride_id)` makes it idempotent.
- Balances, such as a driver's commission owed, are computed by summing entries.
- Future kinds (settlement, reversal, refund, penalty, digital-payment clearing) are added as new transaction kinds and account types. Corrections are always new reversing transactions, never edits.

## Alternatives considered

- **A balance column per driver.** Not auditable and prone to lost updates.
- **Single-entry financial events.** Simpler, but nothing guarantees that every movement has a counterpart.
- **External ledger service.** Premature.

## Rationale

Double entry with database-enforced balance and append-only privileges makes financial history verifiable at low cost.

## Consequences

- Driver earnings are a query, not a stored number.
- Commission is computed with integer arithmetic (round half up) from the rate snapshotted on the assignment.

## Risks

- Charging commission when cash was not collected (FIN-3) may be unfair to drivers until the dispute and reversal workflow exists.
