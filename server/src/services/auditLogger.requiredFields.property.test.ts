// Feature: user-registration-backend, Property 26: Auth events are recorded with the required fields
/**
 * Property-based test for the required fields on persisted Auth_Events.
 *
 * Design reference: `design.md` -> "Property 26: Auth events are recorded with
 * the required fields". For any triggering operation the corresponding
 * `Auth_Event` must be persisted with the correct type, the required subject
 * fields, and a UTC timestamp:
 *
 *   - `registration`   -> user id + timestamp
 *   - `login-success`  -> user id + source IP + timestamp
 *   - `login-failure`  -> submitted email + source IP + timestamp
 *   - `logout`         -> user id + timestamp
 *
 * When the source IP for a login-success / login-failure event cannot be
 * determined (undefined or blank), a fixed placeholder (`UNKNOWN_SOURCE_IP`)
 * is recorded in its place (Req 11.5).
 *
 * This test uses NO database: a mock {@link AuditEventRepo} records each
 * `insert` input into an array and echoes it back as a record (adding a synthetic
 * `id` and `occurredAt`). A fixed `now` clock is injected so the persisted
 * timestamp is a known, deterministic UTC `Date`.
 *
 * The global fast-check config (see `src/test/setup.ts`) runs a minimum of 100
 * iterations per property; `numRuns: 100` is also set explicitly below.
 *
 * Validates: Requirements 11.1, 11.2, 11.3, 11.4, 11.5
 */
import fc from 'fast-check';
import {
  createAuditLogger,
  UNKNOWN_SOURCE_IP,
  type AuditEventRepo,
} from './auditLogger';
import type {
  AuthEventInput,
  AuthEventRecord,
} from '../repositories/authEventsRepository';

/** A fixed, known UTC instant used as the injected clock for every event. */
const FIXED_NOW = new Date('2024-03-14T15:09:26.535Z');

/**
 * Build a mock repository that records every `insert` input into `captured`
 * and returns a record that echoes that input (with a synthetic id).
 */
function makeMockRepo(): { repo: AuditEventRepo; captured: AuthEventInput[] } {
  const captured: AuthEventInput[] = [];
  const repo: AuditEventRepo = {
    insert(input: AuthEventInput): Promise<AuthEventRecord> {
      captured.push(input);
      const record: AuthEventRecord = {
        id: `evt-${captured.length}`,
        eventType: input.eventType,
        userId: input.userId ?? null,
        email: input.email ?? null,
        sourceIp: input.sourceIp ?? null,
        // Echo the caller-supplied timestamp; fall back to the clock otherwise.
        occurredAt: input.occurredAt ?? FIXED_NOW,
      };
      return Promise.resolve(record);
    },
  };
  return { repo, captured };
}

// Non-whitespace identifier-like tokens for user ids and email parts.
const TOKEN_CHARS =
  'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'.split('');

const token = (minLength: number, maxLength: number) =>
  fc.stringOf(fc.constantFrom(...TOKEN_CHARS), { minLength, maxLength });

const userId = token(1, 24);

const email = fc
  .tuple(token(1, 12), token(1, 12), token(1, 6))
  .map(([local, domain, tld]) => `${local}@${domain}.${tld}`);

// A source IP that is sometimes present and sometimes undefined/blank so the
// placeholder rule (Req 11.5) is exercised on both branches.
const presentIp = fc
  .tuple(
    fc.integer({ min: 0, max: 255 }),
    fc.integer({ min: 0, max: 255 }),
    fc.integer({ min: 0, max: 255 }),
    fc.integer({ min: 0, max: 255 }),
  )
  .map(([a, b, c, d]) => `${a}.${b}.${c}.${d}`);

// undefined and whitespace-only both mean "cannot be determined".
const missingIp = fc.constantFrom<string | undefined>(
  undefined,
  '',
  ' ',
  '   ',
  '\t',
);

const sourceIp = fc.oneof(presentIp, missingIp);

/** The expected recorded source IP given a raw input, per Req 11.5. */
function expectedSourceIp(raw: string | undefined): string {
  return raw === undefined || raw.trim().length === 0 ? UNKNOWN_SOURCE_IP : raw;
}

describe('createAuditLogger - Property 26: auth events carry the required fields', () => {
  it('recordRegistration persists a registration event with user id + UTC timestamp (Req 11.1)', async () => {
    await fc.assert(
      fc.asyncProperty(userId, async (id) => {
        const { repo, captured } = makeMockRepo();
        const logger = createAuditLogger({ repo, now: () => FIXED_NOW });

        await logger.recordRegistration(id);

        expect(captured).toHaveLength(1);
        const event = captured[0];
        expect(event.eventType).toBe('registration');
        expect(event.userId).toBe(id);
        expect(event.occurredAt).toBeInstanceOf(Date);
        expect(event.occurredAt?.getTime()).toBe(FIXED_NOW.getTime());
      }),
      { numRuns: 100 },
    );
  });

  it('recordLoginSuccess persists login-success with user id, source IP (placeholder when unknown) + timestamp (Req 11.2, 11.5)', async () => {
    await fc.assert(
      fc.asyncProperty(userId, sourceIp, async (id, ip) => {
        const { repo, captured } = makeMockRepo();
        const logger = createAuditLogger({ repo, now: () => FIXED_NOW });

        await logger.recordLoginSuccess(id, ip);

        expect(captured).toHaveLength(1);
        const event = captured[0];
        expect(event.eventType).toBe('login-success');
        expect(event.userId).toBe(id);
        expect(event.sourceIp).toBe(expectedSourceIp(ip));
        expect(event.occurredAt).toBeInstanceOf(Date);
        expect(event.occurredAt?.getTime()).toBe(FIXED_NOW.getTime());
      }),
      { numRuns: 100 },
    );
  });

  it('recordLoginFailure persists login-failure with submitted email, source IP (placeholder when unknown) + timestamp (Req 11.3, 11.5)', async () => {
    await fc.assert(
      fc.asyncProperty(email, sourceIp, async (submittedEmail, ip) => {
        const { repo, captured } = makeMockRepo();
        const logger = createAuditLogger({ repo, now: () => FIXED_NOW });

        await logger.recordLoginFailure(submittedEmail, ip);

        expect(captured).toHaveLength(1);
        const event = captured[0];
        expect(event.eventType).toBe('login-failure');
        expect(event.email).toBe(submittedEmail);
        expect(event.sourceIp).toBe(expectedSourceIp(ip));
        expect(event.occurredAt).toBeInstanceOf(Date);
        expect(event.occurredAt?.getTime()).toBe(FIXED_NOW.getTime());
      }),
      { numRuns: 100 },
    );
  });

  it('recordLogout persists a logout event with user id + UTC timestamp (Req 11.4)', async () => {
    await fc.assert(
      fc.asyncProperty(userId, async (id) => {
        const { repo, captured } = makeMockRepo();
        const logger = createAuditLogger({ repo, now: () => FIXED_NOW });

        await logger.recordLogout(id);

        expect(captured).toHaveLength(1);
        const event = captured[0];
        expect(event.eventType).toBe('logout');
        expect(event.userId).toBe(id);
        expect(event.occurredAt).toBeInstanceOf(Date);
        expect(event.occurredAt?.getTime()).toBe(FIXED_NOW.getTime());
      }),
      { numRuns: 100 },
    );
  });
});
