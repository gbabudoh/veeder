/**
 * Toolchain smoke test.
 *
 * Confirms that the Jest + ts-jest + fast-check toolchain is wired up
 * correctly: a plain assertion runs under ts-jest, and a trivial fast-check
 * property executes (identity of integers) using the globally configured run
 * count from the test bootstrap. This is a toolchain check, not a feature test.
 */
import fc from 'fast-check';

describe('toolchain smoke test', () => {
  it('runs a plain assertion via Jest + ts-jest', () => {
    expect(true).toBe(true);
    expect(1 + 1).toBe(2);
  });

  it('runs a fast-check property (integer identity)', () => {
    fc.assert(
      fc.property(fc.integer(), (n) => {
        return n === n;
      }),
    );
  });

  it('applies the test environment defaults from the bootstrap', () => {
    expect(process.env.APP_ENV).toBe('test');
    expect((process.env.JWT_SIGNING_KEY ?? '').length).toBeGreaterThanOrEqual(
      32,
    );
  });
});
