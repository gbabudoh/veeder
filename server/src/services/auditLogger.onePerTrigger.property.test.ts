// Feature: user-registration-backend, Property 28: One event per applicable trigger
/**
 * Property-based test for "one event per applicable trigger".
 *
 * Design reference: `design.md` -> "Property 28: One event per applicable
 * trigger". Every public Audit_Logger method records EXACTLY ONE Auth_Event, so
 * a caller that invokes the logger once per trigger produces exactly one
 * persisted event per invocation (Req 11.7).
 *
 * This test drives {@link createAuditLogger} with a mock repository that counts
 * `insert` calls and records the `eventType` of each. For any generated sequence
 * of method invocations drawn from {registration, login-success, login-failure,
 * logout} (with fc-generated arguments), after awaiting all of them:
 *
 *  - the mock repo's `insert` was called EXACTLY once per invocation
 *    (total insert count === number of operations), and
 *  - the recorded `eventType`s match the invoked operations in order.
 *
 * No datastore is involved: the repository is a lightweight in-memory mock, so
 * this property exercises only the logger's one-record-per-call contract.
 *
 * The global fast-check config (see `src/test/setup.ts`) runs a minimum of 100
 * iterations per property; `numRuns: 100` is asserted explicitly as a floor.
 *
 * Validates: Requirements 11.7
 */
import fc from 'fast-check';
import {
  createAuditLogger,
  type AuditEventRepo,
} from './auditLogger';
import type {
  AuthEventInput,
  AuthEventRecord,
  AuthEventType,
} from '../repositories/authEventsRepository';

/** The four audit operations and the event type each one records. */
type Operation =
  | { kind: 'registration'; userId: string }
  | { kind: 'login-success'; userId: string; sourceIp: string | undefined }
  | { kind: 'login-failure'; email: string; sourceIp: string | undefined }
  | { kind: 'logout'; userId: string };

/** The event type that each operation kind is expected to persist. */
const EXPECTED_EVENT_TYPE: Record<Operation['kind'], AuthEventType> = {
  registration: 'registration',
  'login-success': 'login-success',
  'login-failure': 'login-failure',
  logout: 'logout',
};

// An optional source IP: either a plausible dotted value or `undefined` so the
// placeholder path is exercised; the placeholder never adds or removes inserts.
const optionalIp = fc.option(
  fc.stringOf(fc.constantFrom(...'0123456789.:abcdef'.split('')), {
    minLength: 0,
    maxLength: 20,
  }),
  { nil: undefined },
);

const operationArb: fc.Arbitrary<Operation> = fc.oneof(
  fc.record({ kind: fc.constant('registration' as const), userId: fc.string() }),
  fc.record({
    kind: fc.constant('login-success' as const),
    userId: fc.string(),
    sourceIp: optionalIp,
  }),
  fc.record({
    kind: fc.constant('login-failure' as const),
    email: fc.string(),
    sourceIp: optionalIp,
  }),
  fc.record({ kind: fc.constant('logout' as const), userId: fc.string() }),
);

// A sequence of at least one operation; upper bound keeps runs fast.
const operationsArb = fc.array(operationArb, { minLength: 1, maxLength: 20 });

/**
 * Build a mock repository that counts `insert` calls and records the
 * `eventType` of each in invocation order. It never touches a datastore and
 * always resolves successfully so exactly one insert corresponds to one call.
 */
function createCountingRepo(): {
  repo: AuditEventRepo;
  recordedTypes: AuthEventType[];
  count: () => number;
} {
  const recordedTypes: AuthEventType[] = [];
  const repo: AuditEventRepo = {
    async insert(input: AuthEventInput): Promise<AuthEventRecord> {
      recordedTypes.push(input.eventType);
      return {
        id: `evt-${recordedTypes.length}`,
        eventType: input.eventType,
        userId: input.userId ?? null,
        email: input.email ?? null,
        sourceIp: input.sourceIp ?? null,
        occurredAt: input.occurredAt ?? new Date(0),
      };
    },
  };
  return { repo, recordedTypes, count: () => recordedTypes.length };
}

/** Invoke a single operation on the logger, returning its pending promise. */
function invoke(
  logger: ReturnType<typeof createAuditLogger>,
  op: Operation,
): Promise<void> {
  switch (op.kind) {
    case 'registration':
      return logger.recordRegistration(op.userId);
    case 'login-success':
      return logger.recordLoginSuccess(op.userId, op.sourceIp);
    case 'login-failure':
      return logger.recordLoginFailure(op.email, op.sourceIp);
    case 'logout':
      return logger.recordLogout(op.userId);
  }
}

describe('createAuditLogger - Property 28: one event per applicable trigger', () => {
  it('records exactly one insert per invocation with event types matching the operations in order (Req 11.7)', async () => {
    await fc.assert(
      fc.asyncProperty(operationsArb, async (operations) => {
        const { repo, recordedTypes, count } = createCountingRepo();
        const logger = createAuditLogger({ repo, now: () => new Date(0) });

        // Await every invocation; each method call must produce exactly one insert.
        for (const op of operations) {
          await invoke(logger, op);
        }

        // Total insert count equals the number of operations (one per trigger).
        expect(count()).toBe(operations.length);

        // Recorded event types match the invoked operations, in order.
        const expectedTypes = operations.map((op) => EXPECTED_EVENT_TYPE[op.kind]);
        expect(recordedTypes).toEqual(expectedTypes);
      }),
      { numRuns: 100 },
    );
  });
});
