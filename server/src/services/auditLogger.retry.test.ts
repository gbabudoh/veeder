/**
 * Unit tests (example-based) for the Audit_Logger's retry-then-non-blocking
 * behavior.
 *
 * Design reference: `design.md` -> "Audit_Logger (`auditLogger`)". A failed
 * insert is retried up to `retries` total attempts (default
 * {@link DEFAULT_AUDIT_RETRIES} = 3); if every attempt fails the logger does
 * NOT throw. Instead it invokes the injected `onFailure` handler once and
 * resolves, so audit logging never interrupts the originating registration,
 * login, or logout operation (Req 11.8).
 *
 * These are plain Jest example tests (no fast-check) using a mocked repository.
 *
 * Validates: Requirements 11.8
 */
import {
  createAuditLogger,
  DEFAULT_AUDIT_RETRIES,
  type AuditEventRepo,
} from './auditLogger';
import type { AuthEventRecord } from '../repositories/authEventsRepository';

/** A canned successful insert result (its contents are irrelevant to retries). */
const okRecord: AuthEventRecord = {
  id: 'evt-1',
  eventType: 'registration',
  userId: 'u1',
  email: null,
  sourceIp: null,
  occurredAt: new Date(0),
};

describe('createAuditLogger - retry-then-non-blocking failure (Req 11.8)', () => {
  it('retries exactly 3 times (default) then invokes onFailure once and resolves without throwing', async () => {
    const insert = jest.fn().mockRejectedValue(new Error('db down'));
    const repo = { insert } as unknown as AuditEventRepo;
    const onFailure = jest.fn();

    const logger = createAuditLogger({ repo, onFailure, now: () => new Date(0) });

    // Must resolve (not reject) even though every insert attempt fails.
    await expect(logger.recordRegistration('u1')).resolves.toBeUndefined();

    // Retried exactly the default number of total attempts.
    expect(insert).toHaveBeenCalledTimes(DEFAULT_AUDIT_RETRIES);
    expect(DEFAULT_AUDIT_RETRIES).toBe(3);

    // Non-blocking indication emitted exactly once with the failure context.
    expect(onFailure).toHaveBeenCalledTimes(1);
    expect(onFailure).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'registration', attempts: 3 }),
    );
  });

  it('does not retry when the first attempt succeeds and never calls onFailure', async () => {
    const insert = jest.fn().mockResolvedValue(okRecord);
    const repo = { insert } as unknown as AuditEventRepo;
    const onFailure = jest.fn();

    const logger = createAuditLogger({ repo, onFailure, now: () => new Date(0) });

    await expect(logger.recordRegistration('u1')).resolves.toBeUndefined();

    expect(insert).toHaveBeenCalledTimes(1);
    expect(onFailure).not.toHaveBeenCalled();
  });

  it('retries and stops once the second attempt succeeds, without calling onFailure', async () => {
    const insert = jest
      .fn()
      .mockRejectedValueOnce(new Error('transient'))
      .mockResolvedValue(okRecord);
    const repo = { insert } as unknown as AuditEventRepo;
    const onFailure = jest.fn();

    const logger = createAuditLogger({ repo, onFailure, now: () => new Date(0) });

    await expect(logger.recordRegistration('u1')).resolves.toBeUndefined();

    expect(insert).toHaveBeenCalledTimes(2);
    expect(onFailure).not.toHaveBeenCalled();
  });

  it('does not interrupt the originating operation: resolves to undefined even when insert always rejects', async () => {
    const insert = jest.fn().mockRejectedValue(new Error('db down'));
    const repo = { insert } as unknown as AuditEventRepo;
    const onFailure = jest.fn();

    const logger = createAuditLogger({ repo, onFailure, now: () => new Date(0) });

    await expect(logger.recordRegistration('u1')).resolves.toBeUndefined();
  });
});
