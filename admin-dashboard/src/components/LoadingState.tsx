/**
 * Presentational loading indicator.
 *
 * Renders a `role="status"` element with an accessible, polite live region so
 * assistive technologies announce that a request is in progress. Purely
 * presentational — it performs no data fetching.
 *
 * Requirements: 12.6, 13.2, 14.4, 15.6
 */

export interface LoadingStateProps {
  /** Optional label shown alongside the indicator. Defaults to "Loading…". */
  label?: string;
}

export function LoadingState({ label = 'Loading…' }: LoadingStateProps): JSX.Element {
  return (
    <div role="status" aria-live="polite" className="loading-state">
      <span className="loading-state__spinner" aria-hidden="true" />
      <span className="loading-state__label">{label}</span>
    </div>
  );
}

export default LoadingState;
