# ADR-0010: PostgreSQL-backed background processing and transactional outbox

- Status: Accepted
- Date: 2026-10-23

## Context

Several behaviours run outside a request: dispatch rounds, offer and ride expiry, notification delivery and data cleanup. Notifications must be sent only after state is committed, and must eventually be sent even if the process crashes between commit and send.

## Decision

- **Transactional outbox:** use cases insert `outbox_events` rows in the same transaction as the state change. An in-process `OutboxWorker` claims due events (`FOR UPDATE SKIP LOCKED`, then `claimed_until`), delivers them outside any transaction through registered handlers, and records `published` or reschedules with exponential backoff. After `OUTBOX_MAX_ATTEMPTS` the event becomes `failed`.
- **Dispatch sweeper:** an in-process `DispatchWorker` periodically expires offers and rides and runs dispatch rounds. It locks rides with `FOR UPDATE SKIP LOCKED`, so several instances can run concurrently.
- **Maintenance worker:** deletes expired idempotency records and quotes.
- All business time comparisons use the database clock (`now()`), never the application clock.
- Workers run inside the API process behind `WORKERS_ENABLED`. Tests disable the timers and call the worker methods directly, so the tests are deterministic.

## Alternatives considered

- **A message broker (RabbitMQ, Kafka, SQS) or Redis queues (BullMQ).** Adds infrastructure and cost with no current requirement. The outbox still has to exist for atomicity anyway.
- **pg-boss or Graphile Worker.** Mature PostgreSQL job queues, and a reasonable future step if job types multiply. Today's needs (one outbox and periodic sweeps) are small enough that a dependency is not justified.
- **Supabase Edge Functions or cron.** They split logic across runtimes.

## Rationale

The database is already the source of truth. Using it for durable work keeps the system to one stateful component, and crash recovery is automatic: the sweepers and the outbox resume from database state.

## Consequences

- Dispatch latency is bounded by the sweeper interval (`DISPATCH_TICK_MS`, default 2 s). The first round runs right after ride creation.
- Polling adds light, constant database load, proportional to the instance count.

## Risks

- Polling load at much larger scale. Mitigation: `LISTEN/NOTIFY` wake-ups, then a dedicated job library or broker if operations demand it.
- Handler non-idempotency. Every handler is documented as at-least-once.
