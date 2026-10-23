import { driverDocumentStateMachine, driverStateMachine } from '../../src/modules/drivers';
import { commissionPolicyStateMachine, paymentStateMachine } from '../../src/modules/finance';
import { vehicleStateMachine } from '../../src/modules/fleet';
import {
  assignmentStateMachine,
  offerStateMachine,
  rideStateMachine,
} from '../../src/modules/mobility';
import { farePolicyStateMachine } from '../../src/modules/pricing';
import type { StateMachine } from '../../src/shared/state-machine';
import { createTestDatabase, type TestDatabase } from '../support/test-database';

/**
 * The database backstop (taketuk.status_transitions + trigger) and the domain transition tables
 * must describe exactly the same lifecycles (docs/domain/STATE_MACHINES.md, introduction).
 */
describe('state machine parity between code and database', () => {
  let db: TestDatabase;

  beforeAll(async () => {
    db = await createTestDatabase();
  });
  afterAll(async () => {
    await db.drop();
  });

  const machines: StateMachine<string, string>[] = [
    driverStateMachine,
    vehicleStateMachine,
    driverDocumentStateMachine,
    farePolicyStateMachine,
    commissionPolicyStateMachine,
    rideStateMachine,
    offerStateMachine,
    assignmentStateMachine,
    paymentStateMachine,
  ];

  it.each(machines.map((m) => [m.entity, m]))('%s', async (entity, machine) => {
    const { rows } = await db.admin.query<{ from_status: string; to_status: string }>(
      `select from_status, to_status from taketuk.status_transitions where entity = $1 order by 1, 2`,
      [entity],
    );
    const fromDb = rows.map((r) => `${r.from_status}->${r.to_status}`).sort();
    const fromCode = machine
      .pairs()
      .map(([from, to]) => `${from}->${to}`)
      .sort();
    expect(fromDb).toEqual(fromCode);
  });

  it('covers every entity in the database table', async () => {
    const { rows } = await db.admin.query<{ entity: string }>(
      `select distinct entity from taketuk.status_transitions order by 1`,
    );
    expect(rows.map((r) => r.entity)).toEqual(machines.map((m) => m.entity).sort());
  });
});
