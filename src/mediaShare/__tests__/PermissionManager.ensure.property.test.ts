// Feature: simple-media-share, Property 2: A new request is issued only when permission is undetermined

import fc from 'fast-check';

/**
 * Property 2 (Validates: Requirements 1.1, 1.4)
 *
 * `ensurePermission` first checks the current native permission status. It
 * issues a new OS permission request if and only if that checked status maps to
 * `not_determined`. With `react-native-permissions` RESULTS, a *checked*
 * DENIED or UNAVAILABLE maps to `not_determined` (so a request is issued),
 * whereas GRANTED, LIMITED, and BLOCKED are already-resolved statuses and must
 * never trigger a new request.
 *
 * The native module is mocked so `check` resolves a configurable RESULTS value
 * and `request` is a spy. We assert `request` is called exactly when the
 * checked value maps to `not_determined`.
 */

// The RESULTS string values used by react-native-permissions. Replicated here
// so the mock is fully under our control and the test is device-free.
const RESULTS = {
  UNAVAILABLE: 'unavailable',
  DENIED: 'denied',
  LIMITED: 'limited',
  GRANTED: 'granted',
  BLOCKED: 'blocked',
} as const;

type ResultValue = (typeof RESULTS)[keyof typeof RESULTS];

// Manual, fully-controllable mock of react-native-permissions.
const mockCheck = jest.fn();
const mockRequest = jest.fn();

jest.mock('react-native-permissions', () => ({
  PERMISSIONS: {
    IOS: {PHOTO_LIBRARY: 'ios.permission.PHOTO_LIBRARY'},
    ANDROID: {
      READ_MEDIA_IMAGES: 'android.permission.READ_MEDIA_IMAGES',
      READ_EXTERNAL_STORAGE: 'android.permission.READ_EXTERNAL_STORAGE',
    },
  },
  RESULTS: {
    UNAVAILABLE: 'unavailable',
    DENIED: 'denied',
    LIMITED: 'limited',
    GRANTED: 'granted',
    BLOCKED: 'blocked',
  },
  check: (...args: unknown[]) => mockCheck(...args),
  request: (...args: unknown[]) => mockRequest(...args),
}));

// Import after the mock is registered.
import {ensurePermission} from '../PermissionManager';

// A checked RESULTS value maps to `not_determined` (and therefore triggers a
// request) exactly for DENIED and UNAVAILABLE.
const checkTriggersRequest = (result: ResultValue): boolean =>
  result === RESULTS.DENIED || result === RESULTS.UNAVAILABLE;

// Generate over every RESULTS value `check` may return.
const resultArb = fc.constantFrom<ResultValue>(
  RESULTS.UNAVAILABLE,
  RESULTS.DENIED,
  RESULTS.LIMITED,
  RESULTS.GRANTED,
  RESULTS.BLOCKED,
);

describe('ensurePermission - Property 2: request issued only when undetermined', () => {
  it('calls request iff the checked status maps to not_determined', async () => {
    await fc.assert(
      fc.asyncProperty(resultArb, async checkedResult => {
        // Reset per iteration so call counts reflect this run only.
        mockCheck.mockReset();
        mockRequest.mockReset();

        mockCheck.mockResolvedValue(checkedResult);
        // Resolve request promptly so we never approach the 10s timeout.
        mockRequest.mockResolvedValue(RESULTS.GRANTED);

        await ensurePermission();

        // check is always performed exactly once.
        expect(mockCheck).toHaveBeenCalledTimes(1);

        if (checkTriggersRequest(checkedResult)) {
          expect(mockRequest).toHaveBeenCalledTimes(1);
        } else {
          expect(mockRequest).not.toHaveBeenCalled();
        }
      }),
      {numRuns: 200},
    );
  });
});
