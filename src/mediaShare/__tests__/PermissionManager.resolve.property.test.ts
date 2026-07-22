/**
 * Property-based test for `resolvePermissionOutcome`.
 *
 * Verifies the pure permission decision table: a resolved permission status
 * maps to the correct outcome, the picker is opened if and only if the status
 * is `granted`, and every non-granted status yields the correct show_message
 * kind without ever opening the picker.
 */

import fc from 'fast-check';

import {resolvePermissionOutcome} from '../PermissionManager';
import type {PermissionStatus} from '../types';

// The five resolved permission statuses the decision table must handle.
const PERMISSION_STATUSES: readonly PermissionStatus[] = [
  'not_determined',
  'granted',
  'denied',
  'blocked',
  'error',
];

// Expected show_message kind for each non-granted status.
const EXPECTED_MESSAGE_KIND: Record<
  Exclude<PermissionStatus, 'granted'>,
  'access_required' | 'open_settings' | 'unavailable'
> = {
  denied: 'access_required',
  blocked: 'open_settings',
  error: 'unavailable',
  not_determined: 'unavailable',
};

describe('resolvePermissionOutcome (Property 1)', () => {
  // Feature: simple-media-share, Property 1: Permission status maps to the correct outcome
  it('maps each permission status to the correct outcome', () => {
    // Validates: Requirements 1.2, 1.3, 1.5, 1.6
    fc.assert(
      fc.property(fc.constantFrom(...PERMISSION_STATUSES), status => {
        const outcome = resolvePermissionOutcome(status);

        // The picker is opened if and only if the status is `granted`.
        const opensPicker = outcome.action === 'open_picker';
        expect(opensPicker).toBe(status === 'granted');

        if (status === 'granted') {
          expect(outcome).toEqual({action: 'open_picker'});
        } else {
          // Every non-granted status yields a show_message outcome and never
          // opens the picker.
          expect(outcome.action).toBe('show_message');
          if (outcome.action === 'show_message') {
            expect(outcome.kind).toBe(EXPECTED_MESSAGE_KIND[status]);
          }
        }
      }),
      {numRuns: 100},
    );
  });
});
