import { AppError } from './errors/app-error';

/** Marker used for "row creation" transitions; mirrors '(initial)' in taketuk.status_transitions. */
export const INITIAL = '(initial)' as const;

export interface TransitionRule<S extends string, A extends string> {
  readonly from: S | typeof INITIAL;
  readonly to: S;
  /** Who may initiate this transition (docs/domain/STATE_MACHINES.md). */
  readonly actors: readonly A[];
}

/**
 * An explicit, data-defined state machine. The same transition pairs are seeded into
 * taketuk.status_transitions by migrations; an integration test asserts they are identical.
 */
export class StateMachine<S extends string, A extends string> {
  constructor(
    readonly entity: string,
    readonly rules: readonly TransitionRule<S, A>[],
  ) {}

  allows(from: S | typeof INITIAL, to: S, actor: A): boolean {
    return this.rules.some((r) => r.from === from && r.to === to && r.actors.includes(actor));
  }

  isDefined(from: S | typeof INITIAL, to: S): boolean {
    return this.rules.some((r) => r.from === from && r.to === to);
  }

  assert(from: S | typeof INITIAL, to: S, actor: A, detail?: string): void {
    if (!this.allows(from, to, actor)) {
      throw new AppError(
        'INVALID_STATE_TRANSITION',
        detail ?? `A ${this.entity} cannot move from '${from}' to '${to}' by ${actor}.`,
        { extensions: { currentStatus: from } },
      );
    }
  }

  /** Distinct (from, to) pairs, as stored in the database transition table. */
  pairs(): ReadonlyArray<readonly [string, string]> {
    const seen = new Set<string>();
    const result: Array<readonly [string, string]> = [];
    for (const rule of this.rules) {
      const key = `${rule.from}->${rule.to}`;
      if (!seen.has(key)) {
        seen.add(key);
        result.push([rule.from, rule.to]);
      }
    }
    return result;
  }
}
